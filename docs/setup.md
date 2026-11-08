# Setup — reproducible on any machine

This gets a fresh machine ready to identify and back up the X4 Pro, and to work
in the monorepo. Firmware tooling runs on **Ubuntu, macOS, and Windows (Git
Bash)**. The iOS app requires **macOS + Xcode** and is covered separately.

## Prerequisites

| Need | All platforms |
|------|---------------|
| Git | required (Windows: Git for Windows provides **Git Bash**) |
| Python 3.9+ | required for device tooling |
| A USB cable | data-capable, to the X4 Pro |

### Install Python 3

- **Ubuntu/Debian:** `sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip`
- **macOS:** `brew install python3` (or python.org installer)
- **Windows:** install from <https://www.python.org/downloads/> and enable
  "Add python.exe to PATH", then **open a new terminal** so PATH updates.

## Bootstrap the firmware toolchain

From the repo root, run the cross-platform bootstrap (works in Git Bash on
Windows):

```bash
./tools/bootstrap.sh
```

This creates a repo-local `.venv/` and installs `esptool` and PlatformIO.

### Linux serial permissions

On Ubuntu, add yourself to the `dialout` group to access the serial port without
sudo, then log out/in:

```bash
sudo usermod -aG dialout "$USER"
```

## Identify the device (read-only)

Connect the X4 Pro and run:

```bash
# Use the venv's Python (path differs per OS):
.venv/bin/python tools/identify_device.py          # Ubuntu / macOS
.venv/Scripts/python tools/identify_device.py       # Windows (Git Bash)
```

This runs `chip_id` and `flash_id`. It resets the chip into download mode but
does not modify flash. See [hardware.md](hardware.md) for what the device should
report.

## Back up the factory flash (do this before ANY write)

```bash
.venv/bin/python tools/backup_flash.py             # Ubuntu / macOS
.venv/Scripts/python tools/backup_flash.py          # Windows (Git Bash)
```

Outputs a timestamped `.bin`, a `.sha256`, and a `.json` manifest under
`backups/` (git-ignored). **Copy the backup off-machine.** Restore instructions:
[recovery-x4.md](recovery-x4.md).

## Port selection

Both scripts auto-detect the ESP32-S3 port (USB VID `303A` / PID `1001`). If you
have multiple serial devices, pass one explicitly:

```bash
.venv/bin/python tools/identify_device.py --port /dev/ttyACM0   # Linux
.venv/Scripts/python tools/identify_device.py --port COM4        # Windows
```

## Build the Muse firmware

```bash
./tools/setup-crosspoint.sh   # clone CrossPoint + pinned freeink-sdk, apply overlay
./tools/build-firmware.sh     # re-applies the overlay, then builds env x4pro
```

`firmware-x4/` is the source of truth: Margin modules live in
`firmware-x4/src/`, and our edits to upstream files are patches in
`firmware-x4/patches/`. `tools/apply-muse-overlay.sh` copies/applies them into
the git-ignored `firmware-x4/crosspoint/` tree; never edit Margin modules there.
Flashing is a separate, deliberate step: `.venv/bin/python tools/flash_x4pro.py`
(requires a verified backup — see [recovery-x4.md](recovery-x4.md)).

## Companion app (no Mac needed)

The Phase 1 iPhone app in [companion/](../companion/) is built in the cloud with
EAS — see [companion/DEPLOY.md](../companion/DEPLOY.md). Locally you can
typecheck and bundle it on Linux:

```bash
cd companion && npm ci
npx tsc --noEmit -p .
npx expo export --platform ios --output-dir /tmp/margin-bundle
```

The native [ios/](../ios/) app (later, forking CrossX) requires macOS + Xcode.
