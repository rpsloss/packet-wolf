#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/Desktop/Packet Wolf.app}"
ICONSET="$ROOT/AppIcon.iconset"

rm -rf "$ICONSET"
mkdir -p "$ICONSET"
python3 - <<PY
from PIL import Image
from pathlib import Path
src = Image.open("$ROOT/icon-1024.png").convert("RGBA")
out = Path("$ICONSET")
pairs = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]
for s, name in pairs:
    src.resize((s, s), Image.Resampling.LANCZOS).save(out / name)
PY

iconutil -c icns "$ICONSET" -o "$ROOT/AppIcon.icns"

mkdir -p "$ROOT/build"
swiftc -O -o "$ROOT/build/PacketWolf" \
  -framework Cocoa -framework WebKit \
  "$ROOT/main.swift"

rm -rf "$DEST"
mkdir -p "$DEST/Contents/MacOS" "$DEST/Contents/Resources"
cp "$ROOT/build/PacketWolf" "$DEST/Contents/MacOS/PacketWolf"
cp "$ROOT/Info.plist" "$DEST/Contents/Info.plist"
cp "$ROOT/AppIcon.icns" "$DEST/Contents/Resources/AppIcon.icns"
chmod +x "$DEST/Contents/MacOS/PacketWolf"
xattr -cr "$DEST" 2>/dev/null || true

echo "built $DEST"
open -R "$DEST"
