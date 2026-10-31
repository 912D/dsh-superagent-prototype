#!/usr/bin/env bash
set -uo pipefail
ln -sf "$(command -v python3)" /usr/local/bin/python
echo "python -> $(readlink -f /usr/local/bin/python)"
cd /root/sa
scripts/dsh-superagent restart > /tmp/r.txt 2>&1
echo "restart_exit=$?"
sleep 10
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/sources",headers={'x-orchestrator-request':'1'})
d=json.load(urllib.request.urlopen(r,timeout=15))
for s in d.get('sources',[]):
    print(s.get('id'), s.get('state'), json.dumps(s.get('health'),ensure_ascii=False)[:160])
PY
