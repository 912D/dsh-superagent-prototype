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
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = (): string => process.env.TACIT_EXPERIENCE_DIR ?? join(homedir(), '.dsh', 'tacit', 'experiences')
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const LEVELS = ['L1', 'L2', 'L3', 'L4']

interface Draft {
  id: string
  trigger: string
  condition?: string
  action: string
  trust?: string
  title?: string
  body?: string
}

function render(d: Draft): string {
  return [
    '---',
    `id: ${d.id}`,
    `trigger: ${d.trigger}`,
    `condition: ${d.condition ?? 'true'}`,
    `action: ${(d.action ?? '').replace(/\s*\n\s*/g, ' ').trim()}`,
    `trust_level: ${d.trust ?? 'L3'}`,
    'scope: local',
    'enabled: true',
    `taught_by: agent`,
    `taught_at: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${d.title ?? d.action.slice(0, 40)}`,
    '',
    d.body ?? '',
    '',
  ].join('\n')
}

function clampTrust(input: string | undefined): string {
  const level = String(input ?? 'L3').toUpperCase()
  if (!LEVELS.includes(level)) return 'L3'
  // 模型自建的经验不许直接拿 L1/L2：那是可以不经人点头就行动的等级。
  return level === 'L1' || level === 'L2' ? 'L3' : level
}

const OUT = { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false }

/** 这组的注册函数由 msp.ts 在 `ctx.inject(['tools'])` 里调用。 */
export function registerExperienceTools(tools: { register(def: unknown): unknown }): (() => void)[] {
  const disposers: (() => void)[] = []
  const dir = DIR()

  const list = () => {
    try {
      return readdirSync(dir).filter(n => n.endsWith('.md')).map(n => n.replace(/\.md$/, '')).sort()
    } catch {
      return []
    }
  }

  const read = (id: string) => {
    try {
      return readFileSync(join(dir, `${id}.md`), 'utf8')
    } catch {
      return undefined
    }
  }

  disposers.push(
    tools.register({
      name: 'experience_list',
      description: '列出本机经验库里的所有经验 id。经验是「当…就…」的规则，会按信号路径自动命中并注入上下文。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.ids.join('\n') }] },
      execute: async () => {
        const ids = list()
        return { content: [{ type: 'text', text: ids.join('\n') }], structuredContent: { ids } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'experience_read',
      description: '读一条经验的完整内容（含条件、动作、等级和正文）。',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.text }] },
      execute: async (args: any) => {
        const text = read(String(args?.id ?? ''))
        return { content: [{ type: 'text', text: text ?? '(没有这条经验)' }], structuredContent: { text: text ?? '', found: Boolean(text) } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'experience_create',
      description: '新建一条经验。只在「这次判断有可复用的理由」时用：一条规则一个文件，别攒大杂烩。新建的等级最高 L3。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '小写字母数字和连字符，例如 installer-ask' },
          trigger: { type: 'string', description: '信号路径，支持 file.** 或 file.created' },
          action: { type: 'string', description: '命中后做什么' },
          condition: { type: 'string', description: '可选，默认 true' },
          trust_level: { type: 'string', enum: LEVELS, description: '默认 L3' },
          title: { type: 'string' },
          body: { type: 'string', description: '为什么——这条经验的理由' },
        },
        required: ['id', 'trigger', 'action'],
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.message }] },
      execute: async (args: any) => {
        const id = String(args?.id ?? '')
        if (!ID_RE.test(id)) {
          return { content: [{ type: 'text', text: `id 不合法：${id}` }], structuredContent: { ok: false, message: 'id 不合法' } }
        }
        if (existsSync(join(dir, `${id}.md`))) {
          return { content: [{ type: 'text', text: `已存在同 id 的经验：${id}，要改请用 experience_update` }], structuredContent: { ok: false, message: '已存在' } }
        }
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${id}.md`), render({
          id,
          trigger: String(args.trigger),
          condition: args.condition ? String(args.condition) : undefined,
          action: String(args.action),
          trust: clampTrust(args.trust_level),
          title: args.title ? String(args.title) : undefined,
          body: args.body ? String(args.body) : undefined,
        }), 'utf8')
        return { content: [{ type: 'text', text: `已写入 ${id}.md` }], structuredContent: { ok: true, message: `已写入 ${id}.md`, id } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'experience_update',
      description: '改一条已有经验。只传要改的字段；等级可以上调到 L1，但下调到 L1 需要人来做，这里最高 L3。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          trigger: { type: 'string' },
          action: { type: 'string' },
          condition: { type: 'string' },
          trust_level: { type: 'string', enum: LEVELS },
          body: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.message }] },
      execute: async (args: any) => {
        const id = String(args?.id ?? '')
        const text = read(id)
        if (!text) return { content: [{ type: 'text', text: `没有这条经验：${id}` }], structuredContent: { ok: false, message: '没有' } }
        const patch: Record<string, string> = {}
        for (const key of ['trigger', 'action', 'condition']) if (typeof args?.[key] === 'string') patch[key] = args[key]
        let out = text
        for (const [key, value] of Object.entries(patch)) out = out.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value.replace(/\s*\n\s*/g, ' ')}`)
        if (typeof args?.trust_level === 'string') out = out.replace(/^trust_level:.*$/m, `trust_level: ${clampTrust(args.trust_level)}`)
        writeFileSync(join(dir, `${id}.md`), out, 'utf8')
        return { content: [{ type: 'text', text: `已更新 ${id}` }], structuredContent: { ok: true, message: `已更新 ${id}`, id } }
      },
    }) as () => void,
  )

  disposers.push(
    tools.register({
      name: 'experience_disable',
      description: '停用一条经验（软删，文件留着）。它不会再被命中，但还能查回来。真删要人来做。',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      output: { schema: OUT, render: (_a: unknown, v: any) => [{ type: 'text', text: v.structuredContent.message }] },
      execute: async (args: any) => {
        const id = String(args?.id ?? '')
        const text = read(id)
        if (!text) return { content: [{ type: 'text', text: `没有这条经验：${id}` }], structuredContent: { ok: false, message: '没有' } }
        const out = /^enabled:/m.test(text) ? text.replace(/^enabled:.*$/m, 'enabled: false') : text.replace(/^---\n/, '---\nenabled: false\n')
        writeFileSync(join(dir, `${id}.md`), out, 'utf8')
        return { content: [{ type: 'text', text: `已停用 ${id}` }], structuredContent: { ok: true, message: `已停用 ${id}`, id } }
      },
    }) as () => void,
  )

  return disposers
}
