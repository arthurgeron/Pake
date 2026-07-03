# Spotify — plain hardened audio wrapper.
# Uses the generic _base capabilities (no camera/mic, no remote IPC). Local
# Info.plist overlay disables App Nap; the injected resilience watchdog
# (src-tauri/src/inject/spotify_watchdog.js) is gated by URL in window.rs.
APP_URL="https://open.spotify.com"
APP_NAME="Spotify"
APP_IDENTIFIER="com.pake.spotify.hardened"
APP_ICON="src-tauri/icons/spotify.icns"
APP_WIDTH=1200
APP_HEIGHT=780
APP_EXTRA_FLAGS=()
