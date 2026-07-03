# Google Meet — needs camera + microphone (hardened-runtime media entitlements).
# --camera / --microphone make the CLI write the device entitlements; the usage
# strings live in this app's Info.plist overlay.
APP_URL="https://meet.google.com"
APP_NAME="Google Meet"
APP_IDENTIFIER="com.pake.googlemeet.hardened"
APP_ICON="src-tauri/icons/google_meet.icns"
APP_WIDTH=1200
APP_HEIGHT=780
APP_EXTRA_FLAGS=(--camera --microphone)
