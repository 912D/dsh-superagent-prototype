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

## 跑法

原型的部署是 POSIX-only（用了 `fcntl`、`tmux`），Windows 上跑不了，**请在 WSL / Linux / macOS 里按它自己的 [SETUP.md](SETUP.md) 走**：

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
scripts/dsh-superagent start
```

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
