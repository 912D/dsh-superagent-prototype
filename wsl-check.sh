#!/usr/bin/env bash
LOG=$(ls -t /root/sa/.artifacts/dsh-superagent-*.log | head -1)
echo "LOG=$LOG"
echo "=== errors ==="
grep -E "did not activate|stateDir|pending|ValidationError" "$LOG" | tail -8
echo "=== url ==="
grep -o "http://127.0.0.1:[0-9]*/?token=[A-Za-z0-9_-]*" "$LOG" | tail -1
echo "=== status ==="
cd /root/sa && scripts/dsh-superagent status > /tmp/st.txt 2>&1
echo "status_exit=$?"
cat /tmp/st.txt
