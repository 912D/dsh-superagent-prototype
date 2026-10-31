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
    except Exception as e:
        return 0, str(e)

st, s = req('GET','/settings')
gh=[x for x in s['sources'] if x['id']=='github'][0]
val=gh['value']
val['config']['repository']='hxh230802/tacit-sandbox'
val['config']['cli']='gh'
val['enabled']=True
code, body = req('PUT','/settings/sources.github',{'value':val,'revision':gh.get('revision',0)})
print('PUT', code, str(body)[:300])
PY
sleep 8
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
rows=json.load(urllib.request.urlopen(r,timeout=15))
rows=rows if isinstance(rows,list) else rows.get('sources',[])
for s in rows: print(s.get('id'),'|',s.get('state'),'|',json.dumps(s.get('health'),ensure_ascii=False)[:160])
PY
