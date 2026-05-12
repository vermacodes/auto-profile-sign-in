#!/usr/bin/env bash
# Package the extension into a .zip suitable for the Edge Add-ons / Chrome Web Store.
#
# Usage:
#   ./scripts/package.sh
#
# Output:
#   dist/auto-profile-sign-in-<version>.zip
#
# Requires: zip, and either jq (preferred) or python3 to read manifest.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
MANIFEST="${ROOT_DIR}/manifest.json"

if [[ ! -f "${MANIFEST}" ]]; then
    echo "error: manifest.json not found at ${MANIFEST}" >&2
    exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
    echo "error: 'zip' is required but not installed" >&2
    exit 1
fi

read_version() {
    if command -v jq >/dev/null 2>&1; then
        jq -r '.version' "${MANIFEST}"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "${MANIFEST}"
    else
        echo "error: need jq or python3 to read manifest version" >&2
        exit 1
    fi
}

read_name() {
    if command -v jq >/dev/null 2>&1; then
        jq -r '.name' "${MANIFEST}"
    else
        python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "${MANIFEST}"
    fi
}

VERSION="$(read_version)"
NAME="$(read_name)"

if [[ -z "${VERSION}" || "${VERSION}" == "null" ]]; then
    echo "error: could not read .version from manifest.json" >&2
    exit 1
fi

# Slugify: lowercase, spaces -> dashes, strip anything not [a-z0-9-]
SLUG="$(printf '%s' "${NAME}" \
    | tr '[:upper:]' '[:lower:]' \
    | tr ' ' '-' \
    | tr -cd 'a-z0-9-')"
if [[ -z "${SLUG}" ]]; then
    SLUG="extension"
fi

ZIP_NAME="${SLUG}-${VERSION}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

mkdir -p "${DIST_DIR}"
rm -f "${ZIP_PATH}"

# Files / directories to ship in the package.
INCLUDES=(
    "manifest.json"
    "src"
    "icons"
    "LICENSE"
    "README.md"
)

# Verify everything we're about to ship exists.
for entry in "${INCLUDES[@]}"; do
    if [[ ! -e "${ROOT_DIR}/${entry}" ]]; then
        echo "error: required entry '${entry}' is missing" >&2
        exit 1
    fi
done

cd "${ROOT_DIR}"

# Exclude editor / OS / VCS noise that may live inside included directories.
EXCLUDES=(
    "*/.DS_Store"
    "*/Thumbs.db"
    "*/.git/*"
    "*/.gitignore"
    "*/node_modules/*"
    "*.swp"
)

zip -r -q -X "${ZIP_PATH}" "${INCLUDES[@]}" -x "${EXCLUDES[@]}"

echo "Packaged: ${ZIP_PATH}"
ls -lh "${ZIP_PATH}" | awk '{print "Size:    ", $5}'
echo "Version: ${VERSION}"
