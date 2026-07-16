#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="${1:-${ROOT_DIR}/../Poplur2025-iOS/Poplur2025/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png}"

if [[ ! -f "${SOURCE_ICON}" ]]; then
  echo "error: source app icon not found: ${SOURCE_ICON}" >&2
  exit 1
fi

resize_icon() {
  local size="$1"
  local output="$2"
  sips -z "${size}" "${size}" "${SOURCE_ICON}" --out "${output}" >/dev/null
}

for size in 16 32 48 96 180 192 512 1024; do
  resize_icon "${size}" "${ROOT_DIR}/src/assets/icon-${size}x${size}.png"
done

resize_icon 180 "${ROOT_DIR}/src/assets/apple-touch-icon.png"
echo "Synced React Native app icons from ${SOURCE_ICON}"
