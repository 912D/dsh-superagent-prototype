/**
 * 经验层写入口（`tacit_*` 工具）的测试：库能不能长大，全看这一组。
 *
 * 同样用 `node:test` + 直接跑 `.ts`，不依赖 node_modules：
 *   node --test tests/tacit-tools.test.ts
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { loadTacit } from '../src/sources/tacit.ts'
import { registerTacitTools } from '../src/sources/tacit-tools.ts'

const root = mkdtempSync(join(tmpdir(), 'tacit-tools-'))
const dirs = { mem: join(root, 'memories'), exp: join(root, 'experiences'), skill: join(root, 'skills') }

/** 最小的工具注册表：只要能把 def 收下来、能按名字调 execute，就够验这组工具。 */
function fakeRegistry() {
  const defs = new Map<string, any>()
  const tools = {
    register(def: any) {
      defs.set(def.name, def)
      return () => { defs.delete(def.name) }
    },
  }
  return { tools, defs, call: (name: string, args: unknown) => defs.get(name)!.execute(args) }
}

const registry = fakeRegistry()
let disposers: (() => void)[] = []

before(() => {
  process.env.TACIT_MEM_DIR = dirs.mem
  process.env.TACIT_EXPERIENCE_DIR = dirs.exp
  process.env.TACIT_SKILL_DIR = dirs.skill
  disposers = registerTacitTools(registry.tools)
})

after(() => {
  for (const dispose of disposers) dispose()
  for (const name of ['TACIT_MEM_DIR', 'TACIT_EXPERIENCE_DIR', 'TACIT_SKILL_DIR']) delete process.env[name]
})

describe('注册', () => {
  it('四个工具都挂上了，卸载时能全部摘掉', () => {
    assert.deepEqual([...registry.defs.keys()].sort(), ['tacit_create', 'tacit_disable', 'tacit_list', 'tacit_read'])
    assert.equal(disposers.length, 4)
  })
})

describe('tacit_create', () => {
  it('记忆写 fact 键，落盘就是 tacit 能读回来的同一份格式', async () => {
    const result = await registry.call('tacit_create', {
      kind: 'mem',
      id: 'downloads-dir',
      trigger: 'file.download',
      action: '这个目录下的安装包一律先问再装',
      body: '装上去就有副作用，而且不可逆。',
    })
    assert.equal(result.structuredContent.ok, true)
    const file = join(dirs.mem, 'downloads-dir.md')
    assert.ok(existsSync(file))
    const text = readFileSync(file, 'utf8')
    assert.match(text, /^fact: /m)
    assert.doesNotMatch(text, /^action: /m, '记忆用 fact，不该同时写 action')
    const readBack = loadTacit('mem')
    assert.deepEqual(readBack.map(entry => entry.id), ['downloads-dir'])
    assert.equal(readBack[0]?.action, '这个目录下的安装包一律先问再装')
  })

  it('技能可以只给正文，经验不行', async () => {
    const skill = await registry.call('tacit_create', {
      kind: 'skill',
      id: 'unzip-flow',
      trigger: 'file.created',
      title: '解压并归档',
      body: '用 unzip 解到临时目录\n按类型归到 archive/ 下\n检查有没有残留',
    })
    assert.equal(skill.structuredContent.ok, true)

    const noAction = await registry.call('tacit_create', { kind: 'exp', id: 'empty-exp', trigger: 'file.created' })
    assert.equal(noAction.structuredContent.ok, false)
  })

  it('L1/L2 被压到 L3：不经人点头就行动的等级只能由人上调', async () => {
    const result = await registry.call('tacit_create', {
      kind: 'exp',
      id: 'pdf-convert',
      trigger: 'file.created',
      action: '先问要不要转格式',
      condition: 'file.extension in [pdf, docx]',
      trust_level: 'L1',
    })
    assert.equal(result.structuredContent.ok, true)
    assert.equal(result.structuredContent.clamped, true)
    assert.equal(loadTacit('exp').find(entry => entry.id === 'pdf-convert')?.trust, 'L3')
  })

  it('同 id 不覆盖；非法 id 一律拒绝（模型给的 id 不能带出目录）', async () => {
    const duplicate = await registry.call('tacit_create', {
      kind: 'exp', id: 'pdf-convert', trigger: 'file.created', action: '另一条',
    })
    assert.equal(duplicate.structuredContent.ok, false)
    for (const id of ['../escape', 'A-Bad', 'x', '', 'a/b']) {
      const result = await registry.call('tacit_create', { kind: 'exp', id, trigger: '**', action: 'x' })
      assert.equal(result.structuredContent.ok, false, `id ${JSON.stringify(id)} 应被拒绝`)
    }
  })

  it('kind 只能是三类之一', async () => {
    const result = await registry.call('tacit_create', { kind: 'note', id: 'x-y', trigger: '**', action: 'x' })
    assert.equal(result.structuredContent.ok, false)
  })
})

describe('tacit_list / tacit_read / tacit_disable', () => {
  it('列得出来、读得回原文', async () => {
    const listed = await registry.call('tacit_list', {})
    assert.deepEqual(listed.structuredContent.groups.map((group: any) => group.kind), ['mem', 'exp', 'skill'])
    const mem = listed.structuredContent.groups.find((group: any) => group.kind === 'mem')
    assert.deepEqual(mem.ids, ['downloads-dir'])

    const read = await registry.call('tacit_read', { kind: 'mem', id: 'downloads-dir' })
    assert.equal(read.structuredContent.found, true)
    assert.match(read.structuredContent.text, /^---/m)
  })

  it('停用是软删：文件还在，但不再被读出来', async () => {
    const disabled = await registry.call('tacit_disable', { kind: 'exp', id: 'pdf-convert' })
    assert.match(disabled.structuredContent.message, /已停用/)
    assert.ok(existsSync(join(dirs.exp, 'pdf-convert.md')), '文件要留着，删掉就没法复盘了')
    assert.equal(loadTacit('exp').some(entry => entry.id === 'pdf-convert'), false)
  })

  it('停用不存在的条目要说人话，不抛错', async () => {
    const missing = await registry.call('tacit_disable', { kind: 'exp', id: 'no-such' })
    assert.match(missing.structuredContent.message, /没有这条/)
  })
})
