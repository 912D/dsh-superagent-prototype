#!/usr/bin/env bash
L=$(ls -t /root/sa/.artifacts/*.log | head -1)
echo "LOG=$L"
echo "=== eval / model ==="
grep -inE "eval|assess|model|api.?key|unauthor|401|403|error" "$L" | tail -15
