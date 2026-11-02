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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseTacit, TACIT_KINDS, tacitDir, type TacitKind } from './tacit.ts'

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const

const OUT = { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false }

/** 工具参数里的 kind 是模型给的字符串，必须窄化成三类之一。 */
function asKind(value: unknown): TacitKind | undefined {
  const kind = String(value ?? '').toLowerCase()
  return (TACIT_KINDS as readonly string[]).includes(kind) ? kind as TacitKind : undefined
}

/** 模型自建不许直接拿 L1/L2：那是可以不经人点头就行动的等级。 */
function clampTrust(input: unknown): { level: string; clamped: boolean } {
  const level = String(input ?? 'L3').toUpperCase()
  if (!(LEVELS as readonly string[]).includes(level)) return { level: 'L3', clamped: false }
  return level === 'L1' || level === 'L2' ? { level: 'L3', clamped: true } : { level, clamped: false }
}

interface Draft {
  kind: TacitKind
  id: string
  trigger: string
  condition: string
  action: string
  trust: string
  title: string
  body: string
}

function render(draft: Draft): string {
  // 记忆写 fact，其余写 action：一个键的差别，读的人一眼知道这条是「事实」还是「做法」。
  const actionKey = draft.kind === 'mem' ? 'fact' : 'action'
  return [
    '---',
    `id: ${draft.id}`,
    `trigger: ${draft.trigger}`,
    `condition: ${draft.condition}`,
    `${actionKey}: ${draft.action.replace(/\s*\n\s*/g, ' ').trim()}`,
    `trust_level: ${draft.trust}`,
    'scope: local',
    'enabled: true',
    'taught_by: agent',
    `taught_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${draft.title || draft.action.slice(0, 40)}`,
    '',
    draft.body,
    '',
  ].join('\n')
}

