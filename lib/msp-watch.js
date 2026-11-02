import { n as sourceContext, t as health } from "./host-CBJYZ3Tc.js";
import { a as signalContext, i as parseTacit, o as tacitDir, r as matchTacit, t as TACIT_KINDS } from "./tacit-BNeQCq55.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import "node:child_process";
import { homedir } from "node:os";
import "node:readline";
// src/sources/experience-tools.ts
/**
* 经验的 CRUD：让模型自己读、写、改、删。
*
* 为什么要有这一组工具：经验如果只能由人手写，它就永远长不大。模型在干活时
* 最清楚「刚才那次判断的依据是什么」，让它当场把这条写下来，比事后回顾准得多。
*
* 落盘就是 `~/.dsh/tacit/experiences/<id>.md`（YAML 头 + 正文），
* 与 `experiences.ts` 的读取逻辑、以及 tacit 那边完全同格式——
* 所以人改文件、模型调工具，看到的是同一份东西。
*
* 四条硬约束（写在代码里，不靠提示词自觉）：
*   1. id 只允许 `[a-z0-9-]`，且不许覆盖已有文件（要改就 update）；
*   2. 新建的等级最高只能是 L3（先问后做），L1/L2 必须由人上调；
*   3. delete 是软删（enabled: false），真删要人来；
*   4. 每次写都记 `taught_by` 与时间，没有出处的规则就是迷信。
*/
const DIR = () => process.env.TACIT_EXPERIENCE_DIR ?? join(homedir(), ".dsh", "tacit", "experiences");
const ID_RE$1 = /^[a-z0-9][a-z0-9-]{1,63}$/;
const LEVELS$1 = [
	"L1",
	"L2",
	"L3",
	"L4"
];
function render$1(d) {
	return [
		"---",
		`id: ${d.id}`,
		`trigger: ${d.trigger}`,
		`condition: ${d.condition ?? "true"}`,
		`action: ${(d.action ?? "").replace(/\s*\n\s*/g, " ").trim()}`,
		`trust_level: ${d.trust ?? "L3"}`,
		"scope: local",
		"enabled: true",
		`taught_by: agent`,
		`taught_at: ${(/* @__PURE__ */ new Date()).toISOString()}`,
		"---",
		"",
		`# ${d.title ?? d.action.slice(0, 40)}`,
		"",
		d.body ?? "",
		""
	].join("\n");
}
/** Returns the level to store and whether the model asked for one it may not set. */
function clampTrust$1(input) {
	const level = String(input ?? "L3").toUpperCase();
	if (!LEVELS$1.includes(level)) return {
		level: "L3",
		clamped: false
	};
	return level === "L1" || level === "L2" ? {
		level: "L3",
		clamped: true
	} : {
		level,
		clamped: false
	};
}
const OUT$2 = {
	type: "object",
	properties: {
		content: {
			type: "array",
			items: {}
		},
		structuredContent: {}
	},
	required: ["content"],
	additionalProperties: false
};
/** 这组的注册函数由 msp.ts 在 `ctx.inject(['tools'])` 里调用。 */
function registerExperienceTools(tools) {
	const disposers = [];
	const dir = DIR();
	const list = () => {
		try {
			return readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")).sort();
		} catch {
			return [];
		}
	};
	/**
	* The file an id names, or undefined when the id is not a plain slug. `id` comes from the model, so `..`,
	* separators and drive letters must never reach `join`: without this check `experience_read` would read any `.md`
	* on disk and `experience_update` would rewrite it.
	*/
	const fileOf = (id) => ID_RE$1.test(id) ? join(dir, `${id}.md`) : void 0;
	const read = (id) => {
		const file = fileOf(id);
		if (!file) return void 0;
		try {
			return readFileSync(file, "utf8");
		} catch {
			return;
		}
	};
	disposers.push(tools.register({
		name: "experience_list",
		description: "列出本机经验库里的所有经验 id。经验是「当…就…」的规则，会按信号路径自动命中并注入上下文。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		output: {
			schema: OUT$2,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.ids.join("\n")
			}]
		},
		execute: async () => {
			const ids = list();
			return {
				content: [{
					type: "text",
					text: ids.join("\n")
				}],
				structuredContent: { ids }
			};
		}
	}));
	disposers.push(tools.register({
		name: "experience_read",
		description: "读一条经验的完整内容（含条件、动作、等级和正文）。",
		parameters: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false
		},
		output: {
			schema: OUT$2,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.text
			}]
		},
		execute: async (args) => {
			const text = read(String(args?.id ?? ""));
			return {
				content: [{
					type: "text",
					text: text ?? "(没有这条经验)"
				}],
				structuredContent: {
					text: text ?? "",
					found: Boolean(text)
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "experience_create",
		description: [
			"新建一条经验。只在「这次判断有可复用的理由」时用：一条规则一个文件，别攒大杂烩。新建的等级最高 L3。",
			"",
			"写之前先自检，四条缺一不可：",
			"1. 可执行 —— action 必须写清「做什么 + 用什么做」，例如「用 report 交付一句结果」「移动到 ~/Documents/Work/」，",
			"   不能只写意图（「弹一个轻量通知」「处理一下」「归档」这类都不可执行，执行者会自己发明实现）。",
			"2. 有边界 —— 明确写出不许做什么（「不读无关目录」「不查系统数据库」「不自己造弹窗」）。",
			"3. 条件可判定 —— condition 只支持 true、`字段 == 值`、`字段 in [..]`；写别的等于永不命中，而且不会报错。",
			"4. 等级克制 —— 默认 L3（先问后做），这条规则跑顺很多次之后再考虑降级。",
			"",
			"反例：「弹一个轻量通知」—— 实测让执行者花了 48 秒、几十轮调用，还去翻系统通知数据库。",
			"正例：「只做三件事：判断 → 移动到 ~/Documents/Work/ → 用 report 交付一句结果；不读无关目录」。"
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "小写字母数字和连字符，例如 installer-ask"
				},
				trigger: {
					type: "string",
					description: "信号路径，支持 file.** 或 file.created"
				},
				action: {
					type: "string",
					description: "命中后做什么"
				},
				condition: {
					type: "string",
					description: "可选，默认 true"
				},
				trust_level: {
					type: "string",
					enum: LEVELS$1,
					description: "默认 L3"
				},
				title: { type: "string" },
				body: {
					type: "string",
					description: "为什么——这条经验的理由"
				}
			},
			required: [
				"id",
				"trigger",
				"action"
			],
			additionalProperties: false
		},
		output: {
			schema: OUT$2,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const id = String(args?.id ?? "");
			if (!ID_RE$1.test(id)) return {
				content: [{
					type: "text",
					text: `id 不合法：${id}`
				}],
				structuredContent: {
					ok: false,
					message: "id 不合法"
				}
			};
			if (existsSync(join(dir, `${id}.md`))) return {
				content: [{
					type: "text",
					text: `已存在同 id 的经验：${id}，要改请用 experience_update`
				}],
				structuredContent: {
					ok: false,
					message: "已存在"
				}
			};
			mkdirSync(dir, { recursive: true });
			const trust = clampTrust$1(args.trust_level);
			writeFileSync(join(dir, `${id}.md`), render$1({
				id,
				trigger: String(args.trigger),
				condition: args.condition ? String(args.condition) : void 0,
				action: String(args.action),
				trust: trust.level,
				title: args.title ? String(args.title) : void 0,
				body: args.body ? String(args.body) : void 0
			}), "utf8");
			const message = trust.clamped ? `已写入 ${id}.md，等级按 L3 落盘：L1/L2 是不经确认就行动的等级，模型不能自授，要降级只能由人在 ${id}.md 里改 trust_level。` : `已写入 ${id}.md`;
			return {
				content: [{
					type: "text",
					text: message
				}],
				structuredContent: {
					ok: true,
					message,
					id,
					trust_level: trust.level
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "experience_update",
		description: ["改一条已有经验。只传要改的字段。等级最高 L3（降级与放宽要人来定）。", "改 action 时同样要满足可执行与有边界：写清「做什么 + 用什么做」，并写明不许做什么。"].join("\n"),
		parameters: {
			type: "object",
			properties: {
				id: { type: "string" },
				trigger: { type: "string" },
				action: { type: "string" },
				condition: { type: "string" },
				trust_level: {
					type: "string",
					enum: LEVELS$1
				},
				body: { type: "string" }
			},
			required: ["id"],
			additionalProperties: false
		},
		output: {
			schema: OUT$2,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const id = String(args?.id ?? "");
			const text = read(id);
			if (!text) return {
				content: [{
					type: "text",
					text: `没有这条经验：${id}`
				}],
				structuredContent: {
					ok: false,
					message: "没有"
				}
			};
			const patch = {};
			for (const key of [
				"trigger",
				"action",
				"condition"
			]) if (typeof args?.[key] === "string") patch[key] = args[key];
			let out = text;
			for (const [key, value] of Object.entries(patch)) {
				const line = `${key}: ${value.replace(/\s*\n\s*/g, " ")}`;
				out = out.replace(new RegExp(`^${key}:.*$`, "m"), () => line);
			}
			const trust = typeof args?.trust_level === "string" ? clampTrust$1(args.trust_level) : void 0;
			if (trust) out = out.replace(/^trust_level:.*$/m, `trust_level: ${trust.level}`);
			writeFileSync(fileOf(id), out, "utf8");
			if (trust?.clamped) {
				const message = `等级没有改：L1/L2 是不经确认就行动的等级，模型不能自授，${id}.md 里仍是 L3。${Object.keys(patch).length ? "其他字段已更新。" : ""}要降级只能由人在这个文件里改 trust_level。`;
				return {
					content: [{
						type: "text",
						text: message
					}],
					structuredContent: {
						ok: false,
						message,
						id,
						trust_level: "L3"
					}
				};
			}
			return {
				content: [{
					type: "text",
					text: `已更新 ${id}`
				}],
				structuredContent: {
					ok: true,
					message: `已更新 ${id}`,
					id,
					...trust ? { trust_level: trust.level } : {}
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "experience_disable",
		description: "停用一条经验（软删，文件留着）。它不会再被命中，但还能查回来。真删要人来做。",
		parameters: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false
		},
		output: {
			schema: OUT$2,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const id = String(args?.id ?? "");
			const text = read(id);
			if (!text) return {
				content: [{
					type: "text",
					text: `没有这条经验：${id}`
				}],
				structuredContent: {
					ok: false,
					message: "没有"
				}
			};
			const out = /^enabled:/m.test(text) ? text.replace(/^enabled:.*$/m, "enabled: false") : text.replace(/^---(\r?\n)/, (_match, eol) => `---${eol}enabled: false${eol}`);
			writeFileSync(fileOf(id), out, "utf8");
			return {
				content: [{
					type: "text",
					text: `已停用 ${id}`
				}],
				structuredContent: {
					ok: true,
					message: `已停用 ${id}`,
					id
				}
			};
		}
	}));
	return disposers;
}
// src/sources/tacit-tools.ts
/**
* 经验层的 CRUD：记忆 / 经验 / 技能，一套工具。
*
* 为什么要有这一组：经验层如果只能靠人手写，它永远长不大。干活的人最清楚「刚才那次判断
* 的依据」，让它当场写下来，比事后回顾准得多。三类知识同一套读写，是因为它们的差别只在
* 「front-matter 里放什么」，不在「存在哪、怎么管」。
*
* 落盘就是 `~/.dsh/tacit/<memories|experiences|skills>/<id>.md`（YAML 头 + 正文），
* 与 `tacit.ts` 的读取逻辑完全同格式——所以人改文件、模型调工具，看的是同一份东西。
*
* 四条硬约束（写在代码里，不靠提示词自觉）：
*   1. id 只允许 `[a-z0-9-]`，且不许覆盖已有文件（要改就 update）；
*   2. 新建的等级最高只能是 L3（先问后做），L1/L2 必须由人上调；
*   3. disable 是软删（`enabled: false`），真删要人来；
*   4. 每次写都记 `taught_by` 与时间——没有出处的规则就是迷信。
*/
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const LEVELS = [
	"L1",
	"L2",
	"L3",
	"L4"
];
const OUT$1 = {
	type: "object",
	properties: {
		content: {
			type: "array",
			items: {}
		},
		structuredContent: {}
	},
	required: ["content"],
	additionalProperties: false
};
/** 工具参数里的 kind 是模型给的字符串，必须窄化成三类之一。 */
function asKind(value) {
	const kind = String(value ?? "").toLowerCase();
	return TACIT_KINDS.includes(kind) ? kind : void 0;
}
/** 模型自建不许直接拿 L1/L2：那是可以不经人点头就行动的等级。 */
function clampTrust(input) {
	const level = String(input ?? "L3").toUpperCase();
	if (!LEVELS.includes(level)) return {
		level: "L3",
		clamped: false
	};
	return level === "L1" || level === "L2" ? {
		level: "L3",
		clamped: true
	} : {
		level,
		clamped: false
	};
}
function render(draft) {
	const actionKey = draft.kind === "mem" ? "fact" : "action";
	return [
		"---",
		`id: ${draft.id}`,
		`trigger: ${draft.trigger}`,
		`condition: ${draft.condition}`,
		`${actionKey}: ${draft.action.replace(/\s*\n\s*/g, " ").trim()}`,
		`trust_level: ${draft.trust}`,
		"scope: local",
		"enabled: true",
		"taught_by: agent",
		`taught_at: ${(/* @__PURE__ */ new Date()).toISOString()}`,
		"---",
		"",
		`# ${draft.title || draft.action.slice(0, 40)}`,
		"",
		draft.body,
		""
	].join("\n");
}
/** 经验层三库的读写工具；由 `msp.ts` 在 `ctx.inject(['tools'])` 里注册。 */
function registerTacitTools(tools) {
	const disposers = [];
	/** id 来自模型，`..`、分隔符、盘符都不能进 `join`：否则读工具能读走磁盘上任意 `.md`。 */
	const fileOf = (kind, id) => ID_RE.test(id) ? join(tacitDir(kind), `${id}.md`) : void 0;
	const list = (kind) => {
		try {
			return readdirSync(tacitDir(kind)).filter((name) => name.toLowerCase().endsWith(".md")).map((name) => name.replace(/\.md$/i, "")).sort();
		} catch {
			return [];
		}
	};
	const read = (kind, id) => {
		const file = fileOf(kind, id);
		if (!file) return void 0;
		try {
			return readFileSync(file, "utf8");
		} catch {
			return;
		}
	};
	disposers.push(tools.register({
		name: "tacit_list",
		description: "列出经验层（记忆/经验/技能）里的 id。传 kind 只看一类，不传看全部。这些条目会按信号路径自动命中并注入上下文。",
		parameters: {
			type: "object",
			properties: { kind: {
				type: "string",
				enum: [...TACIT_KINDS],
				description: "mem=事实, exp=规则, skill=流程"
			} },
			additionalProperties: false
		},
		output: {
			schema: OUT$1,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.text
			}]
		},
		execute: async (args) => {
			const one = asKind(args?.kind);
			const groups = (one ? [one] : [...TACIT_KINDS]).map((kind) => ({
				kind,
				ids: list(kind)
			}));
			const text = groups.map((group) => `${group.kind}: ${group.ids.length ? group.ids.join(", ") : "(空)"}`).join("\n");
			return {
				content: [{
					type: "text",
					text
				}],
				structuredContent: {
					groups,
					text
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "tacit_read",
		description: "读一条记忆/经验/技能的完整内容（front-matter + 正文）。",
		parameters: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [...TACIT_KINDS]
				},
				id: { type: "string" }
			},
			required: ["kind", "id"],
			additionalProperties: false
		},
		output: {
			schema: OUT$1,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.text
			}]
		},
		execute: async (args) => {
			const kind = asKind(args?.kind);
			const id = String(args?.id ?? "");
			if (!kind) return {
				content: [{
					type: "text",
					text: "(kind 只能是 mem / exp / skill)"
				}],
				structuredContent: {
					text: "",
					found: false
				}
			};
			const text = read(kind, id);
			return {
				content: [{
					type: "text",
					text: text ?? "(没有这条)"
				}],
				structuredContent: {
					text: text ?? "",
					found: Boolean(text)
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "tacit_create",
		description: [
			"新建一条记忆/经验/技能。只在「这次判断有可复用的理由」时用：一条一个文件，别攒大杂烩。新建等级最高 L3。",
			"",
			"按 kind 选形状（写错形状等于永不命中，而且不会报错）：",
			"- mem：写事实。`action` 里放一句可核验的陈述，例如「这个目录下载的安装包一律先问再装」。",
			"- exp：写规则「当…就…」。action 必须写清「做什么 + 用什么做」，不能只写意图。",
			"- skill：写流程。title 是名字，body 是分步骤的手册（每行一步）。",
			"",
			"条件只支持 true、`字段 == 值`、`字段 in [..]`；trigger 支持 `**`、`file.*`、`file.created`。"
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [...TACIT_KINDS]
				},
				id: {
					type: "string",
					description: "小写字母数字和连字符，例如 zip-archive"
				},
				trigger: {
					type: "string",
					description: "信号路径，支持 file.** 或 file.created"
				},
				action: {
					type: "string",
					description: "mem=事实；exp=命中后做什么；skill 可留空用 body"
				},
				condition: {
					type: "string",
					description: "可选，默认 true"
				},
				trust_level: {
					type: "string",
					enum: [...LEVELS],
					description: "默认 L3"
				},
				title: { type: "string" },
				body: {
					type: "string",
					description: "为什么 / 技能的分步流程"
				}
			},
			required: [
				"kind",
				"id",
				"trigger"
			],
			additionalProperties: false
		},
		output: {
			schema: OUT$1,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const kind = asKind(args?.kind);
			const id = String(args?.id ?? "");
			const trigger = String(args?.trigger ?? "").trim();
			const bad = (message) => ({
				content: [{
					type: "text",
					text: message
				}],
				structuredContent: {
					ok: false,
					message
				}
			});
			if (!kind) return bad("kind 只能是 mem / exp / skill");
			if (!ID_RE.test(id)) return bad(`id 不合法：${id}（小写字母数字和连字符，2~64 位）`);
			if (!trigger) return bad("trigger 不能为空");
			const file = join(tacitDir(kind), `${id}.md`);
			if (existsSync(file)) return bad(`已存在同 id 的条目：${kind}/${id}，要改请用 tacit_update`);
			const action = String(args?.action ?? "").trim();
			const body = String(args?.body ?? "").trim();
			if (kind !== "skill" && !action) return bad("mem / exp 必须给 action");
			if (kind === "skill" && !action && !body) return bad("skill 至少要有 action 或 body");
			mkdirSync(tacitDir(kind), { recursive: true });
			const trust = clampTrust(args?.trust_level);
			writeFileSync(file, render({
				kind,
				id,
				trigger,
				condition: String(args?.condition ?? "true").trim() || "true",
				action,
				trust: trust.level,
				title: String(args?.title ?? "").trim(),
				body
			}), "utf8");
			const message = `已写入 ${kind}/${id}${trust.clamped ? "（L1/L2 已压到 L3：不经人点头就行动的等级只能由人上调）" : ""}`;
			return {
				content: [{
					type: "text",
					text: message
				}],
				structuredContent: {
					ok: true,
					message,
					clamped: trust.clamped
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "tacit_disable",
		description: "停用一条记忆/经验/技能（软删：置 enabled: false）。真删要人来，因为删掉的东西没法再复盘。",
		parameters: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [...TACIT_KINDS]
				},
				id: { type: "string" }
			},
			required: ["kind", "id"],
			additionalProperties: false
		},
		output: {
			schema: OUT$1,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const kind = asKind(args?.kind);
			const id = String(args?.id ?? "");
			const done = (message) => ({
				content: [{
					type: "text",
					text: message
				}],
				structuredContent: { message }
			});
			if (!kind) return done("kind 只能是 mem / exp / skill");
			const file = fileOf(kind, id);
			if (!file) return done(`id 不合法：${id}`);
			const text = read(kind, id);
			if (!text) return done(`没有这条：${kind}/${id}`);
			if (!parseTacit(text, kind, file)) return done(`这条的 front-matter 解析不了，请人工修：${file}`);
			const next = /^enabled\s*:\s*.*$/m.test(text) ? text.replace(/^enabled\s*:\s*.*$/m, "enabled: false") : text.replace(/^---$/m, "---\nenabled: false");
			writeFileSync(file, next, "utf8");
			return done(`已停用 ${kind}/${id}（enabled: false）`);
		}
	}));
	return disposers;
}
// src/sources/msp-act.ts
let mesh = null;
/** 由 `runMsp` 在节点起来之后挂上，停掉时清空；工具在没起来时要说人话，而不是抛错。 */
function setMspMesh(next) {
	mesh = next;
}
const mspMesh = () => mesh;
/** 把对端 manifest 归一成「它能干什么」；manifest 是不可信输入，缺字段一律降级成空。 */
function describePeer(id, manifest) {
	const signals = Array.isArray(manifest?.signals) ? manifest.signals.flatMap((entry) => {
		const path = typeof entry === "string" ? entry : entry?.path;
		return typeof path === "string" && path.trim() ? [path.trim()] : [];
	}) : [];
	const tools = Array.isArray(manifest?.tools) ? manifest.tools.flatMap((entry) => {
		const spec = entry ?? {};
		return typeof spec.name === "string" && spec.name.trim() ? [{
			name: spec.name.trim(),
			description: typeof spec.description === "string" ? spec.description : ""
		}] : [];
	}) : [];
	return {
		id,
		signals: [...new Set(signals)].sort(),
		tools
	};
}
/** 本机看得见的全部节点。只列邻居——没连上的节点对 Agent 来说等于不存在，这正是「看不见」的含义。 */
function peerCapabilities(current = mesh) {
	if (!current) return [];
	return [.../* @__PURE__ */ new Set([...current.neighbors(), ...current.connections()])].sort().map((id) => describePeer(id, current.peerManifest(id)));
}
const OUT = {
	type: "object",
	properties: {
		content: {
			type: "array",
			items: {}
		},
		structuredContent: {}
	},
	required: ["content"],
	additionalProperties: false
};
/** 补丁一的三个工具；由 `msp.ts` 在 `ctx.inject(['tools'])` 里注册。 */
function registerMspActTools(tools) {
	const disposers = [];
	const offline = (message) => ({
		content: [{
			type: "text",
			text: message
		}],
		structuredContent: {
			ok: false,
			message
		}
	});
	disposers.push(tools.register({
		name: "msp_nodes",
		description: [
			"列出本机 MSP 网格里能看见的节点，以及每个节点声明的能力（会发哪些信号、能调哪些工具）。",
			"这就是「接入」的入口：节点在列表里，就能用 msp_publish / msp_call 直接驱动它，不需要为它单独适配。",
			"不在列表里的节点对你说等于不存在——先把它拉起来（或让它宣告自己），再回来查。"
		].join("\n"),
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		output: {
			schema: OUT,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.text
			}]
		},
		execute: async () => {
			if (!mesh) return offline("MSP 节点还没起来（来源未启用或正在重连）；先确认 msp 来源是开启状态。");
			const peers = peerCapabilities(mesh);
			const text = peers.length === 0 ? `节点 ${mesh.nodeId} 在线，但暂时没有连上的邻居。` : [`本节点：${mesh.nodeId}`, ...peers.map((peer) => {
				const signals = peer.signals.length ? peer.signals.join(", ") : "(未声明信号)";
				const toolsText = peer.tools.length ? peer.tools.map((tool) => tool.name).join(", ") : "(未声明工具)";
				return `- ${peer.id}｜信号：${signals}｜工具：${toolsText}`;
			})].join("\n");
			return {
				content: [{
					type: "text",
					text
				}],
				structuredContent: {
					ok: true,
					text,
					node: mesh.nodeId,
					peers
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "msp_publish",
		description: [
			"往 MSP 网格发一条信号（一切皆信号：动作也是信号）。任何订阅了这个路径的节点都会收到。",
			"路径用点分小写，例如 device.light.on / download.pause / notify.message；payload 是随信号一起传的字段。",
			"这条工具不关心对面是什么设备——设备叫什么、怎么实现，都不需要你知道。"
		].join("\n"),
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "信号路径，点分，例如 device.light.on"
				},
				payload: {
					type: "object",
					description: "随信号传的字段，可选",
					additionalProperties: true
				}
			},
			required: ["path"],
			additionalProperties: false
		},
		output: {
			schema: OUT,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			if (!mesh) return offline("MSP 节点还没起来，信号发不出去。");
			const path = String(args?.path ?? "").trim();
			if (!/^[a-z0-9][a-z0-9._-]*$/i.test(path)) return offline(`信号路径不合法：${path}（点分，字母数字下划线和点）`);
			const payload = args?.payload && typeof args.payload === "object" ? args.payload : {};
			try {
				mesh.publish(path, {
					...payload,
					published_by: mesh.nodeId,
					published_at: (/* @__PURE__ */ new Date()).toISOString()
				});
			} catch (error) {
				return offline(`发送失败：${String(error).slice(0, 200)}`);
			}
			const message = `已发送 ${path}（${Object.keys(payload).length} 个字段）`;
			return {
				content: [{
					type: "text",
					text: message
				}],
				structuredContent: {
					ok: true,
					message,
					path
				}
			};
		}
	}));
	disposers.push(tools.register({
		name: "msp_call",
		description: ["直接调用某个 MSP 节点声明的工具，并拿回结果（需要返回值的场景用它，发完就走用 msp_publish）。", "先 msp_nodes 看对方有哪些工具；工具名必须是对方清单里声明过的。"].join("\n"),
		parameters: {
			type: "object",
			properties: {
				peer: {
					type: "string",
					description: "节点 id，例如 file-watcher"
				},
				tool: {
					type: "string",
					description: "对方声明的工具名"
				},
				args: {
					type: "object",
					description: "调用参数",
					additionalProperties: true
				},
				timeout_ms: {
					type: "number",
					description: "超时，默认 15000"
				}
			},
			required: ["peer", "tool"],
			additionalProperties: false
		},
		output: {
			schema: OUT,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.text
			}]
		},
		execute: async (args) => {
			if (!mesh) return offline("MSP 节点还没起来，调不了对端。");
			const peer = String(args?.peer ?? "").trim();
			const tool = String(args?.tool ?? "").trim();
			if (!peer || !tool) return offline("peer 和 tool 都不能为空");
			const declared = peerCapabilities(mesh).find((item) => item.id === peer);
			if (!declared) return offline(`没有连上节点 ${peer}；先用 msp_nodes 看现在能看见谁。`);
			if (!declared.tools.some((item) => item.name === tool)) return offline(`节点 ${peer} 没有声明工具 ${tool}；它声明的是：${declared.tools.map((item) => item.name).join(", ") || "(无)"}`);
			const call = mesh.call;
			if (typeof call !== "function") return offline("当前 msp-ts 版本不支持 msp_call，只能用 msp_publish 发信号。");
			const timeout = Number.isFinite(args?.timeout_ms) ? Math.min(Math.max(Number(args.timeout_ms), 500), 12e4) : 15e3;
			try {
				const result = await call.call(mesh, peer, tool, args?.args && typeof args.args === "object" ? args.args : {}, timeout);
				const text = typeof result === "string" ? result : JSON.stringify(result).slice(0, 4e3);
				return {
					content: [{
						type: "text",
						text
					}],
					structuredContent: {
						ok: true,
						text
					}
				};
			} catch (error) {
				return offline(`调用 ${peer}/${tool} 失败：${String(error).slice(0, 240)}`);
			}
		}
	}));
	return disposers;
}
// src/sources/msp.ts
const SOURCE = "msp";
const MspConfigSchema = z.object({
	enabled: z.boolean().default(true),
	/** Signal path globs the bridge subscribes to; `**` is everything the node hears.
	*  The panel edits this as `rows` with one `path` column, so the stored shape is objects. */
	paths: z.array(z.object({ path: z.string() })).default([{ path: "**" }]),
	/** Name this node announces under; a second Super-agent on the machine needs another. */
	nodeName: z.string().default("superagent"),
	/** Signals whose payload marks a person as the author become human Triggers. */
	humanPaths: z.array(z.string()).default(["human.message", "notify.message"])
});
/** The topic a signal belongs to: `file.created.C:\x\y.zip` → `file.created`. */
const topicOf = (path) => {
	const parts = String(path ?? "").split(".").filter(Boolean);
	return parts.length <= 2 ? parts.join(".") || "msp" : parts.slice(0, 2).join(".");
};
/** Deterministic id so a bridge restart that replays a signal does not double-open a ticket. */
const mspTriggerId = (node, path, at, payload) => `msp:${node}:${path}:${at}:${JSON.stringify(payload ?? null).slice(0, 120)}`;
/** Turns one bridge line into the domain's Trigger; exposed for tests. */
function mspTrigger(event, config) {
	const path = String(event.path ?? "").trim();
	if (!path) return void 0;
	const at = typeof event.at === "string" && !Number.isNaN(Date.parse(event.at)) ? event.at : (/* @__PURE__ */ new Date()).toISOString();
	const node = String(event.node ?? "msp");
	const payload = event.payload ?? {};
	const human = event.human === true || config.humanPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
	const text = typeof payload === "string" ? payload : JSON.stringify(payload).slice(0, 2e3);
	return {
		id: mspTriggerId(node, path, at, payload),
		source: "msp",
		threads: [{
			source: "msp",
			id: topicOf(path)
		}],
		actor: {
			source: "msp",
			id: human ? node : ""
		},
		human,
		addressed: human ? "direct" : void 0,
		at,
		text: `${path}\n${text}`,
		meta: {
			mspPath: path,
			mspNode: node,
			mspPayload: payload,
			topic: topicOf(path)
		}
	};
}
const mspKind = {
	kind: "msp",
	title: {
		zh: "本机 MSP 节点",
		en: "Local MSP nodes"
	},
	description: {
		zh: "本机软件主动推来的信号（文件、剪贴板、进程、任何宣告了自己的节点）。不轮询。",
		en: "Signals pushed by local software (files, clipboard, processes, any node that announces itself). No polling."
	},
	schema: MspConfigSchema,
	fields: [{
		key: "paths",
		label: {
			zh: "订阅的信号路径",
			en: "Signal paths"
		},
		hint: {
			zh: "例如 **、file.**、notify.message",
			en: "e.g. **, file.**, notify.message"
		},
		type: "rows",
		columns: [{
			key: "path",
			label: {
				zh: "路径",
				en: "Path"
			},
			type: "text"
		}]
	}, {
		key: "nodeName",
		label: {
			zh: "本节点名称",
			en: "Node name"
		},
		type: "text"
	}],
	health: ["msp"],
	/**
	* Every MSP signal is in scope and observed (we produce all of them, there is no
	* membership list to filter by). `row` names the admission row the Policy looks up:
	* `policy.sources.msp.admission.ambient.unlistedUnaddressed` must be `inferred`,
	* otherwise machine events are ignored — see README.md.
	*/
	scope: () => ({
		listened: true,
		observed: true,
		row: "ambient"
	}),
	environment: {
		variables: [{
			key: "DSH_SUPERAGENT_MSP_TOPIC",
			description: {
				zh: "触发本工单的 MSP 信号主题",
				en: "The MSP topic that started this ticket"
			}
		}],
		values: ({ trigger }) => ({ DSH_SUPERAGENT_MSP_TOPIC: trigger?.source === "msp" ? String(trigger.meta.topic ?? "") : "" })
	}
};
const available = (ctx) => {
	const config = ctx.config("msp");
	if (!config || config.enabled === false) {
		ctx.report("msp", health("paused", "sourceOff"));
		return;
	}
	return config;
};
/**
* Drive MSP in-process with `msp-ts`: no child process, no Python, no stdout parsing.
*
* The Python bridge stays in `python/msp_bridge.py` for hosts without a Node MSP build,
* but it is no longer the path the service takes — one less moving part, one less install step.
*/
/** 上一次启动的节点。插件会重载，旧节点不停就会占着租约和端口，新节点抢不到连接。 */
let currentNode = null;
async function runMsp(ctx, signal) {
	const config = available(ctx);
	if (!config) return;
	if (currentNode) {
		try {
			currentNode.stop();
		} catch {}
		currentNode = null;
		setMspMesh(null);
	}
	const globs = (config.paths ?? []).map((entry) => entry?.path).filter(Boolean);
	const patterns = globs.length > 0 ? globs : ["**"];
	let node;
	try {
		node = new (await (import("./dist-DCofPM3K.js"))).MSPNode(config.nodeName, { connectPolicy: "eager" });
	} catch (error) {
		ctx.report("msp", {
			state: "error",
			detail: `msp-ts unavailable: ${String(error).slice(0, 200)}`
		});
		return;
	}
	let seen = 0;
	const recent = /* @__PURE__ */ new Map();
	const DEDUPE_WINDOW_MS = 6e4;
	let suppressed = 0;
	for (const pattern of patterns) node.on(pattern, (sig) => {
		ctx.report("msp", {
			state: "ready",
			detail: `hit ${pattern}: ${JSON.stringify(sig).slice(0, 140)}`
		});
		if (signal.aborted) return;
		const key = `${String(sig?.path)}|${String((sig?.payload)?.name ?? "")}|${String((sig?.payload)?.bytes ?? "")}`;
		const at = Date.now();
		if (at - (recent.get(key) ?? 0) < DEDUPE_WINDOW_MS) {
			suppressed += 1;
			return;
		}
		recent.set(key, at);
		if (recent.size > 500) {
			for (const [k, v] of recent) if (at - v > DEDUPE_WINDOW_MS) recent.delete(k);
		}
		const trigger = mspTrigger({
			node: sig?.source ?? config.nodeName,
			path: sig?.path,
			at: typeof sig?.at === "number" ? new Date(sig.at).toISOString() : sig?.at,
			payload: sig?.payload
		}, config);
		if (!trigger) return;
		const path = String(trigger.meta.mspPath ?? "");
		const hits = matchTacit(path, { context: signalContext(trigger, path) });
		const count = (kind) => hits.filter((hit) => hit.kind === kind).length;
		seen += 1;
		ctx.report("msp", {
			state: "ready",
			detail: `listening: ${patterns.join(", ")} · seen ${seen} · tacit M${count("mem")}/E${count("exp")}/S${count("skill")}${hits.length ? ` · ${hits.map((hit) => hit.id).join(",")}` : ""} · path ${path}${suppressed ? ` · 去重 ${suppressed}` : ""}`
		});
		Promise.resolve(ctx.receive(trigger)).then((result) => {
			ctx.report("msp", {
				state: "ready",
				detail: `recv ${JSON.stringify(result).slice(0, 160)}`
			});
		}).catch((error) => {
			ctx.report("msp", {
				state: "error",
				detail: `receive failed: ${String(error).slice(0, 240)}`
			});
		});
	});
	try {
		await node.start();
	} catch (error) {
		ctx.report("msp", {
			state: "error",
			detail: `msp node start failed: ${String(error).slice(0, 200)}`
		});
		return;
	}
	currentNode = node;
	setMspMesh(node);
	ctx.report("msp", {
		state: "ready",
		detail: `listening: ${patterns.join(", ")}`
	});
	signal.addEventListener("abort", () => {
		try {
			node.stop();
		} catch {}
		if (mspMesh() === node) setMspMesh(null);
	}, { once: true });
}
const name = "dsh-superagent-msp";
const inject = ["orchestrator"];
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(mspKind), "msp: source kind");
	ctx.inject(["tools"], (tctx) => {
		const tools = tctx.tools;
		const disposers = [
			...registerExperienceTools(tools),
			...registerTacitTools(tools),
			...registerMspActTools(tools)
		];
		tctx.effect(() => () => {
			for (const dispose of disposers) try {
				dispose();
			} catch {}
		}, "msp: tacit + act tools");
	});
	ctx.effect(() => {
		const controller = new AbortController();
		const running = runMsp(sourceContext(ctx.orchestrator, mspKind), controller.signal);
		return async () => {
			controller.abort();
			await running;
		};
	});
}
export { MspConfigSchema, SOURCE, apply, inject, mspKind, mspTrigger, mspTriggerId, name, runMsp, topicOf };
