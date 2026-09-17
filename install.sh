#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${PII_FREELY_HOME:-$HOME/.pii-freely}"

echo "Installing pii-freely to $INSTALL_DIR"

if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
else
  mkdir -p "$INSTALL_DIR"
fi

cp package.json index.js cli.js infra-patterns.js refiners.js config.default.json "$INSTALL_DIR/"
cp -r profiles "$INSTALL_DIR/"

cd "$INSTALL_DIR"
npm install --production 2>&1

chmod +x "$INSTALL_DIR/cli.js"

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
