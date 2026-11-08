#!/usr/bin/env bash
# Apply Muse's tracked overlay onto the (git-ignored) CrossPoint working tree.
#
# firmware-x4/ is the source of truth; firmware-x4/crosspoint/ is disposable.
# This copies our build config and Margin modules in, then applies our edits to
# upstream files from firmware-x4/patches/. Idempotent: run it as often as you
# like (tools/build-firmware.sh runs it before every build).
#
# Edit Margin modules in firmware-x4/src/, never in crosspoint/src/ — the copy
# there is replaced on every run. To change an upstream hook, edit the file in
# crosspoint/, then regenerate its patch, e.g.:
#   git -C firmware-x4/crosspoint diff HEAD -- src/main.cpp \
#     > firmware-x4/patches/0003-serial-trace-command.patch
#
# Usage:  ./tools/apply-muse-overlay.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FW="$REPO_ROOT/firmware-x4"
DEST="$FW/crosspoint"
[ -d "$DEST/.git" ] || { echo "CrossPoint not found at $DEST. Run ./tools/setup-crosspoint.sh first." >&2; exit 1; }

# Build config: x4pro env, X4 Pro partition table, RainMaker include shim.
cp "$FW/platformio.local.ini" "$DEST/platformio.local.ini"
cp "$FW/partitions_x4pro.csv" "$DEST/partitions_x4pro.csv"
mkdir -p "$DEST/scripts"
cp "$FW/scripts/add_rainmaker_includes.py" "$DEST/scripts/add_rainmaker_includes.py"
echo "Overlay: build config -> $DEST"

# Margin modules: mirror each populated firmware-x4/src/<module>/ into
# crosspoint/src/<module>/ (non-ignored files only; .gitkeep skipped).
for dir in "$FW"/src/*/; do
  module="$(basename "$dir")"
  files="$(git -C "$dir" ls-files --cached --others --exclude-standard . | grep -v '\.gitkeep$' || true)"
  [ -n "$files" ] || continue
  if [ -n "$(git -C "$DEST" ls-files "src/$module")" ]; then
    echo "src/$module exists upstream; refusing to replace it. Rename the Margin module." >&2
    exit 1
  fi
  rm -rf "$DEST/src/$module"
  mkdir -p "$DEST/src/$module"
  while IFS= read -r f; do
    mkdir -p "$DEST/src/$module/$(dirname "$f")"
    cp "$dir/$f" "$DEST/src/$module/$f"
  done <<< "$files"
  echo "Overlay: src/$module/"
done

# Upstream edits: apply each patch unless it is already applied.
for patch in "$FW"/patches/*.patch; do
  [ -e "$patch" ] || continue
  name="$(basename "$patch")"
  if git -C "$DEST" apply --check "$patch" 2>/dev/null; then
    git -C "$DEST" apply "$patch"
    echo "Patch:   $name (applied)"
  elif git -C "$DEST" apply --reverse --check "$patch" 2>/dev/null; then
    echo "Patch:   $name (already applied)"
  else
    echo "Patch $name does not apply to $DEST." >&2
    echo "The upstream file changed, or it was edited in place without regenerating" >&2
    echo "the patch. Compare with: git -C \"$DEST\" diff HEAD" >&2
    exit 1
  fi
done
