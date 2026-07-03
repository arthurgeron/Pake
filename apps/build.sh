#!/usr/bin/env bash
# Build one hardened app from its recipe folder. See apps/README.md.
set -euo pipefail

APP="${1:-}"
if [ -z "$APP" ]; then
  echo "usage: bash apps/build.sh <app>   (e.g. spotify, google-meet)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/$APP"
BASE="$ROOT/apps/_base"

if [ ! -f "$APP_DIR/manifest.sh" ]; then
  echo "No recipe at apps/$APP/manifest.sh" >&2
  exit 1
fi

APP_EXTRA_FLAGS=()
# shellcheck disable=SC1090
source "$APP_DIR/manifest.sh"

# App-specific overlay wins over the generic base.
INFO_SRC="$APP_DIR/Info.plist"; [ -f "$INFO_SRC" ] || INFO_SRC="$BASE/Info.plist"
CAPS_SRC="$APP_DIR/capabilities.json"; [ -f "$CAPS_SRC" ] || CAPS_SRC="$BASE/capabilities.json"

restore_base() {
  cp "$BASE/Info.plist" "$ROOT/src-tauri/Info.plist"
  cp "$BASE/capabilities.json" "$ROOT/src-tauri/capabilities/default.json"
  cp "$BASE/entitlements.plist" "$ROOT/src-tauri/entitlements.plist"
}
# Always return the working tree to the generic base, even on failure.
trap restore_base EXIT

echo "==> [$APP] applying config overlays"
cp "$INFO_SRC" "$ROOT/src-tauri/Info.plist"
cp "$CAPS_SRC" "$ROOT/src-tauri/capabilities/default.json"

cd "$ROOT"
echo "==> [$APP] building $APP_NAME ($APP_URL)"
node dist/cli.js "$APP_URL" \
  --name "$APP_NAME" \
  --identifier "$APP_IDENTIFIER" \
  --icon "$APP_ICON" \
  --width "$APP_WIDTH" --height "$APP_HEIGHT" \
  --targets app --keep-binary \
  ${APP_EXTRA_FLAGS[@]+"${APP_EXTRA_FLAGS[@]}"}

echo "==> [$APP] collecting output"
mkdir -p "$APP_DIR/output"
if [ -e "$ROOT/$APP_NAME.app" ]; then
  rm -rf "$APP_DIR/output/$APP_NAME.app"
  mv "$ROOT/$APP_NAME.app" "$APP_DIR/output/"
fi
if [ -e "$ROOT/$APP_NAME-binary" ]; then
  mv -f "$ROOT/$APP_NAME-binary" "$APP_DIR/output/"
fi

echo "==> [$APP] done -> apps/$APP/output/$APP_NAME.app"
