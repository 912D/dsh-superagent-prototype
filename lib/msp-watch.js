import { n as sourceContext, t as health } from "./host-0nmqScOI.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import "node:child_process";
import { homedir } from "node:os";
import "node:readline";
//#region src/sources/experiences.ts
/**
* 经验库：读 `~/.dsh/tacit/experiences/*.md`，按信号路径匹配。
*
* 一条经验是「条件 + 动作 + 理由」：
*
*   ---
*   id: zip-archive
*   trigger: file.created
*   condition: true          # 目前只认 true / 简单 == 比较
*   action: 归到 archive/zip 下
*   trust_level: L3
*   ---
*   # 标题
*   理由正文
*
* 命中才注入评估上下文：没命中的经验一个字都不进 prompt，
* 所以经验可以越攒越多，提示词不会越来越长。
*/
const DIR$1 = () => process.env.TACIT_EXPERIENCE_DIR ?? join(homedir(), ".dsh", "tacit", "experiences");
function parse(text, file) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!m) return void 0;
	const front = {};
	for (const line of m[1].split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
		if (pair) front[pair[1]] = pair[2].trim();
	}
	const body = m[2].trim();
	const id = front.id || file.replace(/\.md$/i, "");
	if (!id || !front.trigger) return void 0;
	if (front.enabled === "false") return void 0;
	return {
		id,
		trigger: front.trigger,
		condition: front.condition ?? "true",
		action: front.action ?? "",
		trust: (front.trust_level ?? "L3").toUpperCase(),
		title: (/^#\s+(.+)$/m.exec(body)?.[1] ?? id).trim(),
		body,
		file
	};
}
/** 读整个目录；目录不存在就当没有经验，不抛错。 */
function loadExperiences(dir = DIR$1()) {
	let names;
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".md"));
	} catch {
		return [];
	}
	const out = [];
	for (const name of names) {
		const file = join(dir, name);
		try {
			if (!statSync(file).isFile()) continue;
			const parsed = parse(readFileSync(file, "utf8"), file);
			if (parsed) out.push(parsed);
		} catch {}
	}
	return out;
}
/** `file.*` 匹配 file.created；`file.created` 精确匹配；`**` 全收。 */
function triggerMatches(trigger, path) {
	const t = String(trigger ?? "").trim();
	if (!t || !path) return false;
	if (t === "**" || t === "*") return true;
	if (t.endsWith(".**")) return path === t.slice(0, -3) || path.startsWith(t.slice(0, -2));
	if (t.includes("*")) return new RegExp(`^${t.split(".").map((s) => s === "*" ? "[^.]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\.")}$`).test(path);
	if (path === t || path.startsWith(`${t}.`)) return true;
	const want = t.split(".");
	const got = path.split(".");
	return want.length === got.length && want.length > 1 && want.slice(0, -1).join(".") === got.slice(0, -1).join(".");
}
/** 条件只支持 `true` 与 `字段 == 值`，够用且不会误判。 */
function conditionHolds(condition, context) {
	const c = String(condition ?? "true").trim();
	if (!c || c === "true") return true;
	if (c === "false") return false;
	const pick = (path) => path.split(".").reduce((acc, key) => acc && typeof acc === "object" ? acc[key] : void 0, context);
	const eq = /^([A-Za-z_][\w.]*)\s*==\s*(.+)$/.exec(c);
	if (eq) return String(pick(eq[1]) ?? "") === eq[2].trim().replace(/^["']|["']$/g, "");
	const inList = /^([A-Za-z_][\w.]*)\s+in\s+\[(.*)\]$/.exec(c);
	if (inList) return inList[2].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "").toLowerCase()).includes(String(pick(inList[1]) ?? "").toLowerCase());
}
/** 命中这个信号的经验，按 id 排序，最多 `limit` 条。 */
function matchExperiences(path, context, limit = 3) {
	return loadExperiences().filter((exp) => triggerMatches(exp.trigger, path) && conditionHolds(exp.condition, context)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}
/** 拼成给模型看的一小段；没有命中就返回空串。 */
function experienceBlock(matches) {
	if (matches.length === 0) return "";
	const lines = ["", "[经验 · 命中这些就按它办]"];
	for (const exp of matches) {
		lines.push(`- ${exp.id}（${exp.trust}）：当 ${exp.trigger}${exp.action ? `，就 ${exp.action}` : ""}`);
		if (exp.title && exp.title !== exp.id) lines.push(`  理由：${exp.title}`);
	}
	return lines.join("\n");
}
//#endregion
//#region src/sources/experience-tools.ts
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
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const LEVELS = [
	"L1",
	"L2",
	"L3",
	"L4"
];
function render(d) {
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
function clampTrust(input) {
	const level = String(input ?? "L3").toUpperCase();
	if (!LEVELS.includes(level)) return "L3";
	return level === "L1" || level === "L2" ? "L3" : level;
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
	const read = (id) => {
		try {
			return readFileSync(join(dir, `${id}.md`), "utf8");
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
			schema: OUT,
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
			schema: OUT,
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
					enum: LEVELS,
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
			schema: OUT,
			render: (_a, v) => [{
				type: "text",
				text: v.structuredContent.message
			}]
		},
		execute: async (args) => {
			const id = String(args?.id ?? "");
			if (!ID_RE.test(id)) return {
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
			writeFileSync(join(dir, `${id}.md`), render({
				id,
				trigger: String(args.trigger),
				condition: args.condition ? String(args.condition) : void 0,
				action: String(args.action),
				trust: clampTrust(args.trust_level),
				title: args.title ? String(args.title) : void 0,
				body: args.body ? String(args.body) : void 0
			}), "utf8");
			return {
				content: [{
					type: "text",
					text: `已写入 ${id}.md`
				}],
				structuredContent: {
					ok: true,
					message: `已写入 ${id}.md`,
					id
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
					enum: LEVELS
				},
				body: { type: "string" }
			},
			required: ["id"],
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
			for (const [key, value] of Object.entries(patch)) out = out.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value.replace(/\s*\n\s*/g, " ")}`);
			if (typeof args?.trust_level === "string") out = out.replace(/^trust_level:.*$/m, `trust_level: ${clampTrust(args.trust_level)}`);
			writeFileSync(join(dir, `${id}.md`), out, "utf8");
			return {
				content: [{
					type: "text",
					text: `已更新 ${id}`
				}],
				structuredContent: {
					ok: true,
					message: `已更新 ${id}`,
					id
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
			schema: OUT,
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
			const out = /^enabled:/m.test(text) ? text.replace(/^enabled:.*$/m, "enabled: false") : text.replace(/^---\n/, "---\nenabled: false\n");
			writeFileSync(join(dir, `${id}.md`), out, "utf8");
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
//#endregion
//#region src/sources/msp.ts
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
	}
	const globs = (config.paths ?? []).map((entry) => entry?.path).filter(Boolean);
	const patterns = globs.length > 0 ? globs : ["**"];
	let node;
	try {
		node = new (await (import("./dist-Dsd-G9IU.js"))).MSPNode(config.nodeName, { connectPolicy: "eager" });
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
		const payload = trigger.meta.mspPayload ?? {};
		const named = String(payload.name ?? payload.path ?? "");
		const extension = named.includes(".") ? named.split(".").pop().toLowerCase() : "";
		const hits = matchExperiences(trigger.meta.mspPath, {
			...trigger.meta,
			payload,
			file: {
				name: named,
				extension
			},
			signal: { path: trigger.meta.mspPath }
		});
		const block = experienceBlock(hits);
		if (block) trigger.text = `${trigger.text}
${block}`;
		trigger.meta.experience = hits.map((h) => h.id);
		trigger.meta.experienceLoaded = loadExperiences().length;
		seen += 1;
		ctx.report("msp", {
			state: "ready",
			detail: `listening: ${patterns.join(", ")} · seen ${seen} · exp ${hits.length}/${loadExperiences().length}${hits.length ? ` · 经验 ${hits.map((h) => h.id).join(",")}` : ""} · path ${String(trigger.meta.mspPath)}${suppressed ? ` · 去重 ${suppressed}` : ""}`
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
	ctx.report("msp", {
		state: "ready",
		detail: `listening: ${patterns.join(", ")}`
	});
	signal.addEventListener("abort", () => {
		try {
			node.stop();
		} catch {}
	}, { once: true });
}
const name = "dsh-superagent-msp";
const inject = ["orchestrator"];
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(mspKind), "msp: source kind");
	ctx.inject(["tools"], (tctx) => {
		const disposers = registerExperienceTools(tctx.tools);
		tctx.effect(() => () => {
			for (const dispose of disposers) try {
				dispose();
			} catch {}
		}, "msp: experience tools");
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
//#endregion
export { MspConfigSchema, SOURCE, apply, inject, mspKind, mspTrigger, mspTriggerId, name, runMsp, topicOf };
