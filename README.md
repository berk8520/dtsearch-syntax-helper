# dtSearch Synt## Features
- **🎨 Syntax Highlighting**: Color-coded operators, search terms, and noise words
- **⚠️ Error Detection**: Real-time validation for unbalanced parentheses and quotes  
- **🔧 Query Cleanup**: Smart formatting with operator normalization and quote standardization
- **🔀 OR Splitting**: Automatically split complex OR queries into simple combinations
- **🛠️ Auto-Fix**: Intelligent correction of common query mistakes and formatting issues
- **📊 Status Integration**: Live balance checking in status bar
- **📚 Built-in Help**: Comprehensive dtSearch operator reference
- **💡 Smart Tooltips**: Hover over operators and noise words to understand why they're highlightedr

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
- **� OR Splitting**: Automatically split complex OR queries into simple combinations
- **�📊 Status Integration**: Live balance checking in status bar
- **📚 Built-in Help**: Comprehensive dtSearch operator reference
- **💡 Smart Tooltips**: Hover over operators and noise words to understand why they're highlighted

## Quick Start
1. Install the extension
2. Select any dtSearch query text
3. Press `Ctrl+Shift+F` to clean up and enable syntax highlighting
4. Press `Ctrl+Shift+S` to split complex OR queries into combinations
5. Press `Ctrl+Shift+X` to auto-fix common mistakes and formatting issues
6. Get real-time visual feedback as you edit

### Auto-Fix Examples
Automatically detect and fix common query issues:

**Duplicate Operators:**
```
Input:  apple AND AND banana
Output: apple AND banana
```

**Unbalanced Parentheses:**
```
Input:  (apple AND banana
Output: (apple AND banana)
```

**Common Misspellings:**
```
Input:  appel AND banan W/5 documnt
Output: apple AND banana W/5 document
```

**Invalid Proximity:**
```
Input:  apple w5 banana
Output: apple W/5 banana
```

### OR Query Splitting Example
Transform complex OR queries into simple combinations:

**Input:**
```
(dog OR cat OR bird) W/5 (house OR yard OR field)
```

**Output:** (automatically inserted below the original)
```
dog W/5 house
dog W/5 yard
dog W/5 field
cat W/5 house
cat W/5 yard
cat W/5 field
bird W/5 house
bird W/5 yard
bird W/5 field
```

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
* `DT Search: Split OR Searches` (`Ctrl+Shift+S`): Split complex OR queries into individual search combinations
* `DT Search: Auto-Fix Query` (`Ctrl+Shift+X`): Automatically fix common mistakes and formatting issues
* `DT Search: Toggle Syntax Highlighting`: Enable/disable highlighting for current editor
* `DT Search: Show Operator Help` (`F1` in .dts files): Display comprehensive operator reference

## License

MIT License - see LICENSE file for details.
