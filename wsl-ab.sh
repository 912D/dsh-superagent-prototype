#!/usr/bin/env bash
set -uo pipefail
EXP=/root/.dsh/tacit/experiences
API=http://127.0.0.1:3080/orchestrator/api

fire() {
python3 - <<'PY'
import time
from msp import MSPNode
from msp.core.preset import Preset
n=MSPNode("tacit-demo", preset=Preset.LOCAL_TOOL); n.start(settle=True, settle_timeout=3.0)
for _ in range(20):
    if n.connections(): break
    time.sleep(0.2)
names=["WeChatSetup.exe","Invoice_2026.pdf","VSCodeSetup.msi","notes-draft.md","DriverBooster.exe"]
for i,name in enumerate(names):
    n.publish("file.modified", {"name":name,"path":"/root/Downloads/"+name,"i":i})
    time.sleep(0.4)
time.sleep(1.0); n.stop()
PY
}

snap() {
python3 - <<'PY'
import json,urllib.request
def get(p):
    r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api"+p,headers={'x-orchestrator-request':'1'})
    return json.load(urllib.request.urlopen(r,timeout=20))
t=get('/tickets?limit=20'); items=t.get('items',[])
print('TICKETS', len(items))
for x in items[:6]:
    print('  -', x.get('id'), '|', str(x.get('title'))[:60], '|', x.get('stage') or x.get('state'))
s=get('/sources'); rows=s if isinstance(s,list) else s.get('sources',[])
for r in rows:
    if r.get('id')=='msp': print('  msp stats', json.dumps(r.get('stats'),ensure_ascii=False))
PY
}

echo "########## A：无经验 ##########"
mv "$EXP" "$EXP.bak"
mkdir -p "$EXP"
cd /root/sa && scripts/dsh-superagent restart > /tmp/ra.txt 2>&1
sleep 10
fire
sleep 30
snap

echo
echo "########## B：有经验 ##########"
rmdir "$EXP"; mv "$EXP.bak" "$EXP"
cd /root/sa && scripts/dsh-superagent restart > /tmp/rb.txt 2>&1
sleep 10
fire
sleep 30
snap
