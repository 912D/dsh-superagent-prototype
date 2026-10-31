#!/usr/bin/env python3
"""MSP → 每行一条 JSON 的桥。

Super-agent 的其它 Source 都是"去远端拉"，这个反过来：本机节点**推**。

    python python/msp_bridge.py --node superagent --path "**"

stdout 只输出两种东西：

    {"ready": true, "node": "superagent", "paths": ["**"]}     启动完成
    {"node":"file-watcher","path":"file.modified","at":"…","payload":{…}}   一条信号

stderr 留给人看（Node 侧会把它写进 Source 的健康状态）。
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time


def main() -> int:
    parser = argparse.ArgumentParser(description="Bridge MSP signals to newline-delimited JSON.")
    parser.add_argument("--node", default="superagent", help="本节点宣告的名字")
    parser.add_argument("--path", action="append", default=None, help="订阅的信号路径，可重复；默认 **")
    parser.add_argument("--settle", type=float, default=0.8, help="启动后等邻居连上的秒数")
    args = parser.parse_args()

    paths = args.path or ["**"]

    try:
        from msp import MSPNode
        from msp.core.preset import Preset
    except Exception as error:  # noqa: BLE001 - 桥的职责就是把失败说清楚
        print(f"msp import failed: {error}. pip install msp-py", file=sys.stderr)
        return 2

    try:  # Windows 控制台默认 GBK；Node 侧按 UTF-8 解析
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    lock = threading.Lock()

    def emit(payload: dict) -> None:
        # 一行一条：Node 侧按行切、按 JSON 解。任何异常都不能让它半行输出。
        line = json.dumps(payload, ensure_ascii=False, default=str)
        with lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    node = MSPNode(args.node, preset=Preset.LOCAL_AI)

    for path in paths:
        def handler(signal, _path=path):  # noqa: ANN001 - msp 回调给的是 Signal 对象
            try:
                emit({
                    "node": getattr(signal, "source", None) or args.node,
                    "path": getattr(signal, "path", _path),
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "payload": getattr(signal, "payload", None) or {},
                })
            except Exception as error:  # noqa: BLE001
                print(f"emit failed: {error}", file=sys.stderr)

        node.on(path)(handler)

    try:
        node.start(settle=True, settle_timeout=args.settle)
    except Exception as error:  # noqa: BLE001
        print(f"node start failed: {error}", file=sys.stderr)
        return 3

    emit({"ready": True, "node": args.node, "paths": paths, "peers": node.connections()})
    print(f"[msp_bridge] {args.node} listening on {paths}", file=sys.stderr)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            node.stop()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
