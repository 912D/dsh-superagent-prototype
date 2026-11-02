/**
 * 经验的兼容入口。
 *
 * 实现已经收进 `tacit.ts`（Mem + Exp + SKILL 三库共用一套解析、匹配与注入）。
 * 这个文件只保留旧名字，因为 `msp.ts`、测试和外部脚本都按 `experiences.ts` 引用——
 * 换实现不该让调用方跟着改 import，也不该存在第二份解析器（两份必然漂移）。
 */
import {
  conditionHolds as holdsCondition,
  loadTacit,
  matchTacit,
  tacitBlock,
  triggerMatches as matchesTrigger,
  type TacitEntry,
} from './tacit.ts'

/** 一条经验 = 一条 tacit 条目（`kind === 'exp'`）。 */
export type Experience = TacitEntry

/** 读整个经验目录；目录不存在就当没有经验，不抛错。 */
export const loadExperiences = (dir?: string): Experience[] => loadTacit('exp', dir)

/** `file.*` 匹配 file.created；`file.created` 精确匹配；`**` 全收。 */
export const triggerMatches = matchesTrigger

/** 条件只支持 `true` 与 `字段 == 值` / `字段 in [..]`。 */
export const conditionHolds = holdsCondition

/** 命中这个信号路径的经验，按 id 排序，最多 `limit` 条。 */
export function matchExperiences(path: string, context: Record<string, unknown>, limit = 3): Experience[] {
  return matchTacit(path, { kinds: ['exp'], context, limit: { exp: limit } })
}

/** 拼成给模型看的一小段；没有命中就返回空串。 */
export const experienceBlock = (matches: readonly Experience[]): string =>
  tacitBlock(matches.filter(entry => entry.kind === 'exp'))
