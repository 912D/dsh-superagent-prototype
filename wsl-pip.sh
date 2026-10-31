#!/usr/bin/env bash
set -uo pipefail
apt-get install -y -qq python3-pip python3-venv > /tmp/apt2.log 2>&1 || true
python3 -m pip --version 2>&1 | head -1
python3 -m pip install --quiet --break-system-packages "msp-py" > /tmp/pip2.log 2>&1 || python3 -m pip install --quiet "msp-py" >> /tmp/pip2.log 2>&1
python3 -c "import msp; print('msp ok', getattr(msp,'__version__','?'))" || tail -6 /tmp/pip2.log
