# 已知问题（Windows / 非 GitHub 部署）

## K1. `spawn env ENOENT` —— 部署检查在 Windows 上必然失败

**位置**：`src/deployment.ts:75`

```ts
return argv => runAsWorker(subprocess, ['env', `PATH=${path}`, ...argv], cwd, ...)
```

**原因**：用 POSIX 的 `env` 命令改 PATH。Windows 没有 `env.exe`，于是
`gh api user` 这条探测永远 spawn 失败，报 `env ENOENT`，面板显示
「智能体的 GitHub CLI 读不到它的账号」。

**影响**：Windows 上**任何** GitHub 来源都配不成，与填什么无关。

**同样的写法还有**：`src/deployment.ts:120`（飞书 CLI 探测）。

**修法**：按平台分支，Windows 直接把 PATH 放进子进程 env：

```ts
if (process.platform === 'win32') {
  return argv => runAsWorker(subprocess, argv, cwd, signal, { PATH: path })
}
```

需要 `runAsWorker` 支持传 env（没有就在调用处改成 `spawn(..., { env })`）。

---

## K2. 部署检查强制要求 GitHub 仓库，挡住「只用 MSP」

**位置**：`src/deployment.ts:91`

```ts
const remote = accounts.repository
if (!remote) throw new SetupError('repositoryUnset')
```

**原因**：`Deployment` 类型本身就是「一个有仓库的部署」，`repository` 与
`accounts` 都是必填；`Executor` / `Ticket` / `Worker` 都从 `deployment.repository` 取值。

**影响**：即使只想要本机 MSP 信号，也必须先配一个 GitHub 仓库，
否则整个 setup 不通过，面板停在 `setup` 状态。

**修法（两层）**：

1. **最小**：GitHub 来源被禁用时跳过 `repositoryUnset` 检查，让 setup 通过
2. **正解**：把 `Deployment` 拆成 `repo` / `local` 两种联合类型，
   下游按 `kind` 分支——`local` 模式下 Executor 走本地目录、不开 PR

第 1 层能立刻解除阻塞，但 `local` 模式下点开 Ticket 相关页面仍可能报错；
第 2 层是真正的产品化改造。

---

## K3（已绕过）. `stateDir` 缺失导致整行挂载不上

**位置**：`src/deployment.ts:16`

`stateDir` 是 `.required()`，但 `--from-default-profile` 建出来的 profile
不会写它。缺了不会报「缺配置」，而是整行 mount 失败，面板只显示
「dsh-superagent 没有响应」——错误指向了错误的方向。

**当前处理**：`scripts/dsh-superagent init` 自动写进 profile 的
`cordis.patch.yml`。
