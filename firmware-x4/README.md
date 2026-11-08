# firmware-x4 — Muse (X4 Pro firmware, ESP32-S3)

**Muse** is Margin's X4 Pro firmware: a **fork of CrossPoint** (the XTEINK reader
firmware) with Margin-specific additions kept in isolated modules. See
[../docs/forking.md](../docs/forking.md) and
[../docs/hardware.md](../docs/hardware.md).

> **Working tree is not vendored.** The CrossPoint clone lives at
> `firmware-x4/crosspoint/` and is **git-ignored** — treat it as disposable.
> Reconstruct it on any machine with `./tools/setup-crosspoint.sh` (clones
> CrossPoint, pins `freeink-sdk`, applies our overlay), then build with
> `./tools/build-firmware.sh`.
>
> Everything that makes it Muse is tracked here and applied by
> `tools/apply-muse-overlay.sh` (run automatically before every build):
>
> | Tracked | Lands in `crosspoint/` as |
> |---------|---------------------------|
> | [`platformio.local.ini`](platformio.local.ini), [`partitions_x4pro.csv`](partitions_x4pro.csv), `scripts/` | build config (`x4pro` env, partition table, NimBLE) |
> | `src/<module>/` | `src/<module>/` (replaced on every run — **edit here, not there**) |
> | [`patches/*.patch`](patches/) | edits to upstream files (reader hook, `/api/reading`, `CMD:TRACE`) |
>
> To change an upstream hook, edit the file in `crosspoint/` and regenerate its
> patch: `git -C firmware-x4/crosspoint diff HEAD -- <file> > firmware-x4/patches/<NNNN-name>.patch`.

## Margin modules (isolated from upstream)

| Module | Responsibility |
|--------|----------------|
| `src/reader_integration/` | Thin hooks into the CrossPoint reader engine (no rewrites). |
| `src/locator/` | Canonical locator engine: rendered spans → normalized offsets. |
| `src/playback_overlay/` | Active-phrase highlight via E Ink partial refresh. |
| `src/device_protocol/` | BLE control/state service (+ Wi-Fi debug endpoint). |
| `src/annotations/` | Highlight/note/selection UI + durable outbound event queue. |

## Debug tracing

`device_protocol/muse_trace_backend.c` keeps the last 64 BLE/page events in a
RAM ring. Dump it over USB serial without resetting the device:

```bash
.venv/bin/python tools/serial_monitor.py --no-reset --send CMD:TRACE --seconds 3
```

The ring is also dumped automatically every 8 page turns. Add events with
`muse_trace_log("TAG", "fmt", ...)`.

## Golden rule

Never write to device flash without a verified factory backup
([../docs/recovery-x4.md](../docs/recovery-x4.md)).

Build tooling: `esptool` (backup/flash) and **PlatformIO/pioarduino** (the
CrossPoint build system), both installed into `.venv/` by `tools/bootstrap.sh`.
