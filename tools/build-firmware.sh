#!/usr/bin/env bash
# Build the custom X4 Pro CrossPoint firmware (env: x4pro).
#
# Cross-platform: Ubuntu, macOS, and Windows via Git Bash. Wraps `pio run` with
# the environment fixes needed for a clean build (notably UTF-8 output, which
# Windows' cp1252 console otherwise chokes on when PlatformIO prints the i18n
# language table). Run tools/bootstrap.sh first to provision the toolchain.
#
# Usage:
#   ./tools/build-firmware.sh            # build env x4pro
#   ./tools/build-firmware.sh -e sticky  # build a different env
#   ./tools/build-firmware.sh -t upload  # build + flash (see WARNING below)
#
# WARNING: `-t upload` writes to the device. Do NOT flash without a verified
# factory backup copied off-machine (see docs/recovery-x4.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CROSSPOINT_DIR="$REPO_ROOT/firmware-x4/crosspoint"

if [ -x "$REPO_ROOT/.venv/Scripts/python.exe" ]; then
  VENV_PY="$REPO_ROOT/.venv/Scripts/python.exe"   # Git Bash on Windows
else
  VENV_PY="$REPO_ROOT/.venv/bin/python"           # Ubuntu / macOS
fi
[ -x "$VENV_PY" ] || { echo "Toolchain missing. Run ./tools/bootstrap.sh first." >&2; exit 1; }
[ -f "$CROSSPOINT_DIR/platformio.ini" ] || { echo "CrossPoint not found at $CROSSPOINT_DIR." >&2; exit 1; }

# Default env + passthrough of any extra pio args (e.g. -t upload, -v).
ENV_NAME="x4pro"
PIO_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -e) ENV_NAME="$2"; shift 2 ;;
    *)  PIO_ARGS+=("$1"); shift ;;
  esac
done

# Force UTF-8 so PlatformIO's non-ASCII output doesn't crash on Windows cp1252.
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# Sync firmware-x4/ (modules, patches, config) into the CrossPoint tree first.
"$REPO_ROOT/tools/apply-muse-overlay.sh"

echo "== Building firmware (env: $ENV_NAME) =="
cd "$CROSSPOINT_DIR"
"$VENV_PY" -m platformio run -e "$ENV_NAME" "${PIO_ARGS[@]}"

BIN=".pio/build/$ENV_NAME/firmware.bin"
if [ -f "$BIN" ]; then
  echo ""
  echo "Build OK: $CROSSPOINT_DIR/$BIN"
fi
