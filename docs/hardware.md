# Hardware — X4 Pro (ESP32-S3)

What we know about the connected device, and how it presents to a host computer.

## Identity (observed)

| Property | Value |
|----------|-------|
| SoC | **Espressif ESP32-S3 (QFN56), revision v0.2** |
| Features | Wi-Fi, **BT 5 (LE)**, Dual Core + LP Core, 240 MHz |
| PSRAM | **8 MB** embedded (AP_3v3) |
| Flash | **16 MB**, quad (4 data lines), 3.3 V — mfr `0x0b`, device `0x4018` |
| Crystal | 40 MHz |
| USB vendor ID | `0x303A` (Espressif) |
| USB product ID | `0x1001` (ESP32-S3 native USB) |
| USB interfaces | CDC **serial port** + **USB JTAG/serial debug unit** |
| MAC (this unit) | `7C:0C:5F:41:8E:00` (Espressif OUI `7C:0C:5F`) |
| USB-serial bridge | **none** — USB is native off the SoC (no CP210x/CH340) |

The device enumerates on the host as:
- A serial/CDC port — Windows `COMx` (e.g. `COM4`), Linux `/dev/ttyACM0`,
  macOS `/dev/cu.usbmodem*`.
- A JTAG/serial debug interface (composite).

## Implications

- **Flashing/monitoring** use the native USB CDC port directly. No external
  bridge driver needed.
- Because USB is native to the SoC, the port may **disappear/re-enumerate** when
  the firmware reboots or switches USB mode. This is normal; re-detect the port
  after resets.
- `esptool` can reset the chip into the ROM download mode automatically over this
  port for read/write operations.

## Getting into download (bootloader) mode

Usually `esptool` triggers download mode automatically via the USB control
lines. If a manual entry is ever required: hold **BOOT**, tap **RESET**, release
**BOOT** (exact buttons/labels on the X4 Pro to be confirmed and added here).

## USB-Serial/JTAG read_flash quirk (important)

Reading flash over the ESP32-S3 **native USB-Serial/JTAG** with the stub flasher
stalls consistently at ~0x9A000 with `Packet content transfer stopped`,
regardless of baud. Workaround (implemented in `tools/backup_flash.py`):

- Read with **`--no-stub`** (slower, ~170 kbit/s, but reliable).
- Read in **chunks with per-chunk retries** so a transient stall doesn't lose
  the whole dump.

## Still to confirm on the device

- [ ] Which display controller this unit has (SSD1677 vs UC8179 — batch-dependent)
- [x] Partition layout — see below (dual-OTA, boots app1)
- [x] Button/GPIO map — confirmed via freeink-sdk (see below)
- [x] Display controller + front-light control — confirmed (see below)
- [x] BLE available — confirmed **BT 5 (LE)** (no Bluetooth Classic)

## X4 Pro peripheral map (confirmed in freeink-sdk)

The `freeink-sdk` `BoardConfig::XTEINK_X4_PRO` profile is hardware-confirmed.
Source: [freeink-sdk/docs/xteink-x4pro-support.md](https://github.com/Free-Ink/freeink-sdk/blob/main/docs/xteink-x4pro-support.md).
Build flag: `-DFREEINK_DEVICE_X4PRO=1` (sample `[env:x4pro]`).

- **Display:** 800×480 B/W. Controller **varies by batch — SSD1677 (original) or
  UC8179 (newer)** — auto-detected at boot. SPI: SCLK=12, MOSI=11, CS=13, DC=18,
  RST=14, BUSY=6 (active-high). Internal booster (no external PMIC).
- **Touch:** GT911 on I²C 39/38 @ 0x5D. INT=10, RST=4, power-enable **GPIO2
  (active-low)**. `swapXY=true` (mounted portrait). Home is a capacitive key bit.
- **Buttons (digital, active-low):** Left=GPIO0, Right=GPIO7, Power=GPIO3.
  Note GPIO0 is a boot-strap pin.
- **Frontlight (dual, active-high PWM):** cool/white=GPIO8, warm=GPIO9 (10 kHz).
- **SD card:** **SDMMC** (not SPI), 1-bit: CLK=41, CMD=42, DAT0=40,
  power-enable GPIO5 (active-low). Needs `USE_BLOCK_DEVICE_INTERFACE=1`.
- **I²C bus 39/38:** RTC **BM8563** @0x51, battery gauge **CW2017** @0x63,
  GT911 @0x5D.
- **USB:** GPIO19=D−, GPIO20=D+ (native). Do not repurpose.
- **Peripheral rail:** GPIO1 held HIGH (required for touch rail).

> `XteinkDetect` is a no-op unless an Xteink profile is compiled in — the C3
> detect fingerprint pokes pins that on this S3 collide with USB D+/bootstrap.

## Flash partition table (16 MB, dual-OTA)

| Label | Type | Offset | Size |
|-------|------|--------|------|
| nvs | data/nvs | 0x009000 | 0x005000 |
| otadata | data/ota | 0x00E000 | 0x002000 |
| app0 | app/ota_0 | 0x010000 | 0x7E0000 |
| app1 | app/ota_1 | 0x7F0000 | 0x7E0000 |
| spiffs | data/spiffs | 0xFD0000 | 0x014000 |
| coredump | data/coredump | 0xFE4000 | 0x01C000 |

**The device boots app1** (per `otadata`) = the real OEM firmware
`ESP32S3_X4_TL_SSD1677`. **app0** holds a different/older variant
(`ESP32S3_X4_TL`). Our 16 MB backup captured all of it. A custom build flashed to
**app0 @ 0x10000** boots only if `otadata` is set to app0 — which conveniently
leaves the OEM image intact in app1 as a fallback.

## Notes for firmware

- ESP32-S3 supports **Bluetooth LE only** (no Classic/A2DP). Per the product
  spec, audio streaming to headphones stays an iPhone responsibility; the X4 uses
  BLE for control/state events.
