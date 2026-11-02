import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
// src/sources/tacit.ts
/**
* 经验层：Mem + Exp + SKILL —— 三库同格式，**命中才注入**。
*
* 为什么是一层而不是三个功能：三者回答的是同一个问题——「这次情境，我上次是怎么处理的」。
* 拆成三套实现，就会出现三份解析器、三种命中规则、三处注入点，最后谁也没被真正用上
* （这正是上一版「经验 → 行为改变：未验证」的根因：注入只写在 MSP 源里，别的来源永远拿不到）。
*
*   记忆 Mem    事实：这个目录、这台机器、这个人，已知是什么
*   经验 Exp    规则：「当…就…」+ 理由，可执行、有边界、条件可判定
*   技能 SKILL  流程：一段可复用的操作手册，命中时把步骤摆到面前
*
* 三者共用一套 front-matter、一套路径匹配、一个注入点（`enrichTrigger`），
* 所以「加一类知识」不需要改代码，只需要往对应目录放一个 `.md`。
*
* 目录（都可用环境变量覆盖，便于测试与多实例）：
*   $TACIT_DIR/memories    $TACIT_MEM_DIR
*   $TACIT_DIR/experiences $TACIT_EXPERIENCE_DIR
*   $TACIT_DIR/skills      $TACIT_SKILL_DIR
* 默认 `$TACIT_DIR = ~/.dsh/tacit`。设 `TACIT_DISABLED=1` 整体关闭。
*/
const TACIT_KINDS = [
	"mem",
	"exp",
	"skill"
];
const KIND_DIR = {
	mem: "memories",
	exp: "experiences",
	skill: "skills"
};
const KIND_ENV = {
	mem: "TACIT_MEM_DIR",
	exp: "TACIT_EXPERIENCE_DIR",
	skill: "TACIT_SKILL_DIR"
};
/** 每个信号最多注入几条：注入是加在 trigger.text 上的，多了会挤掉当事人自己说的话。 */
const KIND_LIMIT = {
	mem: 2,
	exp: 3,
	skill: 2
};
/** 一段注入块最多多长（字符）。评估侧对 trigger.text 有 4000 字截断，块必须远小于它。 */
const BLOCK_LIMIT = 1200;
const tacitRoot = () => process.env.TACIT_DIR?.trim() || join(homedir(), ".dsh", "tacit");
/** 某一类知识的目录；空字符串的覆盖当没设，免得把库写进 CWD。 */
function tacitDir(kind) {
	const override = process.env[KIND_ENV[kind]]?.trim();
	return override ? override : join(tacitRoot(), KIND_DIR[kind]);
}
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
function parseFront(header) {
	const front = {};
	for (const line of header.split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
		if (pair?.[1] !== void 0) front[pair[1]] = (pair[2] ?? "").trim();
	}
	return front;
}
/** 解析一条 `.md`；格式不对、显式停用、没写 trigger 的，都当不存在（宁可漏，不可误命中）。 */
function parseTacit(text, kind, file) {
	const match = FRONT_MATTER.exec(text);
	if (!match) return void 0;
	const front = parseFront(match[1] ?? "");
	const body = (match[2] ?? "").trim();
	const fallbackId = file.replace(/.*[\\/]/, "").replace(/\.md$/i, "");
	const id = front.id || fallbackId;
	if (!id || !front.trigger) return void 0;
	if ((front.enabled ?? "true").toLowerCase() === "false") return void 0;
	const action = front.action ?? front.fact ?? front.value ?? "";
	if (!action && kind !== "skill") return void 0;
	return {
		kind,
		id,
		trigger: front.trigger,
		condition: front.condition ?? "true",
		action,
		trust: (front.trust_level ?? "L3").toUpperCase(),
		title: (/^#\s+(.+)$/m.exec(body)?.[1] ?? id).trim(),
		body,
		file
	};
}
/** 读整个目录；目录不存在、单条坏文件，都只跳过，不抛错。 */
function loadTacit(kind, dir = tacitDir(kind)) {
	let names;
	try {
		names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md")).sort();
	} catch {
		return [];
	}
	const out = [];
	for (const name of names) {
		const file = join(dir, name);
		try {
			if (!statSync(file).isFile()) continue;
			const parsed = parseTacit(readFileSync(file, "utf8"), kind, file);
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
	if (t.endsWith(".**")) {
		const head = t.slice(0, -3);
		return path === head || path.startsWith(`${head}.`);
	}
	if (t.includes("*")) return new RegExp(`^${t.split(".").map((part) => part === "*" ? "[^.]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\.")}$`).test(path);
	if (path === t || path.startsWith(`${t}.`)) return true;
	const want = t.split(".");
	const got = path.split(".");
	return want.length === got.length && want.length > 1 && want.slice(0, -1).join(".") === got.slice(0, -1).join(".");
}
/** 条件只支持 `true` / `false`、`字段 == 值`、`字段 in [..]`；看不懂的一律不命中（凭猜行动比不动更糟）。 */
function conditionHolds(condition, context) {
	const c = String(condition ?? "true").trim();
	if (!c || c === "true") return true;
	if (c === "false") return false;
	const pick = (path) => path.split(".").reduce((acc, key) => acc && typeof acc === "object" ? acc[key] : void 0, context);
	const unquote = (value) => value.trim().replace(/^["']|["']$/g, "");
	const eq = /^([A-Za-z_][\w.]*)\s*==\s*(.+)$/.exec(c);
	if (eq?.[1] !== void 0) return String(pick(eq[1]) ?? "") === unquote(eq[2] ?? "");
	const inList = /^([A-Za-z_][\w.]*)\s+in\s+\[(.*)\]$/.exec(c);
	if (inList?.[1] !== void 0) return (inList[2] ?? "").split(",").map((part) => unquote(part).toLowerCase()).includes(String(pick(inList[1]) ?? "").toLowerCase());
	return false;
}
/** 命中这个信号路径的所有条目，按「记忆 → 经验 → 技能」、同类按 id 排序。 */
function matchTacit(path, query = {}) {
	const kinds = query.kinds ?? TACIT_KINDS;
	const context = query.context ?? {};
	const hits = [];
	for (const kind of kinds) {
		const dir = query.dirs?.[kind];
		const entries = loadTacit(kind, dir ?? tacitDir(kind)).filter((entry) => triggerMatches(entry.trigger, path) && conditionHolds(entry.condition, context)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.limit?.[kind] ?? KIND_LIMIT[kind]);
		hits.push(...entries);
	}
	return hits;
}
const HEADER = {
	mem: "[记忆 · 这次情境的已知事实]",
	exp: "[经验 · 命中这些就按它办]",
	skill: "[技能 · 命中就按这套流程做]"
};
/** 拼成给模型看的一小段；没命中返回空串。块长有上限，超了先砍技能正文（它是唯一可以「去文档里读」的）。 */
function tacitBlock(hits) {
	if (hits.length === 0) return "";
	const lines = [""];
	for (const kind of TACIT_KINDS) {
		const group = hits.filter((entry) => entry.kind === kind);
		if (group.length === 0) continue;
		lines.push(HEADER[kind]);
		for (const entry of group) {
			if (kind === "mem") {
				lines.push(`- ${entry.id}：${entry.action || entry.title}`);
				continue;
			}
			if (kind === "exp") {
				lines.push(`- ${entry.id}（${entry.trust}）：当 ${entry.trigger}${entry.action ? `，就 ${entry.action}` : ""}`);
				if (entry.title && entry.title !== entry.id) lines.push(`  理由：${entry.title}`);
				continue;
			}
			lines.push(`- ${entry.id}：${entry.title}`);
			const steps = entry.body.replace(/^#.*$/gm, "").trim();
			if (steps) lines.push(`  流程：${steps.split(/\r?\n/).filter(Boolean).slice(0, 6).join(" / ").slice(0, 320)}`);
		}
	}
	const block = lines.join("\n");
	if (block.length <= BLOCK_LIMIT) return block;
	const clipped = block.slice(0, BLOCK_LIMIT);
	const boundary = clipped.lastIndexOf("\n");
	return `${boundary > 0 ? clipped.slice(0, boundary) : clipped}\n（还有更多，去 tacit 目录读）`;
}
/** 命中各类的 id，写进 trigger.meta，供决策记录与消融实验查「这条到底生效了没有」。 */
function tacitIds(hits) {
	const ids = {
		mem: [],
		exp: [],
		skill: []
	};
	for (const hit of hits) ids[hit.kind].push(hit.id);
	return ids;
}
/** 这次信号该用哪条路径去匹配：源自己声明的路径优先，否则退到主线程 id（源原生的话题名）。 */
function signalPathOf(trigger) {
	const meta = trigger.meta ?? {};
	for (const key of [
		"mspPath",
		"path",
		"signalPath"
	]) {
		const value = meta[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return trigger.threads[0]?.id ?? "";
}
/** 条件判定用的上下文：源原生字段 + 从文件名里析出的扩展名，够写 `file.extension in [..]`。 */
function signalContext(trigger, path) {
	const meta = trigger.meta ?? {};
	const payload = meta.mspPayload ?? meta.payload ?? {};
	const named = String(payload.name ?? payload.path ?? trigger.url ?? "");
	const extension = named.includes(".") ? (named.split(".").pop() ?? "").toLowerCase() : "";
	return {
		...meta,
		source: trigger.source,
		actor: trigger.actor,
		url: trigger.url,
		payload,
		file: {
			name: named,
			extension
		},
		signal: { path }
	};
}
/**
* 注入：命中才把块接到 `trigger.text` 末尾，并把命中 id 写进 `meta.tacit`。
* 不命中就原样返回同一个对象——没命中时一个字都不进提示词，库才会越攒越大而不撑爆上下文。
*/
function enrichTrigger(trigger, options = {}) {
	if (options.disabled ?? process.env.TACIT_DISABLED === "1") return trigger;
	try {
		const path = signalPathOf(trigger);
		if (!path) return trigger;
		const hits = matchTacit(path, { context: signalContext(trigger, path) });
		if (hits.length === 0) return trigger;
		const block = tacitBlock(hits);
		const ids = tacitIds(hits);
		return {
			...trigger,
			text: `${trigger.text}${block}`,
			meta: {
				...trigger.meta,
				tacit: ids,
				tacitChars: block.length,
				tacitBlock: block,
				experience: ids.exp,
				experienceLoaded: loadTacit("exp").length
			}
		};
	} catch {
		return trigger;
	}
}
export { signalContext as a, parseTacit as i, enrichTrigger as n, tacitDir as o, matchTacit as r, TACIT_KINDS as t };
