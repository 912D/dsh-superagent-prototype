#!/usr/bin/env bash
set -uo pipefail
EP="http://127.0.0.1:3080/orchestrator/api"
python3 - <<'PY'
import json,urllib.request
EP="http://127.0.0.1:3080/orchestrator/api"
def req(method,path,body=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(EP+path,data=data,method=method,
        headers={'x-orchestrator-request':'1','content-type':'application/json'})
    with urllib.request.urlopen(r,timeout=15) as f: return json.load(f)

s=req('GET','/settings')
msp=[x for x in s['sources'] if x['id']=='msp'][0]
val={'enabled':True,'config':{
    'enabled':True,
    'paths':['**'],
    'python':'python3',
    'bridge':'/root/sa/python/msp_bridge.py',
    'nodeName':'superagent',
    'humanPaths':['human.message','notify.message'],
}}
out=req('PUT','/settings/sources.msp',{'value':val,'revision':msp.get('revision',0)})
print('PUT:',json.dumps(out,ensure_ascii=False))
PY
sleep 8
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
d=json.load(urllib.request.urlopen(r,timeout=15))
for s in d.get('sources',[]) if isinstance(d,dict) else d:
    print(s.get('id'), s.get('state'), json.dumps(s.get('health'),ensure_ascii=False)[:200])
PY
