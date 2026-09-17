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

SHELL_NAME="$(basename "$SHELL")"
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  *)    RC_FILE="" ;;
esac

ALIAS_LINE="alias pfree='node $INSTALL_DIR/cli.js'"

if [ -n "$RC_FILE" ]; then
  if ! grep -qF "pfree" "$RC_FILE" 2>/dev/null; then
    echo "" >> "$RC_FILE"
    echo "# pii-freely" >> "$RC_FILE"
    echo "$ALIAS_LINE" >> "$RC_FILE"
    echo "Added alias to $RC_FILE. Run: source $RC_FILE"
  else
    echo "Alias already exists in $RC_FILE"
  fi
else
  echo "Add this alias to your shell config:"
  echo "  $ALIAS_LINE"
fi

echo ""
echo "Installed. Test with:"
echo "  echo 'test@example.com' | pfree redact"
