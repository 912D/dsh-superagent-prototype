#!/usr/bin/env bash
set -uo pipefail
EP="http://127.0.0.1:3080/orchestrator/api"
H="-H x-orchestrator-request:1"
curl -s $H "$EP/settings" -o /tmp/settings.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/settings.json'))
srcs=d.get('sources',[])
for s in srcs:
    print(s.get('id'), '|', s.get('kind'), '|', json.dumps(s.get('value'),ensure_ascii=False)[:200], '| rev', s.get('revision'))
PY
