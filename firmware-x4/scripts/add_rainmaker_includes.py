import os
Import("env")

# PlatformIO home dir: prefer env variable, fall back to ~/.platformio
pio_home = os.environ.get("PLATFORMIO_HOME_DIR", os.path.expanduser("~/.platformio"))
rainmaker_include = os.path.join(
    pio_home,
    "packages",
    "framework-arduinoespressif32-libs",
    "esp32",
    "include",
    "espressif__esp_rainmaker",
    "include",
)
if os.path.isdir(rainmaker_include):
    env.Prepend(CPPPATH=[rainmaker_include])
