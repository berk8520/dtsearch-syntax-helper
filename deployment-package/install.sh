#!/bin/bash

echo "Installing dtSearch Syntax Helper Extension..."
echo

# Check if VS Code is available
if ! command -v code &> /dev/null; then
    echo "ERROR: VS Code 'code' command not found in PATH"
    echo "Please ensure VS Code is installed and added to PATH"
    echo
    echo "Manual installation:"
    echo "1. Open VS Code"
    echo "2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)"
    echo "3. Type 'Extensions: Install from VSIX'"
    echo "4. Select dtsearchsyntaxhelper-0.0.1.vsix"
    read -p "Press Enter to continue..."
    exit 1
fi

echo "Installing extension..."
code --install-extension dtsearchsyntaxhelper-0.0.1.vsix

if [ $? -eq 0 ]; then
    echo
    echo "✅ Installation completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Restart VS Code"
    echo "2. Open test-tree-flow.dt to test the extension"
    echo "3. See TESTING_INSTRUCTIONS.md for detailed testing guide"
    echo
    echo "Features to test:"
    echo "- Tree view in Explorer sidebar"
    echo "- Flow diagram: Right-click → 'Show Operator Flow Diagram'"
    echo "- Context menu commands and keyboard shortcuts"
else
    echo
    echo "❌ Installation failed!"
    echo "Please try manual installation:"
    echo "1. Open VS Code"
    echo "2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)"
    echo "3. Type 'Extensions: Install from VSIX'"
    echo "4. Select dtsearchsyntaxhelper-0.0.1.vsix"
fi

echo
read -p "Press Enter to continue..."
