/**
 * 经验层（补丁二）与接入（补丁一）的单元测试。
 *
 * 这个文件用 `node:test` 而不是 vitest，且直接跑 `.ts`（Node ≥ 24 自带类型剥离）：
 *   node --test tests/tacit.test.ts
 * 理由是它要能在**没有 node_modules** 的机器上跑——经验层是这套东西里最该被独立验证的一层，
 * 不该因为它依赖 zod 就跟着整包构建才能测。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  conditionHolds,
  enrichTrigger,
  loadTacit,
  matchTacit,
  parseTacit,
  signalPathOf,
  tacitBlock,
  tacitDir,
  triggerMatches,
} from '../src/sources/tacit.ts'
import { describePeer, peerCapabilities, setMspMesh, mspMesh } from '../src/sources/msp-act.ts'

const root = mkdtempSync(join(tmpdir(), 'tacit-test-'))
const dirs = { mem: join(root, 'memories'), exp: join(root, 'experiences'), skill: join(root, 'skills') }

function seed(kind: keyof typeof dirs, name: string, text: string): void {
  mkdirSync(dirs[kind], { recursive: true })
  writeFileSync(join(dirs[kind], name), text, 'utf8')
}

function triggerOf(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msp:node:file.created:x',
    source: 'msp',
    threads: [{ source: 'msp', id: 'file.created' }],
    actor: { source: 'msp', id: '' },
    human: false,
    at: '2026-11-02T00:00:00.000Z',
    text: 'file.created\n{"name":"a.zip"}',
    meta: { mspPath: 'file.created', mspNode: 'watcher', mspPayload: { name: 'a.zip' } },
    ...overrides,
  } as any
}

before(() => {
  seed('mem', 'downloads-dir.md', '---\nid: downloads-dir\ntrigger: file.**\ncondition: true\nfact: 这个目录下的安装包一律先问再装\ntrust_level: L3\n---\n# 下载目录\n这是事实说明。\n')
  seed('exp', 'zip-archive.md', '---\nid: zip-archive\ntrigger: file.created\ncondition: file.extension == zip\naction: 归到 archive/zip 下\ntrust_level: L3\n---\n# 压缩包要归档\n安装包不可归档。\n')
  seed('exp', 'pdf-ask.md', '---\nid: pdf-ask\ntrigger: file.created\ncondition: file.extension in [pdf, docx]\naction: 先问要不要转格式\ntrust_level: L3\n---\n# 文档先问\n')
  seed('skill', 'unzip.md', '---\nid: unzip\ntrigger: file.created\ncondition: file.extension == zip\ntrust_level: L3\n---\n# 解压并归档\n用 unzip 解到临时目录\n按类型归到 archive/ 下\n检查有没有残留\n')
  seed('exp', 'off.md', '---\nid: off\ntrigger: file.created\ncondition: true\naction: 不该生效\nenabled: false\n---\n')
  seed('exp', 'broken.md', '没有 front matter 的文件')
  process.env.TACIT_MEM_DIR = dirs.mem
  process.env.TACIT_EXPERIENCE_DIR = dirs.exp
  process.env.TACIT_SKILL_DIR = dirs.skill
})

after(() => {
  delete process.env.TACIT_MEM_DIR
  delete process.env.TACIT_EXPERIENCE_DIR
  delete process.env.TACIT_SKILL_DIR
  delete process.env.TACIT_DIR
})

describe('front-matter 解析', () => {
  it('三类知识共用同一个解析器', () => {
    const mem = parseTacit('---\nid: m\ntrigger: file.**\nfact: 真的\n---\n', 'mem', '/x/m.md')
    assert.equal(mem?.action, '真的')
    assert.equal(mem?.kind, 'mem')

    const exp = parseTacit('---\nid: e\ntrigger: file.created\naction: 做一件事\n---\n', 'exp', '/x/e.md')
    assert.equal(exp?.action, '做一件事')

    const skill = parseTacit('---\nid: s\ntrigger: file.**\n---\n# 流程\n第一步\n', 'skill', '/x/s.md')
    assert.equal(skill?.title, '流程', '技能可以没有 action，靠正文')
  })

  it('停用、缺 trigger、坏文件都不算数', () => {
    assert.equal(parseTacit('---\nid: x\ntrigger: a\naction: b\nenabled: false\n---\n', 'exp', '/x/x.md'), undefined)
    assert.equal(parseTacit('---\nid: x\naction: b\n---\n', 'exp', '/x/x.md'), undefined)
    assert.equal(parseTacit('没有 front matter', 'exp', '/x/x.md'), undefined)
  })

  it('id 缺省时用文件名', () => {
    const entry = parseTacit('---\ntrigger: file.**\naction: 做法\n---\n', 'exp', '/dir/from-name.md')
    assert.equal(entry?.id, 'from-name')
  })

  it('目录读不出来时不抛错，坏文件跳过', () => {
    assert.deepEqual(loadTacit('exp', join(root, 'nope')), [])
    const ids = loadTacit('exp', dirs.exp).map(entry => entry.id).sort()
    assert.deepEqual(ids, ['pdf-ask', 'zip-archive'], 'off/broken 不该出现')
  })
})

describe('路径与条件匹配', () => {
  it('glob 形态', () => {
    assert.equal(triggerMatches('**', 'anything.at.all'), true)
    assert.equal(triggerMatches('file.*', 'file.created'), true)
    assert.equal(triggerMatches('file.*', 'file.created.deep'), false)
    assert.equal(triggerMatches('file.created', 'file.created.x'), true)
    assert.equal(triggerMatches('file.created', 'file.modified'), true, '同族：来了文件都算')
    assert.equal(triggerMatches('notify', 'file.created'), false)
  })

  it('条件只认三种写法，看不懂就不命中', () => {
    const context = { file: { extension: 'zip' } }
    assert.equal(conditionHolds('true', context), true)
    assert.equal(conditionHolds('file.extension == zip', context), true)
    assert.equal(conditionHolds('file.extension == pdf', context), false)
    assert.equal(conditionHolds('file.extension in [pdf, zip]', context), true)
    assert.equal(conditionHolds('file.extension =~ /zip/', context), false, '看不懂的一律不命中')
  })

  it('三类按上限截断，记忆在前', () => {
    const hits = matchTacit('file.created', {
      context: { file: { extension: 'zip' } },
      dirs,
      limit: { mem: 1, exp: 1, skill: 1 },
    })
    assert.deepEqual(hits.map(hit => hit.kind), ['mem', 'exp', 'skill'])
    assert.equal(hits[1]?.id, 'zip-archive')
  })
})

describe('注入', () => {
  it('命中三库时拼成三段，并写进 meta 供消融', () => {
    const enriched = enrichTrigger(triggerOf())
    assert.match(enriched.text, /\[记忆 · 这次情境的已知事实\]/)
    assert.match(enriched.text, /\[经验 · 命中这些就按它办\]/)
    assert.match(enriched.text, /\[技能 · 命中就按这套流程做\]/)
    assert.equal(Number(enriched.meta.tacitChars) > 0, true)
    assert.deepEqual((enriched.meta.tacit as any).exp, ['zip-archive'])
    assert.deepEqual(enriched.meta.experience, ['zip-archive'], '旧字段保持同一语义')
    assert.ok(enriched.text.startsWith('file.created'), '注入接在原文之后，不改写原文')
  })

  it('没命中就一个字都不加，而且返回原对象', () => {
    const trigger = triggerOf({ meta: { mspPath: 'screen.unlock', mspPayload: {} } })
    assert.equal(enrichTrigger(trigger), trigger)
  })

  it('记忆/经验/技能都没配时安静退化成原样', () => {
    const empty = mkdtempSync(join(tmpdir(), 'tacit-empty-'))
    const saved = { ...process.env }
    process.env.TACIT_MEM_DIR = join(empty, 'a')
    process.env.TACIT_EXPERIENCE_DIR = join(empty, 'b')
    process.env.TACIT_SKILL_DIR = join(empty, 'c')
    try {
      const trigger = triggerOf()
      assert.equal(enrichTrigger(trigger), trigger)
    } finally {
      for (const name of ['TACIT_MEM_DIR', 'TACIT_EXPERIENCE_DIR', 'TACIT_SKILL_DIR']) {
        const value = saved[name]
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('TACIT_DISABLED=1 整体关闭', () => {
    const trigger = triggerOf()
    assert.equal(enrichTrigger(trigger, { disabled: true }), trigger)
  })

  it('路径优先取源声明的，其次退到主线程 id', () => {
    assert.equal(signalPathOf(triggerOf()), 'file.created')
    assert.equal(signalPathOf(triggerOf({ meta: {} })), 'file.created', '退到 threads[0].id')
  })

  it('块长有上限，超了不会无界膨胀', () => {
    const huge = Array.from({ length: 200 }, (_, index) => ({
      kind: 'exp' as const,
      id: `e${index}`,
      trigger: '**',
      condition: 'true',
      action: 'x'.repeat(50),
      trust: 'L3',
      title: `t${index}`,
      body: '',
      file: '',
    }))
    const block = tacitBlock(huge)
    assert.ok(block.length <= 1400, `块不应超过上限，实际 ${block.length}`)
  })
})

describe('补丁一：接入', () => {
  it('把对端 manifest 归一成「它能干什么」，垃圾输入降级为空', () => {
    const peer = describePeer('watcher', {
      signals: [{ path: 'file.created', description: '有新文件' }, { path: 'file.created' }, 'file.deleted', 42],
      tools: [{ name: 'hash', description: '算哈希' }, { description: '没有名字' }],
    })
    assert.deepEqual(peer.signals, ['file.created', 'file.deleted'])
    assert.deepEqual(peer.tools.map(tool => tool.name), ['hash'])
    const junk = describePeer('junk', { signals: 'not-an-array', tools: null })
    assert.deepEqual(junk, { id: 'junk', signals: [], tools: [] })
  })

  it('没有节点在跑时，看得见的节点是空集而不是崩溃', () => {
    setMspMesh(null)
    assert.equal(mspMesh(), null)
    assert.deepEqual(peerCapabilities(), [])
  })

  it('邻居与已连接并集去重后按 id 排序', () => {
    setMspMesh({
      nodeId: 'superagent',
      publish: () => {},
      neighbors: () => ['b', 'a'],
      connections: () => ['a', 'c'],
      peerManifest: (id: string) => (id === 'a' ? { signals: [{ path: 'x' }] } : undefined),
    })
    assert.deepEqual(peerCapabilities().map(peer => peer.id), ['a', 'b', 'c'])
    assert.deepEqual(peerCapabilities()[0]?.signals, ['x'])
    setMspMesh(null)
  })
})

describe('目录约定', () => {
  it('默认落在 ~/.dsh/tacit 下，可用 TACIT_DIR 覆盖', () => {
    // 单类的覆盖优先于 TACIT_DIR——先摘掉，否则测的是覆盖而不是默认值。
    delete process.env.TACIT_MEM_DIR
    delete process.env.TACIT_SKILL_DIR
    assert.match(tacitDir('mem').replaceAll('\\', '/'), /\.dsh\/tacit\/memories$/)
    process.env.TACIT_DIR = join(root, 'custom')
    assert.equal(tacitDir('skill').replaceAll('\\', '/'), join(root, 'custom', 'skills').replaceAll('\\', '/'))
    delete process.env.TACIT_DIR
    process.env.TACIT_MEM_DIR = dirs.mem
    process.env.TACIT_SKILL_DIR = dirs.skill
  })
})
