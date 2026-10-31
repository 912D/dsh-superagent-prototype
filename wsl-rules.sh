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
st,p=req('GET','/prompts')
cfg=p['current']['config']
add = """

## 本机文件处理（来自 MSP 信号）
When a Trigger comes from the local MSP source and describes a file:
- If the file is an installer (.exe, .msi, .dmg, .pkg, .appimage): do NOT run or install it. Open a Ticket that only asks the person whether to install it and where; wait for their answer.
- Otherwise (anything else that arrived in a download or inbox folder): classify it by extension into `archive/<kind>/` and rename it to `<YYYY-MM-DD>-<original name>`. Report the final path in one line.
- Never delete a file. If the destination already exists, append a numeric suffix instead of overwriting.
"""
if '本机文件处理' not in cfg['delivery']:
    cfg['delivery'] = cfg['delivery'].rstrip() + add
st2, body = req('PUT','/prompts',{'config':cfg,'baseRevision':p['current']['revision']})
print('PUT prompts:', st2, str(body)[:300])
PY
sleep 4
echo "=== 再发一条 ==="
bash /mnt/f/ScientificAndTechnological/ApplicationDesign/Project/Artifical-Intelligence-Associated-Project/dsh-superagent-msp/wsl-trigger.sh 2>/dev/null | tail -4
sleep 20
echo "=== 工单 ==="
python3 - <<'PY'
import json,urllib.request
def get(p):
    r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api"+p,headers={'x-orchestrator-request':'1'})
    return json.load(urllib.request.urlopen(r,timeout=20))
try:
    t=get('/tickets?limit=5')
    rows=t if isinstance(t,list) else t.get('tickets',t)
    print(json.dumps(rows,ensure_ascii=False)[:700])
except Exception as e:
    print('tickets ERR', e)
PY
