#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY'
import json,urllib.request
EP="http://127.0.0.1:3080/orchestrator/api"
def req(m,p,b=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(EP+p,data=d,method=m,headers={'x-orchestrator-request':'1','content-type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=25) as f: return f.status, json.load(f)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]
st,p=req('GET','/prompts')
cfg=p['current']['config']
for k,v in cfg.items():
    print(k, '| type=', type(v).__name__, '|', json.dumps(v,ensure_ascii=False)[:180])
PY
