# INSTALL — 给 AI 读的安装说明

> **给执行安装的 Agent：** 按顺序执行下面的步骤，每步都有一条「验证」命令。
> 验证不通过就停在那一步，查 §6 的对照表，不要跳到下一步。
> 全部完成后按 §7 自检，把结果报给用户。

---

## 0. 你要做的事

在用户自己的机器上装好 **dsh-superagent-reactive**（它是 `dsh-superagent-prototype` 的 fork），
让用户在 DeepSeek Harness 的侧栏里看到 **Superagent** 面板，并且本机 MSP 节点处于 `ready`。

**不要**重写项目代码；**不要**改用户的其它 profile；所有改动只落在 `~/.dsh`（或 `DSH_HOME`）和本项目目录里。

---

## 1. 探测（一次性，不打扰用户）

```sh
node -v            # 需要 >= 22
git --version
dsh --version      # 需要 0.2.1-rc.x；不是就 npm i -g @deepseek-ai/dsh@0.2.1-rc.3
python3 --version  # 只有 init 需要它（仅标准库），>= 3.8
```

把缺的那几项列进 §2 的安装清单，不要逐条问用户。

---

## 2. 装

### 方式 A：一句命令（推荐）

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/hxh230802/dsh-superagent-prototype/main/install.ps1 | iex
```

Linux / macOS / WSL：

```sh
curl -fsSL https://raw.githubusercontent.com/hxh230802/dsh-superagent-prototype/main/install.sh | bash
```

它会 clone 到 `~/dsh-superagent-prototype`，然后调用 `init`。

### 方式 B：手动（脚本失败时）

```sh
git clone https://github.com/hxh230802/dsh-superagent-prototype.git
cd dsh-superagent-prototype
node -v && pnpm run build          # 仓库里已带 lib/，这步只为确认能构建
python3 scripts/dsh-superagent init
```

**验证：** `scripts/dsh-superagent status | grep pids` 里有进程号。

---

## 3. init 做了四件事（少一件都会坏，都知道坏在哪）

| 动作 | 缺了会怎样 |
|---|---|
| `dsh superagent --from-default-profile web` | `--profile superagent` 不存在 |
| `dsh plugin --profile superagent add link:$PWD` | **侧栏没有 Superagent** |
| 写 `stateDir` 到 `profiles/superagent/cordis.patch.yml` | 面板显示「没有响应」 |
| `start` | 什么都没有 |

init 已经把这四步做完了。**如果你的 dsh 版本不支持 `dsh superagent` 子命令**，按 §4 手工补。

---

## 4. 手工补 stateDir（init 跳过了这步时）

```yaml
# ~/.dsh/profiles/superagent/cordis.patch.yml
- id: dsh-superagent
  config:
    stateDir: "/绝对路径/.dsh/state/superagent"
```

Windows 上路径要写成 `F:/xxx` 或 `F:\\xxx` 的形式（正则可以吃盘符，但**不能是相对路径**）。

---

## 5. 验证部署

```sh
dsh web   # 脚本会打印一个带 token 的地址；用那个地址打开
```

然后：

```sh
curl -s -H "x-orchestrator-request: 1" http://127.0.0.1:3080/orchestrator/api/sources
```

**期望：**

```json
[
  {"id":"github","state":"error", ...},          // 没配仓库是正常的
  {"id":"msp","state":"setup","health":[{"state":"ready","detail":"listening: **"}]}
]
```

`msp` 的 health 出现 `listening: **` 就是装好了。

---

## 6. 失败对照表

| 症状 | 真因 | 修法 |
|---|---|---|
| 侧栏没有 Superagent | profile 里没有 `dsh-superagent` 这一行 | `dsh plugin --profile superagent add link:$PWD` |
| 面板「没有响应」 | `stateDir` 缺失 | 见 §4 |
| `EADDRINUSE 127.0.0.1:3080` | 另一个实例（常见：WSL 里的）占着端口 | 停掉它，或 `wsl --shutdown` |
| `spawn python ENOENT` | 用了旧版（带 Python 桥的） | 确认在 `main` 分支：`git log --oneline -1` 应是 `msp-ts` 版本 |
| `ModuleNotFoundError: fcntl` | 用 `bash` 跑了 Python 脚本 | 用 `python3 scripts/dsh-superagent ...` |
| `bridge exited (2)` | 旧版缺 `msp-py` | 同上，换到 main 分支 |
| 信号收到但 `received: 0` | 准入策略拦掉了 | `policy.sources.msp.admission.ambient.unlistedUnaddressed = inferred` |

---

## 7. 完成自检（把这段结果报给用户）

```sh
scripts/dsh-superagent status
curl -s -H "x-orchestrator-request: 1" http://127.0.0.1:3080/orchestrator/api/sources
curl -s -H "x-orchestrator-request: 1" "http://127.0.0.1:3080/orchestrator/api/decisions?limit=3"
```

三个都要有输出。然后把带 token 的 URL 给用户。

---

## 8. 装完之后可以做的

- 在 `~/.dsh/tacit/experiences/` 放一条 `.md`（格式见 README），下一轮信号命中时会自动注入
- 发一条测试信号：

```sh
node -e "const {MSPNode}=require('./vendor/msp-ts/dist/index.js');const n=new MSPNode('demo');n.start().then(()=>{n.publish('file.modified',{name:'test.txt'});setTimeout(()=>n.stop(),800)})"
```

- 看 `decisions` 里有没有新记录，那就是它「看见了」的证据
