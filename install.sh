#!/usr/bin/env bash
set -euo pipefail

REPO="thephilip/pii-freely"
BRANCH="main"
INSTALL_DIR="${PII_FREELY_HOME:-$HOME/.pii-freely}"
TARBALL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"

command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required but not installed."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required but not installed."; exit 1; }

echo "Installing pii-freely to $INSTALL_DIR"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$TARBALL" | tar -xz -C "$TMPDIR" --strip-components=1

mkdir -p "$INSTALL_DIR/profiles"
for f in package.json package-lock.json index.js cli.js infra-patterns.js refiners.js config.default.json warmup.js; do
  cp "$TMPDIR/$f" "$INSTALL_DIR/"
done
cp "$TMPDIR"/profiles/*.json "$INSTALL_DIR/profiles/"

cd "$INSTALL_DIR"
npm install --omit=dev 2>&1

chmod +x "$INSTALL_DIR/cli.js"

echo "Downloading model weights..."
node "$INSTALL_DIR/warmup.js" 2>&1

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/cli.js" "$BIN_DIR/pfree"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "Note: $BIN_DIR is not in your PATH."
  echo "Add it with:  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "Installed. Test with:"
echo "  pfree redact <<< 'test@example.com'"
