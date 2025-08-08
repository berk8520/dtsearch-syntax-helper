# dtSearch Syntax Helper - Testing Instructions

## 📦 Installation on Another Machine

### Quick Install
1. Copy the `dtsearchsyntaxhelper-0.0.1.vsix` file to the target machine
2. Open VS Code on the target machine
3. Press `Ctrl+Shift+P` to open command palette
4. Type "Extensions: Install from VSIX"
5. Select the `dtsearchsyntaxhelper-0.0.1.vsix` file
6. Restart VS Code

### Alternative Install via Command Line
```bash
code --install-extension dtsearchsyntaxhelper-0.0.1.vsix
```

## 🧪 Testing the New Tree-Based Flow Diagram

### Test Files Included
- `test-tree-flow.dt` - Simple test query for the new tree visualization
- `test-proximity-validation.dt` - Comprehensive test cases

### Key Features to Test

#### 1. Tree View (Activity Bar)
- **dtSearch icon should ALWAYS be visible** in the Activity Bar (left sidebar)
- Click the dtSearch icon to open the dtSearch panel
- **Works with or without a folder open** - no workspace required!
- When a `.dt` file is open: Shows hierarchical query structure
- When no `.dt` file is open: Shows welcome message with helpful links
- Test clicking on tree nodes to jump to query parts
- **This should work even when opening a single .dt file without a folder**

#### 2. Tree-Based Flow Diagram
- Open a `.dt` file with a query
- Right-click → "DT Search: Show Operator Flow Diagram"
- **OR** Press `Ctrl+Shift+P` → "dtSearch: Show Operator Flow Diagram"

**Expected Output:**
```
# dtSearch Query Tree Analysis

## 🌳 Query Structure Tree
├── 🔗 AND Operation 🟢 Fast
│   ├── 🔀 OR Operation 🟡 Moderate
│   └── ↔️ W/5 Operation 🟡 Moderate

## 🔍 Operation Analysis
- Performance impact badges (🟢🟡🔴)
- Detailed analysis for each operation

## ⚡ Performance Summary
- Overall score: XX/100 (Rating)
- Issues and recommendations

## 🚀 Optimization Suggestions
- Actionable query improvements

## 📊 Expected Execution
- Component counts and execution order
```

#### 3. Test Queries
Try these in any `.dt` file:

**Simple Test:**
```
(dog OR cat) AND bird
```

**Complex Test:**
```
(contract OR agreement) AND legal W/10 document NOT invalid
```

**Performance Test:**
```
*apple AND (many OR terms OR in OR single OR group) W/100 document
```

#### 4. Validation Features
- Open `test-proximity-validation.dt`
- Check for error squiggly lines on complex proximity patterns
- Hover over operators for help tooltips
- Test auto-formatting (type `and` followed by space → should become `AND`)

#### 5. Context Menu Commands
Right-click in any `.dt` file to access:
- Clean Up Query
- Review Errors  
- Split OR Searches
- Show Operator Help
- Send Line to Tree View
- Show Operator Flow Diagram

### Keyboard Shortcuts
- `Ctrl+Shift+F` - Clean Up Query
- `Ctrl+Shift+S` - Split OR Searches  
- `Ctrl+Shift+X` - Review Errors
- `F1` - Show Operator Help

## 🔧 Troubleshooting

### Tree View Not Showing
- **dtSearch icon should ALWAYS be in Activity Bar** - look for it in the left sidebar
- Click the dtSearch icon to open the panel (works without any folder open)
- If no dtSearch icon: Ensure extension is installed and enabled
- Try reloading window (`Ctrl+Shift+P` → "Reload Window")
- **Fixed: Tree view now works with single files, no workspace/folder required**

### Performance Issues
- Large queries may take a moment to analyze
- Complex nested queries are processed recursively

### Extension Not Loading
- Check VS Code version (requires 1.102.0+)
- Verify installation: `Ctrl+Shift+P` → "Extensions: Show Installed Extensions"
- Look for "dtSearchSyntaxHelper" in the list

## 📊 What's New in This Version

### ✨ Tree-Based Flow Diagram
- **Hierarchical visualization** instead of step-by-step flow
- **Performance scoring** (0-100) with ratings
- **Impact badges** for immediate visual feedback
- **Smart suggestions** based on actual query structure

### 🐛 Bug Fixes
- Fixed tree view activation for `.dt` files
- Enhanced cross-group proximity validation
- Improved syntax error detection

### 🚀 Performance Focus
- Identifies slow operations (NOT, large OR groups)
- Warns about performance killers (leading wildcards)
- Provides specific optimization recommendations

## 📝 Feedback
Test results and feedback can be reported to the development team.
