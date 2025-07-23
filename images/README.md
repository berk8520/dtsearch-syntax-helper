# Screenshots Needed

To complete the documentation, please take the following screenshots and save them in this directory:

## 1. syntax-highlighting-demo.png
**What to show:**
- A dtSearch query with various elements highlighted:
  - Boolean operators (AND, OR, NOT) in blue
  - Proximity operators (W/5, PRE/3) in blue
  - Search terms in gray
  - Noise words (the, and, of, etc.) in magenta
  - Color-coded parentheses in different colors
  - Special operators (*, ?, ~) in purple
  - Quotes properly paired

**Example query to use:**
```
(apple OR orange) AND NOT (banana W/5 fruit) AND date(2023) AND "exact phrase" AND the quick brown
```

## 2. error-detection-demo.png
**What to show:**
- Unbalanced parentheses with red squiggly lines
- Unmatched quotes with red squiggly lines
- Status bar showing warning indicators

**Example query to use:**
```
(apple OR orange AND NOT banana W/5 fruit) AND "unmatched quote AND another phrase"
```

## 3. query-cleanup-demo.png
**What to show:**
- Split screen or before/after showing:
  - Before: messy query with mixed case, single quotes
  - After: cleaned query with proper case, double quotes
  - Maybe show the command palette or right-click menu

**Example before:**
```
apple and orange or not banana w/5 'exact phrase' AND The Quick Brown
```

**Example after:**
```
apple AND orange OR NOT banana W/5 "exact phrase" AND the quick brown
```

## How to take screenshots:
1. Open VS Code with the extension installed
2. Create a .dts file or use the cleanup command on any file
3. Type the example queries above
4. Use VS Code's built-in screenshot tools or external tools
5. Save as PNG files with the exact names listed above
6. Replace this file or keep it for reference

## Tips:
- Use a clear, readable font size
- Choose a theme that shows the colors well (Dark+ or Light+ recommended)
- Crop to show just the relevant editor area
- Make sure the syntax highlighting is clearly visible
