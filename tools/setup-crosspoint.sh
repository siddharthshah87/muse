#!/usr/bin/env bash
# Reconstruct the CrossPoint upstream working tree for Muse (the X4 Pro firmware).
#
# The CrossPoint clone (~60 MB) is NOT vendored into this repo. This script
# recreates it deterministically, then applies our tracked overlay so the build
# is reproducible on any machine. Cross-platform (Ubuntu / macOS / Git Bash).
#
# Usage:  ./tools/setup-crosspoint.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/firmware-x4/crosspoint"

# Pinned upstream refs (update these deliberately; see docs/forking.md).
CROSSPOINT_URL="https://github.com/crosspoint-reader/crosspoint-reader.git"
CROSSPOINT_REF="4970ef1f6b1ead0047d2d206eb2d21fca91a9676"   # develop @ 2026-08-13
FREEINK_SDK_REF="4ff75b2baf4930392898a98392329ebec963a125"  # freeink-sdk main @ 2026-08-13

if [ -d "$DEST/.git" ]; then
  echo "CrossPoint already present at $DEST — leaving it as-is."
else
  echo "Cloning CrossPoint into $DEST ..."
  git clone --recursive "$CROSSPOINT_URL" "$DEST"
  git -C "$DEST" checkout "$CROSSPOINT_REF"
  git -C "$DEST" submodule update --init --recursive
fi

# Bump freeink-sdk to our pinned ref (X4 Pro support), then refresh its submodules.
echo "Pinning freeink-sdk to $FREEINK_SDK_REF ..."
git -C "$DEST/freeink-sdk" fetch --depth 50 origin main
git -C "$DEST/freeink-sdk" checkout "$FREEINK_SDK_REF"
git -C "$DEST/freeink-sdk" submodule update --init --recursive

# Apply our tracked overlay (adds the x4pro build env).
cp "$REPO_ROOT/firmware-x4/platformio.local.ini" "$DEST/platformio.local.ini"
echo "Applied overlay -> $DEST/platformio.local.ini"
echo "Done. Build with: ./tools/build-firmware.sh"
