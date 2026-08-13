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

This creates a repo-local `.venv/` and installs `esptool`. It does **not**
install PlatformIO/pioarduino yet (that comes when we build custom firmware).

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

## iOS app (macOS only)

The [ios/](../ios/) half requires macOS + Xcode and is expected to fork/reuse
CrossX. It cannot be built on Windows or Linux. Setup steps will be added when we
begin Phase 1.

## Later: PlatformIO/pioarduino for custom firmware builds

Building a custom X4 Pro firmware (Phase 0 step "custom fork boots") uses
**PlatformIO/pioarduino** (the CrossPoint build system), not raw ESP-IDF.
CrossPoint already has an ESP32-S3 board pattern (`[env:sticky]`) and the
`freeink-sdk` provides a hardware-confirmed **X4 Pro** profile
(`-DFREEINK_DEVICE_X4PRO=1`, sample `[env:x4pro]`). That toolchain install is
deferred until we reach it; it will be documented here and scripted in `tools/`.
Prereqs (from CrossPoint): pioarduino (or VS Code + pioarduino plugin),
Python 3.8+, `clang-format` 21, and `git clone --recursive` for `freeink-sdk`.
