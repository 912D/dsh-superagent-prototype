#!/usr/bin/env bash
set -uo pipefail
pip3 install --quiet --break-system-packages "msp-py" > /tmp/pip.log 2>&1 || pip3 install --quiet "msp-py" >> /tmp/pip.log 2>&1
echo "pip_exit=$?"
python3 -c "import msp; print('msp', getattr(msp,'__version__','?'))" || tail -5 /tmp/pip.log
echo "--- bridge 单独试跑 ---"
timeout 6 python3 /root/sa/python/msp_bridge.py --node superagent --path "**" 2>&1 | head -3
