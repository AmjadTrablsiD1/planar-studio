#!/usr/bin/env bash
# Install Planar Studio out of the repo, build the launchers, register the tile.
#
# Idempotent, and required after every change: the shortcuts run the installed
# copy in ~/.local/share, not this working tree.
set -euo pipefail

APP_ID="planar-studio"
APP_NAME="Planar Studio"
APP_ICON="🧲"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/$APP_ID"
STATE="$HOME/.local/state/$APP_ID"
SHORTCUTS="$HOME/Desktop/Apps"

mkdir -p "$DEST" "$STATE" "$SHORTCUTS"

# Finder gives an app a different PATH than a shell, so the launcher needs the
# interpreter by absolute path. Resolve it here, while a shell PATH still exists.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node is not on PATH. Install it (brew install node) and run this again." >&2
  exit 1
fi
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo "Node $($NODE -v) is too old: this app runs TypeScript directly, which needs 22.18 or newer." >&2
  exit 1
fi

# 1. Build the interface (three.js, fonts and the design core are bundled —
#    the installed app needs no network).
( cd "$SRC/ui" && npm install --silent && npm run build )

# 2. Code -> ~/.local/share. The server needs only main.ts, server/, core/,
#    shared/ and ui/dist.
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'ui/node_modules' --exclude 'ui/src' \
  --exclude 'test-results' --exclude 'playwright-report' --exclude 'tests' --exclude '.claude' \
  "$SRC/" "$DEST/"

# 3. The .command -- the shortcut that always works.
CMD="$SHORTCUTS/$APP_NAME.command"
cat > "$CMD" <<LAUNCH
#!/usr/bin/env bash
cd "$DEST"
exec "$NODE" "$DEST/main.ts" "\$@"
LAUNCH
chmod +x "$CMD"

# 4. The Windows launcher. Written here, never run here: there is no Windows
#    machine on this Mac. Copy the repo to Windows and double-click it there.
cat > "$SRC/run-$APP_ID.bat" <<'WINEOF'
@echo off
rem Planar Studio on Windows. UNTESTED on Windows: written from documentation.
rem Needs Node 22.18+ on PATH (nodejs.org). The first start builds the interface.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node is not on PATH. Install it from https://nodejs.org and try again. & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || (echo Node 22.18 or newer is needed. & pause & exit /b 1)
if not exist ui\dist\index.html (
  pushd ui && call npm install && call npm run build && popd
)
node main.ts %*
if errorlevel 1 pause
WINEOF
cp "$SRC/run-$APP_ID.bat" "$DEST/run-$APP_ID.bat"

# 5. App Launcher tile + .app bundle. Exits 0 if the Launcher is not installed.
python3 "$DEST/scripts/register_launcher.py" \
  --id "$APP_ID" --name "$APP_NAME" --icon "$APP_ICON" --category "Apps" \
  --description "Planar transformer design on a multilayer PCB: Vin/Vout to cores, turns, stack-up, 3D, KiCad, Gerbers" \
  --cwd "$DEST" --command "\"$NODE\" \"$DEST/main.ts\"" --bundle

# 6. The icon LAST: App Launcher's mkapp writes one rendered from the tile emoji
#    and would otherwise replace the drawn one.
if [ -x "$SRC/scripts/make_icon.sh" ]; then
  "$SRC/scripts/make_icon.sh" "$SRC/branding/icon.svg" "$APP_NAME" "$SRC/ui/public" >/dev/null
  mkdir -p "$DEST/branding"
  cp -f "$SRC/branding/icon.icns" "$DEST/branding/icon.icns" 2>/dev/null || true
fi

echo
echo "Installed to $DEST"
echo "Double-click: $CMD"
echo "Or use the $APP_NAME tile in App Launcher."
