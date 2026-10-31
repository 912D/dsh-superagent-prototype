/**
 * MSP source kind: the machine itself speaks.
 *
 * Every other Source in this prototype is a remote API we *poll* (`github-trigger.ts`,
 * `feishu-loops.ts` → `poll.ts`). MSP is the other shape: a local node network where the
 * publisher pushes and never learns who received it. So this kind has **no cursor, no
 * polling horizon, and no backoff** — a signal either arrives or the node is gone.
 *
 * The transport is a Python bridge (`python/msp_bridge.py`) printing one JSON line per
 * signal on stdout. That keeps the wire format of MSP in its own implementation instead of
 * re-deriving it here, and it costs one child process.
 *
 * Trigger mapping: one signal → one Trigger. `threads[0]` is the signal's *topic* (the first
 * two path segments, e.g. `file.created`), so follow-ups on the same topic reach the same
 * Worker through the existing subscription/direct-pass machinery.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createInterface } from 'node:readline'

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

import type { Trigger } from '../core/index.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { Localized, SourceKind } from './kind.ts'
import { experienceBlock, matchExperiences } from './experiences.ts'
import { registerExperienceTools } from './experience-tools.ts'

export const SOURCE = 'msp'

export const MspConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Signal path globs the bridge subscribes to; `**` is everything the node hears.
   *  The panel edits this as `rows` with one `path` column, so the stored shape is objects. */
  paths: z.array(z.object({ path: z.string() })).default([{ path: '**' }]),
  /** Python executable that has `msp` importable. */
  python: z.string().default('python'),
  /** Path to the bridge script, relative to the package root unless absolute. */
  bridge: z.string().default('python/msp_bridge.py'),
  /** Name this node announces under; a second Super-agent on the machine needs another. */
  nodeName: z.string().default('superagent'),
  /** Signals whose payload marks a person as the author become human Triggers. */
  humanPaths: z.array(z.string()).default(['human.message', 'notify.message']),
})
export type MspConfig = z.infer<typeof MspConfigSchema>

/** The topic a signal belongs to: `file.created.C:\x\y.zip` → `file.created`. */
export const topicOf = (path: string): string => {
  const parts = String(path ?? '').split('.').filter(Boolean)
  return parts.length <= 2 ? parts.join('.') || 'msp' : parts.slice(0, 2).join('.')
}

/** Deterministic id so a bridge restart that replays a signal does not double-open a ticket. */
export const mspTriggerId = (node: string, path: string, at: string, payload: unknown): string =>
  `msp:${node}:${path}:${at}:${JSON.stringify(payload ?? null).slice(0, 120)}`

/** Turns one bridge line into the domain's Trigger; exposed for tests. */
export function mspTrigger(event: {
  node?: string; path?: string; at?: string; payload?: unknown; human?: boolean
}, config: Pick<MspConfig, 'humanPaths'>): Trigger | undefined {
  const path = String(event.path ?? '').trim()
  if (!path) return undefined
  const at = typeof event.at === 'string' && !Number.isNaN(Date.parse(event.at)) ? event.at : new Date().toISOString()
  const node = String(event.node ?? 'msp')
  const payload = event.payload ?? {}
  const human = event.human === true || config.humanPaths.some(prefix => path === prefix || path.startsWith(`${prefix}.`))
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload).slice(0, 2000)
  return {
    id: mspTriggerId(node, path, at, payload),
    source: SOURCE,
    threads: [{ source: SOURCE, id: topicOf(path) }],
    // A machine signal has no sender: an empty actor id makes it a senderless
    // event, which the Policy admits as an `inferred` candidate instead of
    // pretending a person asked for work.
    actor: { source: SOURCE, id: human ? node : '' },
    human,
    addressed: human ? 'direct' : undefined,
    at,
    text: `${path}\n${text}`,
    meta: { mspPath: path, mspNode: node, mspPayload: payload, topic: topicOf(path) },
  }
}

