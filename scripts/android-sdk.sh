#!/usr/bin/env bash
# Installs, in the user's home and without sudo, what the Android build of the courier app needs
# (D050): JDK 17 (Temurin) in ~/.local/jdk-17 and the Android SDK in ~/Android/Sdk (command line
# tools, platform tools, platform and build tools; Gradle fetches the NDK and CMake it asks for).
# Running it means accepting the Android SDK licenses (shown by sdkmanager).
#
#   bash scripts/android-sdk.sh
set -euo pipefail

JDK_DIR="$HOME/.local/jdk-17"
SDK="$HOME/Android/Sdk"
PLATFORM="${ANDROID_PLATFORM:-android-36}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-36.0.0}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { printf '\033[36m[app]\033[0m %s\n' "$*"; }

if [[ ! -x "$JDK_DIR/bin/java" ]]; then
  log "Baixando o JDK 17 (Temurin)..."
  curl -fsSL -o "$TMP/jdk.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p "$JDK_DIR"
  tar -xzf "$TMP/jdk.tar.gz" -C "$JDK_DIR" --strip-components=1
fi
export JAVA_HOME="$JDK_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
log "Java: $(java -version 2>&1 | head -1)"

if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
  log "Baixando as ferramentas de linha de comando do Android..."
  url=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml | python3 -c '
import re, sys
xml = sys.stdin.read()
names = re.findall(r"commandlinetools-linux-(\d+)_latest\.zip", xml)
print("https://dl.google.com/android/repository/commandlinetools-linux-%s_latest.zip" % max(names, key=int))
')
  curl -fsSL -o "$TMP/tools.zip" "$url"
  python3 -m zipfile -e "$TMP/tools.zip" "$TMP/tools"
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$TMP/tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  chmod +x "$SDK/cmdline-tools/latest/bin/"*
fi
export ANDROID_HOME="$SDK"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"

log "Licenças do Android SDK (aceitas para o build)..."
yes | "$SDKMANAGER" --licenses > /dev/null || true
log "Instalando platform-tools, $PLATFORM e build-tools $BUILD_TOOLS..."
"$SDKMANAGER" --install "platform-tools" "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS" > /dev/null

cat <<EOF

Pronto. Para os builds (o script do app já faz isso):
  export JAVA_HOME="$JDK_DIR"
  export ANDROID_HOME="$SDK"
EOF
