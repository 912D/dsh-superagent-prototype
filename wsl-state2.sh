#!/usr/bin/env bash
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
d=json.load(urllib.request.urlopen(r,timeout=15))
rows=d if isinstance(d,list) else d.get('sources',[])
for s in rows:
    print(s.get('id'), '|', s.get('state'), '|', json.dumps(s.get('health'),ensure_ascii=False)[:180])
PY
echo "--- bridge 进程 ---"
pgrep -af msp_bridge || echo "(没有)"