export const mspKind: SourceKind<MspConfig> = {
  kind: SOURCE,
  title: { zh: '本机 MSP 节点', en: 'Local MSP nodes' },
  description: {
    zh: '本机软件主动推来的信号（文件、剪贴板、进程、任何宣告了自己的节点）。不轮询。',
    en: 'Signals pushed by local software (files, clipboard, processes, any node that announces itself). No polling.',
  },
  schema: MspConfigSchema,
  fields: [
    { key: 'paths', label: { zh: '订阅的信号路径', en: 'Signal paths' }, hint: { zh: '例如 **、file.**、notify.message', en: 'e.g. **, file.**, notify.message' }, type: 'rows', columns: [{ key: 'path', label: { zh: '路径', en: 'Path' }, type: 'text' }] },
    { key: 'nodeName', label: { zh: '本节点名称', en: 'Node name' }, type: 'text' },
    { key: 'python', label: { zh: 'Python 可执行文件', en: 'Python executable' }, type: 'text', advanced: true },
    { key: 'bridge', label: { zh: '桥接脚本', en: 'Bridge script' }, type: 'text', advanced: true },
  ],
  health: ['msp'],
  /**
   * Every MSP signal is in scope and observed (we produce all of them, there is no
   * membership list to filter by). `row` names the admission row the Policy looks up:
   * `policy.sources.msp.admission.ambient.unlistedUnaddressed` must be `inferred`,
   * otherwise machine events are ignored — see README.md.
   */
  scope: () => ({ listened: true, observed: true, row: 'ambient' }),
  environment: {
    variables: [{ key: 'DSH_SUPERAGENT_MSP_TOPIC', description: { zh: '触发本工单的 MSP 信号主题', en: 'The MSP topic that started this ticket' } }],
    values: ({ trigger }) => ({ DSH_SUPERAGENT_MSP_TOPIC: trigger?.source === SOURCE ? String(trigger.meta.topic ?? '') : '' }),
  },
}

const available = (ctx: SourceContext): MspConfig | undefined => {
  const config = ctx.config<MspConfig>(SOURCE)
  if (!config || config.enabled === false) {
    ctx.report('msp', health('paused', 'sourceOff'))
    return undefined
  }
  return config
}

/** Reads the bridge's stdout as newline-delimited JSON and feeds each signal to the Engine. */
export function runMsp(ctx: SourceContext, signal: AbortSignal): Promise<unknown> {
  return new Promise(resolve => {
    let child: ChildProcessByStdio<null, Readable, Readable>
    let seen = 0
    let stopped = false
    const finish = (): void => { stopped = true; resolve(undefined) }
    const config = available(ctx)
    if (!config) return finish()

    const paths = (config.paths ?? []).map(entry => entry?.path).filter(Boolean)
    const globs = paths.length > 0 ? paths : ['**']
    try {
      child = spawn(config.python, [config.bridge, '--node', config.nodeName, ...globs.flatMap(path => ['--path', path])], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      ctx.report('msp', { state: 'error', detail: `bridge failed to start: ${String(error)}` })
      return finish()
    }

    ctx.report('msp', health('starting', 'setupPending'))
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      if (stopped) return
      const trimmed = line.trim()
      if (!trimmed) return
      let event: Record<string, unknown>
      try { event = JSON.parse(trimmed) as Record<string, unknown> } catch { return }
      if (event.ready === true) { ctx.report('msp', { state: 'ready', detail: `listening: ${globs.join(', ')}` }); return }
      const trigger = mspTrigger(event, config)
      if (!trigger) {
        ctx.report('msp', { state: 'error', detail: `signal ignored: ${trimmed.slice(0, 160)}` })
        return
      }
      // 经验：只把**命中这条信号**的经验拼进评估上下文。
      // 没命中的一个字都不进 prompt，所以经验越多，提示词不会越长。
      const hits = matchExperiences(trigger.meta.mspPath as string, trigger.meta as Record<string, unknown>)
      const block = experienceBlock(hits)
      if (block) trigger.text = `${trigger.text}
${block}`
      seen += 1
      ctx.report('msp', {
        state: 'ready',
        detail: `listening: ${globs.join(', ')} · seen ${seen}${hits.length ? ` · 经验 ${hits.map(h => h.id).join(',')}` : ''}`,
      })
      Promise.resolve(ctx.receive(trigger)).catch(error => {
        // 吞掉异常会让「没进 Engine」变成黑盒：把它写进 health，面板上直接看得见。
        ctx.report('msp', { state: 'error', detail: `receive failed: ${String(error).slice(0, 240)}` })
      })
    })
    child.stderr.on('data', chunk => {
      const text = String(chunk).trim()
      if (text) ctx.report('msp', { state: 'paused', detail: text.slice(0, 300) })
    })
    const stop = (detail: string): void => {
      if (stopped) return
      ctx.report('msp', { state: 'error', detail })
      finish()
    }
    child.on('error', error => stop(String(error)))
    child.on('exit', code => stop(`bridge exited (${code ?? 'signal'})`))
    signal.addEventListener('abort', () => { stopped = true; child.kill(); finish() }, { once: true })
  })
}

export const name = 'dsh-superagent-msp'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(mspKind), 'msp: source kind')

  // 经验的 CRUD：模型能自己读、写、改、停用——否则经验库只能靠人喂，永远长不大。
  ctx.inject(['tools'], (tctx: Context) => {
    const disposers = registerExperienceTools((tctx as unknown as { tools: { register(def: unknown): unknown } }).tools)
    tctx.effect(() => () => {
      for (const dispose of disposers) {
        try { (dispose as () => void)() } catch { /* 已摘除 */ }
      }
    }, 'msp: experience tools')
  })
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runMsp(sourceContext(ctx.orchestrator, mspKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}

export type { Localized }
