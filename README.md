# dsh-superagent-reactive

> **ReActive** 是 [DeepSeek 的 dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的一个 fork。
> 它保留原型的全部多任务调度能力，补上了原型里缺的两件事：**本机感知**（MSP）与**经验**（Experience）。

论文：[`paper/ReActive-is-All-PA-Need.pdf`](paper/ReActive-is-All-PA-Need.pdf)

---

## 为什么要这个 fork

原型的感知是**轮询**（`src/sources/poll.ts`：14 天窗口，游标回退 5 秒），
来源只有 GitHub 与飞书——两个都在云上，有 API、有配额。

但在本机，软件不会给你 webhook。所以这个 fork 加了一个 Source：

| | 原型 | 本 fork |
|---|---|---|
| 感知方式 | 轮询远端 | **MSP 推送**（`@node.on("**")`） |
| 拓扑 | AI 是中心，软件等它来问 | 网状，软件主动说 |
| 经验 | 无（`grep -ri experience src/` 零结果） | **有**：`~/.dsh/tacit/experiences/*.md` |

## 加了什么

```
src/sources/msp.ts               MSP → Trigger（推送，不轮询）· 无人称 actor
src/sources/experiences.ts       读经验库，按信号路径命中才注入
src/sources/experience-tools.ts  经验 CRUD（list/read/create/update/disable）
python/msp_bridge.py             MSP 信号 → 每行一条 JSON
tests/msp.test.mjs               8 项
```

**对原型的改动：3 个文件各 1~6 行（登记），其余是新增。** 原有逻辑一行未动。


## 一键安装

```sh
dsh plugin --profile superagent add "github:hxh230802/dsh-superagent-prototype"
```

仓库里带了构建好的 `lib/`，所以从 git 装不需要在本机重新构建。
装完补一个 `stateDir`（见上），然后：

```sh
python scripts/dsh-superagent start
```

## 跑法（手动）

部署脚本 `scripts/dsh-superagent` 已经跨平台：POSIX 用 `flock` + `tmux`，Windows 用 `msvcrt` 锁 + 隐藏控制台进程 + `Ctrl+C` 投递。两边命令一样：

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
scripts/dsh-superagent start
```

Windows 上把 `scripts/dsh-superagent` 用 `python` 跑（没有 shebang 支持）：

```powershell
python scripts/dsh-superagent start
python scripts/dsh-superagent status
python scripts/dsh-superagent stop
```

> Windows 上的已知限制：进程发现只看本脚本写的 `service.pid`（没有 `ps` 可扫），所以**用别的命令手动拉起的服务，`status` 看不见**；`stop` 走的是控制台 `Ctrl+C`，服务必须由本脚本启动才停得掉。

两个必须知道的部署细节：

1. **`stateDir` 是必填**，缺了整行挂载不上（面板会显示「没有响应」）：
   ```yaml
   # ~/.dsh/profiles/superagent/cordis.patch.yml
   - id: dsh-superagent
     config:
       stateDir: "/root/.dsh/state/superagent"
   ```
2. **MSP 桥需要一个 `python`**（不是 `python3`）和 `msp-py`：
   ```sh
   ln -sf "$(command -v python3)" /usr/local/bin/python
   python3 -m pip install --break-system-packages msp-py
   ```


## Windows 原生（实测可用）

这个 fork **不需要 WSL**。它的服务脚本本来就有完整的 Windows 分支
（`msvcrt.locking` 文件锁、`kernel32.OpenProcess` 查进程、隐藏控制台代替 tmux、Ctrl+C relay 代替 SIGINT）。

```powershell
# 1. 依赖
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
python -m pip install msp-py

# 2. 建 profile（一次性）
dsh superagent --from-default-profile web --dump-config > $null
dsh plugin --profile superagent add "link:$PWD"

# 3. 补 stateDir（必填，缺了面板显示"没有响应"）
#    %USERPROFILE%\.dsh\profiles\superagent\cordis.patch.yml
#    - id: dsh-superagent
#      config:
#        stateDir: "F:/path/to/state"

# 4. 启动
python scripts/dsh-superagent start
```

实测输出：

```
pids: [66812]
dsh web: http://127.0.0.1:3080/?token=...
```

**唯一坑**：别和 WSL 里的实例同时跑。WSL 的端口转发会占住 `127.0.0.1:3080`，
而 `Get-NetTCPConnection` 看不见它（在 WSL relay 里）。遇到 `EADDRINUSE` 就 `wsl --shutdown`。

## 踩坑记录（都是我自己踩的）

| 症状 | 真因 | 修法 |
|---|---|---|
| `ModuleNotFoundError: fcntl` | 用 `bash` 跑了 Python 脚本，且文件是 CRLF | 用 `python scripts/dsh-superagent`，不要让 bash 执行它 |
| `EADDRINUSE 127.0.0.1:3080` | WSL 实例占着端口 | `wsl --shutdown` 或换端口 |
| 面板显示"没有响应" | `stateDir` 缺省值不存在，整行挂载不上 | profile 的 patch 里补 `stateDir` |
| `spawn python ENOENT` | 只有 `python3`，没有 `python` | `ln -s python3 /usr/local/bin/python`（Windows 上通常自带 `python`） |
| `bridge exited (2)` | 没装 `msp-py` | `pip install msp-py` |
| 信号收到但 `received: 0` | 我把 `ctx.receive()` 的异常吞了 | 改成写进 health，面板才看得见 |

## 经验长什么样

一条一个 `.md`，`条件 + 动作 + 理由`：

```yaml
---
id: installer-ask
trigger: file.**
condition: true
action: 不要安装，先问这个人装不装、装到哪
trust_level: L3
enabled: true
---
# 下载到安装包时先问
安装包跑起来就有副作用，而且不可逆。
```

**只有命中的经验会进评估上下文**——所以经验越攒越多，提示词不会越来越长。
模型可以通过 `experience_create` 自己写，但**新建最高只能 L3**：L1/L2 是「不用问就动手」，
不能由模型自己授予。

## 状态

- MSP → Trigger → Engine：**通**（实测收到多条信号，`received` 计数递增）
- 经验命中注入：**通**（日志：`经验 installer-ask,zip-archive`）
- 经验 → 行为改变：**未验证**——Eval 目前对这批信号不开单，瓶颈在决策阈值，不在经验供给

最后一条是诚实的：这条链的末端还没接上。

## 许可证

MIT，与上游一致。上游 `deepseek-ai/dsh-superagent-prototype` 保留为 `upstream` remote。

> Python 桥已从这个分支移除；需要它的版本见分支 `legacy/python-bridge`。
