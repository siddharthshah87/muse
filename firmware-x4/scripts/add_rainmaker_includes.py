import os, re
Import("env")

# ── 1. Pre-write ARDUINO_SELECTIVE flags to sdkconfig.defaults ──────────────
# pioarduino's espidf.py writes custom_sdkconfig flags to sdkconfig.defaults
# AFTER cmake's kconfig pass has already generated the sdkconfig — so SELECTIVE
# flags never take effect on the first run. We write them here (pre: script)
# so kconfig sees them before cmake runs.
SELECTIVE_FLAGS = [
    "CONFIG_ARDUINO_SELECTIVE_COMPILATION=y",
    "CONFIG_ARDUINO_SELECTIVE_RainMaker=n",
    "CONFIG_ARDUINO_SELECTIVE_Insights=n",
    "CONFIG_ARDUINO_SELECTIVE_ESP_SR=n",
]

project_dir = env.subst("$PROJECT_DIR")
sdkconfig_defaults = os.path.join(project_dir, "sdkconfig.defaults")

if os.path.isfile(sdkconfig_defaults):
    with open(sdkconfig_defaults, "r") as f:
        content = f.read()
    changed = False
    for flag in SELECTIVE_FLAGS:
        key = flag.split("=")[0]
        pattern = re.compile(r"^" + re.escape(key) + r"=.*$", re.MULTILINE)
        if pattern.search(content):
            new_content = pattern.sub(flag, content)
            if new_content != content:
                content = new_content
                changed = True
        else:
            content += "\n" + flag
            changed = True
    if changed:
        with open(sdkconfig_defaults, "w") as f:
            f.write(content)
        print("[muse] Pre-wrote ARDUINO_SELECTIVE flags to sdkconfig.defaults")

# ── 2. Add missing ESP32-S3 rainmaker headers (SCons/PlatformIO lib phase) ───
# pioarduino compiles ALL Arduino framework libs regardless of lib_ignore.
# The ESP32-S3 framework package omits rainmaker headers that other variants
# have, so RainMaker fails to compile. Add them from the ESP32 variant.
# Symbols are unused and stripped at link time.
pio_home = os.environ.get("PLATFORMIO_HOME_DIR", os.path.expanduser("~/.platformio"))
rainmaker_include = os.path.join(
    pio_home, "packages",
    "framework-arduinoespressif32-libs",
    "esp32", "include", "espressif__esp_rainmaker", "include",
)
if os.path.isdir(rainmaker_include):
    env.Prepend(CPPPATH=[rainmaker_include])
