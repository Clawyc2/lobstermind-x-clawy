#!/usr/bin/env bash

# 🦞 LobsterMind Memory - Quick Install Script
# For macOS and Linux

set -e

echo "🦞 LobsterMind Memory - Installing..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    echo "   Install from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "❌ Node.js 22 or higher is required. You have: $(node -v)"
    echo "   Install from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check for OpenClaw
if ! command -v openclaw &> /dev/null; then
    echo "❌ OpenClaw is not installed."
    echo "   Install with: npm install -g openclaw@latest"
    exit 1
fi

echo "✅ OpenClaw installed: $(openclaw --version)"

# Set up extensions directory
OPENCLAW_EXT="$HOME/.openclaw/extensions/lobstermind-memory"

if [ -d "$OPENCLAW_EXT" ]; then
    echo "⚠️  Plugin already exists at $OPENCLAW_EXT"
    read -p "Do you want to reinstall? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    rm -rf "$OPENCLAW_EXT"
fi

# Clone repository
echo "📦 Cloning repository..."
git clone https://github.com/pnll1991/lobstermind-memory.git "$OPENCLAW_EXT"

# Install dependencies
echo "📦 Installing dependencies..."
cd "$OPENCLAW_EXT"
npm install

# Update openclaw.json
echo "⚙️  Updating OpenClaw configuration..."
CONFIG_FILE="$HOME/.openclaw/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ OpenClaw configuration not found at $CONFIG_FILE"
    echo "   Run 'openclaw onboard' first to initialize OpenClaw."
    exit 1
fi

# Backup config
cp "$CONFIG_FILE" "$CONFIG_FILE.bak"

# Add plugin config if not present (using node with jq or simple echo)
if command -v jq &> /dev/null; then
    # Check if plugins.entries exists
    if jq -e '.plugins.entries' "$CONFIG_FILE" > /dev/null 2>&1; then
        # Add lobstermind-memory entry
        jq '.plugins.entries["lobstermind-memory"] = {"enabled": true, "config": {"enabled": true}}' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
        mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
        # Create plugins.entries
        jq '.plugins.entries = {"lobstermind-memory": {"enabled": true, "config": {"enabled": true}}}' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
        mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    fi
    
    # Check if plugins.slots exists
    if jq -e '.plugins.slots' "$CONFIG_FILE" > /dev/null 2>&1; then
        jq '.plugins.slots.memory = "lobstermind-memory"' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
        mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
        jq '.plugins.slots = {"memory": "lobstermind-memory"}' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
        mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    fi
else
    echo "⚠️  jq not found. Please manually add to openclaw.json:"
    echo ""
    echo '  "plugins": {'
    echo '    "slots": {'
    echo '      "memory": "lobstermind-memory"'
    echo '    },'
    echo '    "entries": {'
    echo '      "lobstermind-memory": {'
    echo '        "enabled": true,'
    echo '        "config": {'
    echo '          "enabled": true'
    echo '        }'
    echo '      }'
    echo '    }'
    echo '  }'
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📖 Next steps:"
echo "   1. Restart OpenClaw: openclaw doctor"
echo "   2. Test the plugin: openclaw memories --help"
echo "   3. Add a memory: openclaw memories --add \"Your memory here\""
echo ""
echo "📚 Documentation: https://github.com/pnll1991/lobstermind-memory"
echo ""
