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
        return e.code, e.read().decode()[:400]
st,s=req('GET','/settings')
ev=s['blocks']['eval']
val=dict(ev['value']); val['mode']='auto'
print('PUT eval:', req('PUT','/settings/eval',{'value':val,'revision':ev.get('revision',0)})[0])
PY
sleep 5
bash /mnt/f/ScientificAndTechnological/ApplicationDesign/Project/Artifical-Intelligence-Associated-Project/dsh-superagent-msp/wsl-trigger.sh 2>/dev/null | tail -6
