#!/usr/bin/env bash
set -uo pipefail
mkdir -p /root/.dsh/tacit/experiences
cat > /root/.dsh/tacit/experiences/installer-ask.md <<'MD'
---
id: installer-ask
trigger: file.**
condition: true
action: 不要安装，先问这个人装不装、装到哪
trust_level: L3
enabled: true
---
# 下载到安装包时先问
安装包跑起来就有副作用，而且不可逆；归类和改名可以自己决定，装不装必须人来定。
MD
cat > /root/.dsh/tacit/experiences/zip-archive.md <<'MD'
---
id: zip-archive
trigger: file.**
condition: true
action: 归到 archive/<类型>/，重命名成 日期-原名，并在回复里报出最终路径
trust_level: L1
enabled: true
---
# 普通下载文件按类型归档
人找文件靠路径和日期，不靠原文件名。
MD
echo "经验库："; ls /root/.dsh/tacit/experiences

rsync -a /mnt/f/ScientificAndTechnological/ApplicationDesign/Project/Artifical-Intelligence-Associated-Project/dsh-superagent-msp/lib/ /root/sa/lib/
cd /root/sa && scripts/dsh-superagent restart > /tmp/r5.txt 2>&1
sleep 10
python3 - <<'PY'
import time
from msp import MSPNode
from msp.core.preset import Preset
n=MSPNode("tacit-demo", preset=Preset.LOCAL_TOOL); n.start(settle=True, settle_timeout=3.0)
for _ in range(20):
    if n.connections(): break
    time.sleep(0.2)
n.publish("file.modified", {"name":"WeChatSetup.exe","path":"/root/Downloads/WeChatSetup.exe"})
time.sleep(1.0); n.stop()
PY
sleep 8
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
rows=json.load(urllib.request.urlopen(r,timeout=15))
rows=rows if isinstance(rows,list) else rows.get('sources',[])
for s in rows:
    print(s.get('id'),'|',s.get('state'),'|',json.dumps(s.get('health'),ensure_ascii=False)[:300])
PY
