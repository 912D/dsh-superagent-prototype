#!/usr/bin/env bash
python3 - <<'PY'
import json,urllib.request
EP="http://127.0.0.1:3080/orchestrator/api"
def req(m,p,b=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(EP+p,data=d,method=m,headers={'x-orchestrator-request':'1','content-type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=25) as f: return f.status, json.load(f)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]
st,p = req('GET','/prompts')
print('status',st)
if isinstance(p,dict):
    print('keys:', list(p.keys()))
    print('sections:', json.dumps(p.get('sections'),ensure_ascii=False)[:600])
    cur=p.get('current',{})
    print('current.revision:', cur.get('revision'))
    print('config keys:', list((cur.get('config') or {}).keys()))
PY
