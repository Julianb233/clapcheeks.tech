#!/bin/bash
set -e
echo "Installing Clap Cheeks agent..."
pip install -e ".[all]"
playwright install chromium
echo ""
echo "✓ Installation complete!"
echo "Run: clapcheeks setup"
