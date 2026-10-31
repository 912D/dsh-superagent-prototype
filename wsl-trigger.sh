#!/usr/bin/env bash
set -uo pipefail
echo "=== 桥进程 ==="
pgrep -af msp_bridge | head -2 || echo "(没有)"
echo "=== 发一条信号 ==="
python3 - <<'PY'
import time
from msp import MSPNode
from msp.core.preset import Preset
n = MSPNode("tacit-demo", preset=Preset.LOCAL_TOOL)
n.start(settle=True, settle_timeout=3.0)
for _ in range(20):
    if n.connections(): break
    time.sleep(0.2)
print("peers:", n.connections())
n.publish("file.modified", {"name": "hello-from-msp.txt", "note": "触发测试"})
time.sleep(0.8)
n.stop()
PY
sleep 4
echo "=== 触发页数据 ==="
python3 - <<'PY'
import json,urllib.request
try:
    r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
    rows=json.load(urllib.request.urlopen(r,timeout=15))
    rows=rows if isinstance(rows,list) else rows.get('sources',[])
    for s in rows:
        print(s.get('id'),'|',s.get('state'),'| stats=',json.dumps(s.get('stats'),ensure_ascii=False)[:120],
              '| filtered=',len(s.get('filtered') or []))
except Exception as e:
    print('ERR',e)
PY
