# dtSearch Syntax Helper

A VS Code extension that provides advanced syntax highlighting and formatting tools for dtSearch boolean queries.

## Screenshots

### Syntax Highlighting in Action
![dtSearch syntax highlighting showing color-coded operators, parentheses matching, and noise word highlighting](images/syntax-highlighting-demo.png)

### Error Detection
![Real-time error detection showing unbalanced parentheses and quotes with red squiggly lines](images/error-detection-demo.png)

### Query Cleanup
![Before and after query cleanup showing normalized operators and standardized quotes](images/query-cleanup-demo.png)

## Features
- **🎨 Syntax Highlighting**: Color-coded operators, search terms, and noise words
- **⚠️ Error Detection**: Real-time validation for unbalanced parentheses and quotes  
- **🔧 Query Cleanup**: Smart formatting with operator normalization and quote standardization
- **📊 Status Integration**: Live balance checking in status bar
- **📚 Built-in Help**: Comprehensive dtSearch operator reference

## Quick Start
1. Install the extension
2. Select any dtSearch query text
3. Press `Ctrl+Shift+F` to clean up and enable syntax highlighting
4. Get real-time visual feedback as you edit

## File Support
- Native support for `.dts` files
- Works with any file type when using cleanup command

Perfect for legal discovery, enterprise search, and dtSearch query development.

## Configuration

This extension contributes the following settings:

* `dtsearch.enableSyntaxHighlighting`: Enable/disable real-time syntax highlighting
* `dtsearch.highlightNoiseWords`: Highlight noise words that are typically ignored by dtSearch
* `dtsearch.showBalanceErrors`: Show red squiggly lines for unbalanced parentheses and quotes
* `dtsearch.autoCleanupOnSave`: Automatically clean up queries when saving .dts files

## Commands

* `DT Search: Clean Up Query` (`Ctrl+Shift+F`): Format and normalize selected query text
* `DT Search: Toggle Syntax Highlighting`: Enable/disable highlighting for current editor
* `DT Search: Show Operator Help` (`F1` in .dts files): Display comprehensive operator reference

## License

MIT License - see LICENSE file for details.
