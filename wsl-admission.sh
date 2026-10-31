#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY'
import json,urllib.request
EP="http://127.0.0.1:3080/orchestrator/api"
def req(m,p,b=None):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(EP+p,data=d,method=m,headers={'x-orchestrator-request':'1','content-type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=30) as f: return f.status, json.load(f)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]
st,s=req('GET','/settings')
pol=s['blocks']['policy']
val=pol['value']
print('sources in policy:', list((val.get('sources') or {}).keys()))
src=val.setdefault('sources',{}).setdefault('msp',{'allowed':[],'admission':{}})
src.setdefault('admission',{})['ambient']={'unlistedUnaddressed':'inferred'}
code,body=req('PUT','/settings/policy',{'value':val,'revision':pol.get('revision',0)})
print('PUT policy:', code, str(body)[:300])
PY
sleep 4
bash /mnt/f/ScientificAndTechnological/ApplicationDesign/Project/Artifical-Intelligence-Associated-Project/dsh-superagent-msp/wsl-trigger.sh 2>/dev/null | tail -3
sleep 18
python3 - <<'PY'
import json,urllib.request
def get(p):
    r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api"+p,headers={'x-orchestrator-request':'1'})
    return json.load(urllib.request.urlopen(r,timeout=20))
for path in ('/tickets?limit=5','/triggers?limit=5'):
    try:
        print(path, json.dumps(get(path),ensure_ascii=False)[:500])
    except Exception as e:
        print(path,'ERR',e)
PY
