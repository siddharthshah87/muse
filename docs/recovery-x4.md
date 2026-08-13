# Recovery — restoring the X4 Pro from a factory backup

This is the safety net that makes custom firmware work reversible. **Take and
verify a backup before writing anything to the device.**

## Prerequisites

- Toolchain set up ([setup.md](setup.md)) — `.venv` with `esptool`.
- A factory backup produced by `tools/backup_flash.py`, consisting of:
  - `backups/x4pro-factory-<stamp>.bin` — full flash image
  - `backups/x4pro-factory-<stamp>.sha256` — checksum
  - `backups/x4pro-factory-<stamp>.json` — manifest (chip, MAC, size, tools)

> `backups/*.bin` are git-ignored. Store the backup somewhere durable and
> off-machine as well.

## 1. Verify the backup is intact

Before trusting a backup, confirm its checksum matches:

```bash
# From repo root. Compare against the .sha256 file.
cd backups
sha256sum -c x4pro-factory-<stamp>.sha256      # Linux / Git Bash
shasum -a 256 -c x4pro-factory-<stamp>.sha256  # macOS
```

The size in the manifest must equal the `.bin` file size and the device's
detected flash size.

## 2. Restore the full flash

Writing the full image back to offset 0 restores the factory state:

```bash
# Ubuntu / macOS
.venv/bin/python -m esptool --port <PORT> --baud 460800 \
    write_flash 0 backups/x4pro-factory-<stamp>.bin

# Windows (Git Bash)
.venv/Scripts/python -m esptool --port COM4 --baud 460800 \
    write_flash 0 backups/x4pro-factory-<stamp>.bin
```

If a write fails or the port drops, lower the baud (e.g. `--baud 115200`) and
retry. Put the device in download mode manually if needed
([hardware.md](hardware.md)).

> **USB-Serial/JTAG note:** as with reads, writes over the native USB-JTAG can
> stall with the stub flasher. If `write_flash` fails at a consistent offset,
> retry with `--no-stub` (slower but reliable). See the read quirk in
> [hardware.md](hardware.md).

## 3. Verify the restore

```bash
.venv/bin/python -m esptool --port <PORT> \
    verify_flash 0 backups/x4pro-factory-<stamp>.bin
```

Then power-cycle and confirm the device boots the factory firmware normally.

## If the device appears bricked

1. **Don't panic** — a full-image restore recovers almost anything short of
   hardware damage.
2. Force download mode manually (hold BOOT, tap RESET, release BOOT).
3. Re-detect the port (`tools/identify_device.py`) — it may have changed.
4. Re-run the write_flash restore at a lower baud.
5. As a last resort, `erase_flash` then `write_flash 0 <backup>.bin`.

## Recording restores

When you restore, note it in the fork provenance log
([forking.md](forking.md)) or a lab notebook: date, reason, backup used, result.