/** 经验层三库的读写工具；由 `msp.ts` 在 `ctx.inject(['tools'])` 里注册。 */
export function registerTacitTools(tools: { register(def: unknown): unknown }): (() => void)[] {
  const disposers: (() => void)[] = []

  /** id 来自模型，`..`、分隔符、盘符都不能进 `join`：否则读工具能读走磁盘上任意 `.md`。 */
  const fileOf = (kind: TacitKind, id: string): string | undefined =>
    ID_RE.test(id) ? join(tacitDir(kind), `${id}.md`) : undefined

  const list = (kind: TacitKind): string[] => {
    try {
      return readdirSync(tacitDir(kind)).filter(name => name.toLowerCase().endsWith('.md')).map(name => name.replace(/\.md$/i, '')).sort()
    } catch {
      return []
    }
  }

  const read = (kind: TacitKind, id: string): string | undefined => {
    const file = fileOf(kind, id)
    if (!file) return undefined
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
  }

  disposers.push(
    tools.register({
      name: 'tacit_list',
      description: '列出经验层（记忆/经验/技能）里的 id。传 kind 只看一类，不传看全部。这些条目会按信号路径自动命中并注入上下文。',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: [...TACIT_KINDS], description: 'mem=事实, exp=规则, skill=流程' } },
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.text }] },
      execute: async (args: any) => {
        const one = asKind(args?.kind)
        const groups = (one ? [one] : [...TACIT_KINDS]).map(kind => ({ kind, ids: list(kind) }))
        const text = groups.map(group => `${group.kind}: ${group.ids.length ? group.ids.join(', ') : '(空)'}`).join('\n')
        return { content: [{ type: 'text', text }], structuredContent: { groups, text } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'tacit_read',
      description: '读一条记忆/经验/技能的完整内容（front-matter + 正文）。',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: [...TACIT_KINDS] }, id: { type: 'string' } },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.text }] },
      execute: async (args: any) => {
        const kind = asKind(args?.kind)
        const id = String(args?.id ?? '')
        if (!kind) return { content: [{ type: 'text', text: '(kind 只能是 mem / exp / skill)' }], structuredContent: { text: '', found: false } }
        const text = read(kind, id)
        return { content: [{ type: 'text', text: text ?? '(没有这条)' }], structuredContent: { text: text ?? '', found: Boolean(text) } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'tacit_create',
      description: [
        '新建一条记忆/经验/技能。只在「这次判断有可复用的理由」时用：一条一个文件，别攒大杂烩。新建等级最高 L3。',
        '',
        '按 kind 选形状（写错形状等于永不命中，而且不会报错）：',
        '- mem：写事实。`action` 里放一句可核验的陈述，例如「这个目录下载的安装包一律先问再装」。',
        '- exp：写规则「当…就…」。action 必须写清「做什么 + 用什么做」，不能只写意图。',
        '- skill：写流程。title 是名字，body 是分步骤的手册（每行一步）。',
        '',
        '条件只支持 true、`字段 == 值`、`字段 in [..]`；trigger 支持 `**`、`file.*`、`file.created`。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...TACIT_KINDS] },
          id: { type: 'string', description: '小写字母数字和连字符，例如 zip-archive' },
          trigger: { type: 'string', description: '信号路径，支持 file.** 或 file.created' },
          action: { type: 'string', description: 'mem=事实；exp=命中后做什么；skill 可留空用 body' },
          condition: { type: 'string', description: '可选，默认 true' },
          trust_level: { type: 'string', enum: [...LEVELS], description: '默认 L3' },
          title: { type: 'string' },
          body: { type: 'string', description: '为什么 / 技能的分步流程' },
        },
        required: ['kind', 'id', 'trigger'],
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.message }] },
      execute: async (args: any) => {
        const kind = asKind(args?.kind)
        const id = String(args?.id ?? '')
        const trigger = String(args?.trigger ?? '').trim()
        const bad = (message: string) => ({ content: [{ type: 'text', text: message }], structuredContent: { ok: false, message } })
        if (!kind) return bad('kind 只能是 mem / exp / skill')
        if (!ID_RE.test(id)) return bad(`id 不合法：${id}（小写字母数字和连字符，2~64 位）`)
        if (!trigger) return bad('trigger 不能为空')
        const file = join(tacitDir(kind), `${id}.md`)
        if (existsSync(file)) return bad(`已存在同 id 的条目：${kind}/${id}，要改请用 tacit_update`)
        const action = String(args?.action ?? '').trim()
        const body = String(args?.body ?? '').trim()
        if (kind !== 'skill' && !action) return bad('mem / exp 必须给 action')
        if (kind === 'skill' && !action && !body) return bad('skill 至少要有 action 或 body')
        mkdirSync(tacitDir(kind), { recursive: true })
        const trust = clampTrust(args?.trust_level)
        writeFileSync(file, render({
          kind,
          id,
          trigger,
          condition: String(args?.condition ?? 'true').trim() || 'true',
          action,
          trust: trust.level,
          title: String(args?.title ?? '').trim(),
          body,
        }), 'utf8')
        const message = `已写入 ${kind}/${id}${trust.clamped ? '（L1/L2 已压到 L3：不经人点头就行动的等级只能由人上调）' : ''}`
        return { content: [{ type: 'text', text: message }], structuredContent: { ok: true, message, clamped: trust.clamped } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'tacit_disable',
      description: '停用一条记忆/经验/技能（软删：置 enabled: false）。真删要人来，因为删掉的东西没法再复盘。',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: [...TACIT_KINDS] }, id: { type: 'string' } },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.message }] },
      execute: async (args: any) => {
        const kind = asKind(args?.kind)
        const id = String(args?.id ?? '')
        const done = (message: string) => ({ content: [{ type: 'text', text: message }], structuredContent: { message } })
        if (!kind) return done('kind 只能是 mem / exp / skill')
        const file = fileOf(kind, id)
        if (!file) return done(`id 不合法：${id}`)
        const text = read(kind, id)
        if (!text) return done(`没有这条：${kind}/${id}`)
        const parsed = parseTacit(text, kind, file)
        if (!parsed) return done(`这条的 front-matter 解析不了，请人工修：${file}`)
        const next = /^enabled\s*:\s*.*$/m.test(text)
          ? text.replace(/^enabled\s*:\s*.*$/m, 'enabled: false')
          : text.replace(/^---$/m, '---\nenabled: false')
        writeFileSync(file, next, 'utf8')
        return done(`已停用 ${kind}/${id}（enabled: false）`)
      },
    }) as () => void,
  )

  return disposers
}
