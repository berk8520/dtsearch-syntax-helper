# 🚀 dtSearch Syntax Helper - Ready for Testing

## 📦 Package Contents

### Core Files
- **`dtsearchsyntaxhelper-0.0.1.vsix`** - Main extension package (37.5 KB)
- **`TESTING_INSTRUCTIONS.md`** - Detailed testing guide and feature overview

### Installation Scripts
- **`install.bat`** - Windows installation script
- **`install.sh`** - Linux/Mac installation script

### Test Files
- **`test-tree-flow.dt`** - Simple test query for tree visualization
- **`test-proximity-validation.dt`** - Comprehensive test cases (6.9 KB)

## ⚡ Quick Start

### Windows
1. Double-click `install.bat`
2. Follow the prompts
3. Restart VS Code
4. Open `test-tree-flow.dt`

### Linux/Mac
1. Run `chmod +x install.sh && ./install.sh`
2. Follow the prompts
3. Restart VS Code
4. Open `test-tree-flow.dt`

### Manual Installation
1. Open VS Code
2. Press `Ctrl+Shift+P` (`Cmd+Shift+P` on Mac)
3. Type "Extensions: Install from VSIX"
4. Select `dtsearchsyntaxhelper-0.0.1.vsix`
5. Restart VS Code

## 🎯 Key Features to Test

### 🌳 Tree-Based Flow Diagram (NEW!)
- Open any `.dt` file
- Right-click → "DT Search: Show Operator Flow Diagram"
- **OR** `Ctrl+Shift+P` → "dtSearch: Show Operator Flow Diagram"

**What to expect:**
- 🌳 Hierarchical query tree visualization
- 🟢🟡🔴 Performance impact badges
- ⚡ Overall performance score (0-100)
- 🚀 Optimization suggestions
- 📊 Execution summary

### 🔍 Tree View (Activity Bar)
- "dtSearch" icon appears in Activity Bar when `.dt` file is open
- Click dtSearch icon to open dedicated dtSearch panel
- Click tree nodes to jump to query parts
- Real-time updates as you edit
- **Accessible without needing a folder/workspace open!**

### 🛠️ Context Menu Commands
- Clean Up Query (`Ctrl+Shift+F`)
- Review Errors (`Ctrl+Shift+X`)
- Split OR Searches (`Ctrl+Shift+S`)
- Show Operator Help (`F1`)

## 📝 Test Scenarios

### Simple Test
```dtSearch
(dog OR cat) AND bird
```

### Complex Test  
```dtSearch
(contract OR agreement) AND legal W/10 document NOT invalid
```

### Performance Test
```dtSearch
*apple AND (many OR terms OR in OR group) W/100 document
```

## 🔧 System Requirements
- **VS Code:** 1.102.0 or higher
- **OS:** Windows, Linux, or macOS
- **Memory:** Minimal impact, processes queries efficiently

## 📊 Version Information
- **Version:** 0.0.1
- **Build Date:** August 8, 2025
- **Package Size:** 37.5 KB
- **Features:** Tree visualization, performance analysis, syntax validation

## 🆘 Support
For issues or questions, refer to `TESTING_INSTRUCTIONS.md` for troubleshooting steps.
