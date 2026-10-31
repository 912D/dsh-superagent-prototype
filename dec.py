#!/usr/bin/env python3
import json, urllib.request, collections
r = urllib.request.Request("http://127.0.0.1:3080/orchestrator/api/decisions?limit=50",
                           headers={"x-orchestrator-request": "1"})
d = json.load(urllib.request.urlopen(r, timeout=20))
items = d.get("items", [])
print("decisions:", d.get("total", len(items)), "returned:", len(items))
c = collections.Counter()
for x in items:
    reasons = x.get("reason") or []
    codes = [r.get("code") for r in reasons if isinstance(r, dict)]
    c[(x.get("kind"), x.get("outcome"), tuple(codes[:3]))] += 1
for k, n in c.most_common():
    print(f"  {n:3d}  kind={k[0]} outcome={k[1]} reason={k[2]}")
print()
for x in items[:5]:
    print("-", x.get("id"), x.get("kind"), "|", json.dumps(x.get("reason"), ensure_ascii=False)[:220])
