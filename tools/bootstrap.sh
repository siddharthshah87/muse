#!/usr/bin/env bash
# Bootstraps the local firmware toolchain for the Margin / X4 Pro monorepo.
#
# Cross-platform: runs on Ubuntu, macOS, and Windows via Git Bash.
# Idempotent. Ensures Python 3 is available, creates a repo-local .venv, and
# installs esptool into it. Safe to re-run.
#
# This does NOT install PlatformIO/pioarduino (the CrossPoint build system for
# custom firmware, added later). esptool alone identifies the chip and backs up
# the full factory flash.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO_ROOT/.venv"

echo "== Margin toolchain bootstrap =="

# Locate a Python 3 interpreter.
PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; assert sys.version_info[0]==3' >/dev/null 2>&1; then PY="$c"; break; fi
  fi
done

if [ -z "$PY" ]; then
  echo "Python 3 not found." >&2
  case "$(uname -s)" in
    Linux*)  echo "Install it with:  sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip" >&2 ;;
    Darwin*) echo "Install it with:  brew install python3   (or from https://www.python.org/downloads/)" >&2 ;;
    *)       echo "On Windows, install Python 3 from https://www.python.org/downloads/ (enable 'Add to PATH')." >&2 ;;
  esac
  exit 1
fi
echo "Using Python: $($PY --version) ($PY)"

# venv layout differs between Windows (Scripts/) and POSIX (bin/).
if [ ! -d "$VENV" ]; then
  echo "Creating virtual environment (.venv)..."
  "$PY" -m venv "$VENV"
fi
if [ -x "$VENV/Scripts/python.exe" ]; then
  VENV_PY="$VENV/Scripts/python.exe"     # Git Bash on Windows
else
  VENV_PY="$VENV/bin/python"             # Ubuntu / macOS
fi

echo "Upgrading pip and installing esptool..."
"$VENV_PY" -m pip install --upgrade pip >/dev/null
"$VENV_PY" -m pip install --upgrade esptool

echo ""
echo "esptool ready: $("$VENV_PY" -m esptool version 2>&1 | head -n1)"
echo "Virtualenv:    $VENV"
echo ""
echo "On Linux you may need serial permissions:  sudo usermod -aG dialout \"\$USER\"  (then re-login)"
echo ""
echo "Next steps (use the venv Python):"
echo "  $VENV_PY tools/identify_device.py   # read-only chip identify"
echo "  $VENV_PY tools/backup_flash.py      # full factory backup (before any write)"
