import * as vscode from 'vscode';

// Define decoration types for syntax highlighting
let operatorDecorationType: vscode.TextEditorDecorationType;
let searchTermDecorationType: vscode.TextEditorDecorationType;
let parenDecorationTypes: vscode.TextEditorDecorationType[] = [];
let quoteDecorationType: vscode.TextEditorDecorationType;
let unmatchedQuoteDecorationType: vscode.TextEditorDecorationType;
let specialOperatorDecorationType: vscode.TextEditorDecorationType;
let noiseWordDecorationType: vscode.TextEditorDecorationType;

// Global state
let isHighlightingEnabled = true;
let statusBarItem: vscode.StatusBarItem;
let forceDtSearchMode = false; // Flag to force dtSearch highlighting

// Diagnostic collection for syntax validation
let diagnosticCollection: vscode.DiagnosticCollection;

// Debouncing for performance
let highlightTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Initialize decoration types and status bar
  initializeDecorations();
  
  // Initialize diagnostic collection for syntax validation
  diagnosticCollection = vscode.languages.createDiagnosticCollection('dtsearch');
  context.subscriptions.push(diagnosticCollection);
  
  // Initialize status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'dtsearchsyntaxhelper.toggleHighlighting';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  // Load configuration
  const config = vscode.workspace.getConfiguration('dtsearch');
  isHighlightingEnabled = config.get('enableSyntaxHighlighting', true);

  // Register hover provider for noise word tooltips
  const hoverProvider = vscode.languages.registerHoverProvider('*', {
    provideHover(document, position, token) {
      return provideNoiseWordHover(document, position);
    }
  });
  context.subscriptions.push(hoverProvider);

  // DT Search: Clean Up Query command
  let cleanUpQuery = vscode.commands.registerCommand('dtsearchsyntaxhelper.cleanUpQuery', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found.');
      return;
    }

    const selection = editor.selection;
    let text = editor.document.getText(selection);

    if (!text) {
      vscode.window.showWarningMessage('No text selected.');
      return;
    }

    // 1. Normalize operators to UPPER and other words to lower
    const operatorList = [
      'AND', 'OR', 'NOT', 'ANDANY',
      'W/\\d+', 'PRE/\\d+', 'NOT\\s+W/\\d+',
      'NEAR', 'WITHIN', 'SENTENCE', 'PARAGRAPH', 'DOCUMENT',
      'CAPS', 'STEM', 'SOUNDEX', 'NUMERIC', 'ALPHANUMERIC'
    ]; // Extended operator list
    const operatorPattern = '\\b(' + operatorList.join('|') + ')\\b';
    const operatorRegex = new RegExp(operatorPattern, 'gi');

    // Uppercase operators
    text = text.replace(operatorRegex, (match) => match.toUpperCase());
    // Lowercase non-operators (excluding special keywords and field functions)
    text = text.replace(/\b(?!AND\b|OR\b|NOT\b|ANDANY\b|NEAR\b|W\/\d+\b|PRE\/\d+\b|WITHIN\b|SENTENCE\b|PARAGRAPH\b|DOCUMENT\b|xfirstword\b|xlastword\b|date\b|mail\b|creditcard\b|caps\b|stem\b|soundex\b|numeric\b|alphanumeric\b|contains\b|field\b)(\w+)\b/gi, (match) => match.toLowerCase());

    // Convert all single quotes to double quotes
    text = text.replace(/'/g, '"');

    await editor.edit(editBuilder => {
      editBuilder.replace(selection, text);
    });

    // Enable dtSearch mode for this editor and apply syntax highlighting
    forceDtSearchMode = true;
    highlightSyntax(editor);
    updateStatusBar();

    // Check parentheses and quotes balance after cleanup
    const parenStack: string[] = [];
    let balanced = true;
    for (const char of text) {
      if (char === '(') {
        parenStack.push(char);
      }
      if (char === ')') {
        if (parenStack.length > 0) {
          parenStack.pop();
        } else {
          balanced = false;
          break;
        }
      }
    }
    if (parenStack.length > 0) {
      balanced = false;
    }

    // Check double and single quotes
    const doubleQuotes = (text.match(/"/g) || []).length;
    const quotesBalanced = doubleQuotes % 2 === 0;

    // Show combined result message
    if (balanced && quotesBalanced) {
      if (text.trim().split(/\s+/).length > 1) {
        vscode.window.showInformationMessage('Query cleaned up and balanced, please review for accuracy.');
      } else {
        vscode.window.showInformationMessage('Query cleaned up and balanced.');
      }
    } else {
      let msg = 'Query cleaned up but unbalanced:';
      if (!balanced) {
        msg += ' parentheses';
      }
      if (!quotesBalanced) {
        msg += ' quotes';
      }
      vscode.window.showWarningMessage(msg + ', please check your query.');
    }
  });
  context.subscriptions.push(cleanUpQuery);

  // DT Search: Toggle Highlighting command
  let toggleHighlighting = vscode.commands.registerCommand('dtsearchsyntaxhelper.toggleHighlighting', () => {
    isHighlightingEnabled = !isHighlightingEnabled;
    const config = vscode.workspace.getConfiguration('dtsearch');
    config.update('enableSyntaxHighlighting', isHighlightingEnabled, true);
    
    if (vscode.window.activeTextEditor) {
      if (isHighlightingEnabled) {
        highlightSyntax(vscode.window.activeTextEditor);
      } else {
        clearAllDecorations(vscode.window.activeTextEditor);
      }
    }
    
    updateStatusBar();
    vscode.window.showInformationMessage(`dtSearch syntax highlighting ${isHighlightingEnabled ? 'enabled' : 'disabled'}`);
  });
  context.subscriptions.push(toggleHighlighting);

  // DT Search: Show Operator Help command
  let showOperatorHelp = vscode.commands.registerCommand('dtsearchsyntaxhelper.showOperatorHelp', () => {
    showOperatorHelpPanel();
  });
  context.subscriptions.push(showOperatorHelp);

  // DT Search: Split OR Searches command
  let splitOrSearches = vscode.commands.registerCommand('dtsearchsyntaxhelper.splitOrSearches', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found.');
      return;
    }

    const selection = editor.selection;
    let text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('No text selected.');
      return;
    }

    const splitQueries = splitOrQuery(text.trim());
    
    if (splitQueries.length <= 1) {
      vscode.window.showInformationMessage('No OR operators found to split, or query is already simple.');
      return;
    }

    // Insert the split queries after the current line
    const currentLine = selection.end.line;
    const insertPosition = new vscode.Position(currentLine + 1, 0);
    
    const splitText = '\n' + splitQueries.join('\n') + '\n';

    await editor.edit(editBuilder => {
      editBuilder.insert(insertPosition, splitText);
    });

    // Enable dtSearch mode for this editor and apply syntax highlighting
    forceDtSearchMode = true;
    highlightSyntax(editor);
    updateStatusBar();

    vscode.window.showInformationMessage(`Split into ${splitQueries.length} individual search queries.`);
  });
  context.subscriptions.push(splitOrSearches);

  // DT Search: Review Errors command
  let reviewErrors = vscode.commands.registerCommand('dtsearchsyntaxhelper.reviewErrors', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found.');
      return;
    }

    const selection = editor.selection;
    let text = editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage('No text selected.');
      return;
    }

    const fixes = analyzeAndSuggestFixes(text.trim());
    
    if (fixes.length === 0) {
      vscode.window.showInformationMessage('No common issues found in the selected query.');
      return;
    }

    // Show fixes to user and let them choose
    const fixItems: vscode.QuickPickItem[] = fixes.map((fix, index) => ({
      label: `${index + 1}. ${fix.description}`,
      description: fix.lineNumber ? `📍 Line ${fix.lineNumber}` : undefined,
      detail: fix.lineNumber ? 'Click to go to line, then press Enter to apply fix' : 'Press Enter to apply fix'
    }));

    const selectedFix = await vscode.window.showQuickPick(
      [
        { label: 'Apply All Fixes', description: `${fixes.length} fixes available`, detail: 'Apply all suggested fixes at once' },
        ...fixItems,
        { label: 'Cancel', detail: 'Exit without applying any fixes' }
      ],
      {
        placeHolder: 'Select which fix to apply',
        title: `Found ${fixes.length} potential fix(es)`,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!selectedFix || selectedFix.label === 'Cancel') {
      return;
    }

    let fixedText = text;
    if (selectedFix.label === 'Apply All Fixes') {
      // Apply all fixes in order - each fix now preserves structure
      for (const fix of fixes) {
        fixedText = fix.apply(fixedText);
      }
    } else {
      // Apply selected fix
      const fixIndex = parseInt(selectedFix.label.split('.')[0]) - 1;
      fixedText = fixes[fixIndex].apply(fixedText);
    }

    await editor.edit(editBuilder => {
      editBuilder.replace(selection, fixedText);
    });

    // Enable dtSearch mode for this editor and apply syntax highlighting
    forceDtSearchMode = true;
    highlightSyntax(editor);
    updateStatusBar();

    vscode.window.showInformationMessage('Query auto-fixed successfully!');
  });

  context.subscriptions.push(reviewErrors);

  // Register command for jumping to line (for clickable line numbers)
  let jumpToLine = vscode.commands.registerCommand('dtsearchsyntaxhelper.jumpToLine', (lineNumber: number) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && lineNumber > 0) {
      const position = new vscode.Position(lineNumber - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  });

  context.subscriptions.push(jumpToLine);

  // Initialize and register Query Tree Provider
  queryTreeProvider = new QueryTreeProvider();
  vscode.window.registerTreeDataProvider('dtsearchQueryTree', queryTreeProvider);

  // Register tree view commands
  const refreshQueryTree = vscode.commands.registerCommand('dtsearchsyntaxhelper.refreshQueryTree', () => {
    queryTreeProvider.refresh();
  });
  context.subscriptions.push(refreshQueryTree);

  const jumpToQueryNode = vscode.commands.registerCommand('dtsearchsyntaxhelper.jumpToQueryNode', (position: {start: number, end: number}) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && position) {
      let startPos: vscode.Position;
      let endPos: vscode.Position;
      
      if (queryTreeProvider.isInCustomQueryMode()) {
        // In custom query mode, adjust positions to the original line
        const customLineInfo = queryTreeProvider.getCustomLineInfo();
        if (customLineInfo.lineNumber >= 0) {
          const line = editor.document.lineAt(customLineInfo.lineNumber);
          const lineStart = line.range.start;
          
          // Find the start of the actual query text within the line (skip leading whitespace)
          const lineText = line.text;
          const queryStartInLine = lineText.indexOf(customLineInfo.queryText);
          const absoluteQueryStart = lineStart.character + queryStartInLine;
          
          // Calculate the absolute positions
          const absoluteStart = absoluteQueryStart + position.start;
          const absoluteEnd = absoluteQueryStart + position.end;
          
          startPos = new vscode.Position(customLineInfo.lineNumber, absoluteStart);
          endPos = new vscode.Position(customLineInfo.lineNumber, absoluteEnd);
        } else {
          // Fallback to document positions
          startPos = editor.document.positionAt(position.start);
          endPos = editor.document.positionAt(position.end);
        }
      } else {
        // Normal mode - use document positions directly
        startPos = editor.document.positionAt(position.start);
        endPos = editor.document.positionAt(position.end);
      }
      
      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
    }
  });
  context.subscriptions.push(jumpToQueryNode);

  const sendLineToTree = vscode.commands.registerCommand('dtsearchsyntaxhelper.sendLineToTree', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      let lineText: string;
      let lineNumber: number;
      let startOffset: number;
      
      if (selection.isEmpty) {
        // No selection, use current line
        const currentLine = editor.document.lineAt(selection.active.line);
        lineText = currentLine.text.trim();
        lineNumber = selection.active.line;
        startOffset = currentLine.range.start.character;
      } else {
        // Use selected text
        lineText = editor.document.getText(selection).trim();
        lineNumber = selection.start.line;
        startOffset = selection.start.character;
      }
      
      // Filter out comment lines and empty lines
      if (lineText && !lineText.startsWith('//') && lineText.length > 0) {
        // Update the tree view with just this line and context information
        queryTreeProvider.setCustomQuery(lineText, lineNumber, startOffset);
      } else {
        vscode.window.showInformationMessage('Please select a valid query line (not a comment or empty line)');
      }
    }
  });
  context.subscriptions.push(sendLineToTree);

  const showOperatorFlow = vscode.commands.registerCommand('dtsearchsyntaxhelper.showOperatorFlow', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      let queryText: string;
      
      if (selection.isEmpty) {
        // No selection, use current line
        const currentLine = editor.document.lineAt(selection.active.line);
        queryText = currentLine.text.trim();
      } else {
        // Use selected text
        queryText = editor.document.getText(selection).trim();
      }
      
      // Filter out comment lines and empty lines
      if (queryText && !queryText.startsWith('//') && queryText.length > 0) {
        showOperatorFlowDiagram(queryText);
      } else {
        vscode.window.showInformationMessage('Please select a valid query line (not a comment or empty line)');
      }
    }
  });
  context.subscriptions.push(showOperatorFlow);

  // Register event listeners for active editor changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    // Reset force mode when switching editors
    forceDtSearchMode = false;
    
    if (editor && isDtSearchFile(editor)) {
      debouncedHighlight(editor);
      validateSyntax(editor.document);
      updateStatusBar();
    }
    
    // Always refresh tree (will show empty if not dtSearch file)
    if (queryTreeProvider) {
      queryTreeProvider.refresh();
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    if (vscode.window.activeTextEditor && 
        event.document === vscode.window.activeTextEditor.document &&
        isDtSearchFile(vscode.window.activeTextEditor)) {
      
      // Handle real-time operator formatting
      handleRealTimeFormatting(event, vscode.window.activeTextEditor);
      
      debouncedHighlight(vscode.window.activeTextEditor);
      validateSyntax(event.document);
      updateStatusBar();
      
      // Refresh query tree
      if (queryTreeProvider) {
        queryTreeProvider.refresh();
      }
    }
  }, null, context.subscriptions);

  // Auto-save cleanup if enabled
  vscode.workspace.onDidSaveTextDocument(document => {
    const config = vscode.workspace.getConfiguration('dtsearch');
    if (config.get('autoCleanupOnSave', false) && document.fileName.endsWith('.dt')) {
      // Auto-cleanup would go here if selection exists
    }
  }, null, context.subscriptions);

  // Configuration change listener
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('dtsearch')) {
      const config = vscode.workspace.getConfiguration('dtsearch');
      isHighlightingEnabled = config.get('enableSyntaxHighlighting', true);
      if (vscode.window.activeTextEditor && isDtSearchFile(vscode.window.activeTextEditor)) {
        highlightSyntax(vscode.window.activeTextEditor);
      }
      updateStatusBar();
    }
  }, null, context.subscriptions);

  // Initial highlighting and status
  if (vscode.window.activeTextEditor && isDtSearchFile(vscode.window.activeTextEditor)) {
    highlightSyntax(vscode.window.activeTextEditor);
    updateStatusBar();
  }
}

// Helper functions
function isDtSearchFile(editor: vscode.TextEditor): boolean {
  const fileName = editor.document.fileName.toLowerCase();
  return fileName.endsWith('.dt') || editor.document.languageId === 'dtsearch' || forceDtSearchMode;
}

function debouncedHighlight(editor: vscode.TextEditor) {
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
  }
  highlightTimeout = setTimeout(() => {
    if (isHighlightingEnabled) {
      highlightSyntax(editor);
    }
  }, 150); // 150ms debounce
}

function updateStatusBar() {
  if (!statusBarItem) {
    return;
  }
  
  const editor = vscode.window.activeTextEditor;
  if (editor && isDtSearchFile(editor)) {
    const text = editor.document.getText();
    const parenBalance = getParenthesesBalance(text);
    const quoteBalance = getQuoteBalance(text);
    
    let statusText = `dtSearch: ${isHighlightingEnabled ? '✓' : '✗'}`;
    if (parenBalance !== 0 || quoteBalance !== 0) {
      statusText += ` ⚠️`;
    }
    
    statusBarItem.text = statusText;
    statusBarItem.tooltip = `dtSearch Syntax Helper (Click to toggle)\nParentheses: ${parenBalance === 0 ? 'Balanced' : 'Unbalanced'}\nQuotes: ${quoteBalance === 0 ? 'Balanced' : 'Unbalanced'}`;
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function getParenthesesBalance(text: string): number {
  let balance = 0;
  for (const char of text) {
    if (char === '(') {
      balance++;
    }
    if (char === ')') {
      balance--;
    }
  }
  return balance;
}

function getQuoteBalance(text: string): number {
  const lines = text.split('\n');
  
  // Check if any line has unbalanced quotes
  for (const line of lines) {
    const quotes = (line.match(/"/g) || []).length;
    if (quotes % 2 !== 0) {
      return 1; // Return 1 if any line is unbalanced
    }
  }
  
  return 0; // All lines are balanced
}

function clearAllDecorations(editor: vscode.TextEditor) {
  editor.setDecorations(operatorDecorationType, []);
  editor.setDecorations(searchTermDecorationType, []);
  editor.setDecorations(quoteDecorationType, []);
  editor.setDecorations(unmatchedQuoteDecorationType, []);
  editor.setDecorations(specialOperatorDecorationType, []);
  editor.setDecorations(noiseWordDecorationType, []);
  parenDecorationTypes.forEach(decorationType => {
    editor.setDecorations(decorationType, []);
  });
}

function showOperatorHelpPanel() {
  const panel = vscode.window.createWebviewPanel(
    'dtSearchHelp',
    'dtSearch Operator Help',
    vscode.ViewColumn.Beside,
    {}
  );

  panel.webview.html = getHelpContent();
}

function getHelpContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>dtSearch Operators</title>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
        .operator { margin: 10px 0; }
        .op-name { color: #007acc; font-weight: bold; }
        .example { background: var(--vscode-textBlockQuote-background); padding: 5px; margin: 5px 0; }
        .noise-word { color: #ff00ff; font-style: italic; }
    </style>
</head>
<body>
    <h1>dtSearch Query Operators</h1>
    
    <div class="operator">
        <div class="op-name">AND, OR, NOT</div>
        <div>Boolean operators for combining search terms</div>
        <div class="example">apple AND orange<br>cat OR dog<br>NOT virus</div>
    </div>
    
    <div class="operator">
        <div class="op-name">W/n (Within n words)</div>
        <div>Find terms within n words of each other</div>
        <div class="example">apple W/5 orange</div>
    </div>
    
    <div class="operator">
        <div class="op-name">PRE/n (Precedes by n words)</div>
        <div>First term must precede second by n words</div>
        <div class="example">apple PRE/3 orange</div>
    </div>
    
    <div class="operator">
        <div class="op-name">Wildcards</div>
        <div>? (single char), * (multiple chars), ~ (fuzzy)</div>
        <div class="example">appl? finds apple, apply<br>app* finds apple, application<br>apple~ finds apple, apples</div>
    </div>
    
    <div class="operator">
        <div class="op-name">Special Functions</div>
        <div>Built-in search functions</div>
        <div class="example">date(2023)<br>mail(sender@domain.com)<br>creditcard()</div>
    </div>
    
    <h2>Noise Words (highlighted in <span class="noise-word">magenta</span>)</h2>
    <p>These common words are typically ignored by dtSearch: a, an, and, are, as, at, be, by, for, from, has, he, in, is, it, of, on, that, the, to, was, will, with...</p>
</body>
</html>`;
}

function provideNoiseWordHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  // Only provide hovers for dtSearch files or when force mode is active
  const editor = vscode.window.activeTextEditor;
  if (!editor || (!isDtSearchFile(editor) && !forceDtSearchMode)) {
    return undefined;
  }

  // First, try to detect w/n or pre/n patterns by expanding the range
  const line = document.lineAt(position.line);
  const lineText = line.text;
  const charIndex = position.character;
  
  // Look for proximity patterns (w/n, pre/n) around the cursor position
  const proximityRegex = /\b(w|pre)\/\d+\b/gi;
  let match;
  while ((match = proximityRegex.exec(lineText)) !== null) {
    const startPos = match.index;
    const endPos = match.index + match[0].length;
    
    if (charIndex >= startPos && charIndex <= endPos) {
      const proximityRange = new vscode.Range(
        new vscode.Position(position.line, startPos),
        new vscode.Position(position.line, endPos)
      );
      
      const operatorText = match[0];
      const operatorType = match[1].toUpperCase();
      const hoverText = new vscode.MarkdownString();
      
      if (operatorType === 'W') {
        hoverText.appendMarkdown(`**dtSearch Proximity Operator:** \`${operatorText}\`\n\n`);
        hoverText.appendMarkdown(`Finds terms within the specified number of words of each other. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's a dtSearch proximity operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple ${operatorText} orange\` finds "apple" and "orange" within ${match[0].split('/')[1]} words of each other.`);
      } else if (operatorType === 'PRE') {
        hoverText.appendMarkdown(`**dtSearch Proximity Operator:** \`${operatorText}\`\n\n`);
        hoverText.appendMarkdown(`First term must precede the second term by the specified number of words. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's a dtSearch proximity operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple ${operatorText} orange\` finds "apple" followed by "orange" within ${match[0].split('/')[1]} words.`);
      }
      
      return new vscode.Hover(hoverText, proximityRange);
    }
  }

  // Get the word at the current position for other operators
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }

  const word = document.getText(wordRange).toLowerCase();
  
  // Define noise words (same as in highlightSyntax function)
  const noiseWords = new Set([
    'a', 'about', 'after', 'all', 'also', 'an', 'and', 'another', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by',
    'came', 'can', 'come', 'could',
    'did', 'do',
    'each', 'even',
    'for', 'from', 'further', 'furthermore',
    'get', 'got',
    'had', 'has', 'have', 'he', 'her', 'here', 'hi', 'him', 'himself', 'his', 'how', 'however',
    'i', 'if', 'in', 'indeed', 'into', 'is', 'it', 'its',
    'just',
    'like',
    'made', 'many', 'me', 'might', 'more', 'moreover', 'most', 'much', 'must', 'my',
    'never', 'not', 'now',
    'of', 'on', 'only', 'or', 'other', 'our', 'out', 'over',
    'said', 'same', 'see', 'she', 'should', 'since', 'some', 'still', 'such',
    'take', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'therefore', 'these', 'they', 'this', 'those', 'through', 'thus', 'to', 'too',
    'under', 'up',
    'very',
    'was', 'way', 'we', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would',
    'you', 'your'
  ]);

  // Check for dtSearch operators first
  const upperWord = word.toUpperCase();
  const originalText = document.getText(wordRange);
  
  // Check for boolean operators
  if (['AND', 'OR', 'NOT', 'ANDANY'].includes(upperWord)) {
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Boolean Operator:** \`${originalText}\`\n\n`);
    
    switch (upperWord) {
      case 'AND':
        hoverText.appendMarkdown(`Requires **both** terms to be present in the document. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's a core dtSearch operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple AND orange\` finds documents containing both words.`);
        break;
      case 'OR':
        hoverText.appendMarkdown(`Finds documents containing **either** term. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's a core dtSearch operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple OR orange\` finds documents with apple, orange, or both.`);
        break;
      case 'NOT':
        hoverText.appendMarkdown(`Excludes documents containing the specified term. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's a core dtSearch operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple NOT orange\` finds documents with apple but not orange.`);
        break;
      case 'ANDANY':
        hoverText.appendMarkdown(`Requires at least one of the following terms to be present. `);
        hoverText.appendMarkdown(`This is highlighted in **blue** because it's an advanced dtSearch operator.\n\n`);
        hoverText.appendMarkdown(`💡 **Example:** \`apple ANDANY (red blue green)\` finds documents with apple and at least one color.`);
        break;
    }
    
    return new vscode.Hover(hoverText, wordRange);
  }

  // Check for proximity operators
  if (['NEAR', 'WITHIN', 'SENTENCE', 'PARAGRAPH', 'DOCUMENT'].includes(upperWord)) {
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Proximity Operator:** \`${originalText}\`\n\n`);
    
    switch (upperWord) {
      case 'NEAR':
        hoverText.appendMarkdown(`Finds terms close to each other (default proximity). `);
        break;
      case 'WITHIN':
        hoverText.appendMarkdown(`Finds terms within a specified scope. `);
        break;
      case 'SENTENCE':
        hoverText.appendMarkdown(`Finds terms within the same sentence. `);
        break;
      case 'PARAGRAPH':
        hoverText.appendMarkdown(`Finds terms within the same paragraph. `);
        break;
      case 'DOCUMENT':
        hoverText.appendMarkdown(`Finds terms anywhere within the same document. `);
        break;
    }
    
    hoverText.appendMarkdown(`This is highlighted in **blue** because it's a dtSearch proximity operator.\n\n`);
    hoverText.appendMarkdown(`💡 **Example:** \`apple ${upperWord} orange\` finds terms within the specified scope.`);
    
    return new vscode.Hover(hoverText, wordRange);
  }

  // Check for special function operators
  if (['XFIRSTWORD', 'XLASTWORD', 'CAPS', 'STEM', 'SOUNDEX', 'NUMERIC', 'ALPHANUMERIC'].includes(upperWord)) {
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Special Operator:** \`${originalText}\`\n\n`);
    
    switch (upperWord) {
      case 'XFIRSTWORD':
        hoverText.appendMarkdown(`Matches terms at the beginning of documents. `);
        break;
      case 'XLASTWORD':
        hoverText.appendMarkdown(`Matches terms at the end of documents. `);
        break;
      case 'CAPS':
        hoverText.appendMarkdown(`Matches only capitalized instances of words. `);
        break;
      case 'STEM':
        hoverText.appendMarkdown(`Matches word variations and stemmed forms. `);
        break;
      case 'SOUNDEX':
        hoverText.appendMarkdown(`Matches words that sound similar (phonetic matching). `);
        break;
      case 'NUMERIC':
        hoverText.appendMarkdown(`Matches numeric values and patterns. `);
        break;
      case 'ALPHANUMERIC':
        hoverText.appendMarkdown(`Matches alphanumeric patterns. `);
        break;
    }
    
    hoverText.appendMarkdown(`This is highlighted in **blue** because it's an advanced dtSearch operator.\n\n`);
    hoverText.appendMarkdown(`💡 **Usage:** These operators modify how search terms are matched.`);
    
    return new vscode.Hover(hoverText, wordRange);
  }

  // Check for function calls (like date(), mail(), etc.)
  const functionMatch = originalText.match(/^(date|mail|creditcard|contains|field)\s*\(/i);
  if (functionMatch) {
    const funcName = functionMatch[1].toUpperCase();
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Built-in Function:** \`${funcName}()\`\n\n`);
    
    switch (funcName) {
      case 'DATE':
        hoverText.appendMarkdown(`Searches for date patterns and ranges. `);
        hoverText.appendMarkdown(`💡 **Example:** \`date(2023)\` or \`date(jan 1 2023 to dec 31 2023)\``);
        break;
      case 'MAIL':
        hoverText.appendMarkdown(`Searches for email addresses and patterns. `);
        hoverText.appendMarkdown(`💡 **Example:** \`mail(john@company.com)\` or \`mail(*@company.com)\``);
        break;
      case 'CREDITCARD':
        hoverText.appendMarkdown(`Searches for credit card number patterns. `);
        hoverText.appendMarkdown(`💡 **Example:** \`creditcard()\` finds common credit card formats.`);
        break;
      case 'CONTAINS':
        hoverText.appendMarkdown(`Searches within specific field content. `);
        hoverText.appendMarkdown(`💡 **Example:** \`contains(title, "important document")\``);
        break;
      case 'FIELD':
        hoverText.appendMarkdown(`Searches specific metadata fields. `);
        hoverText.appendMarkdown(`💡 **Example:** \`field(author, "John Smith")\``);
        break;
    }
    
    hoverText.appendMarkdown(`\n\nThis is highlighted in **blue** because it's a dtSearch built-in function.`);
    
    return new vscode.Hover(hoverText, wordRange);
  }

  // Check if the word is a noise word
  if (noiseWords.has(word)) {
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Noise Word:** \`${word}\`\n\n`);
    hoverText.appendMarkdown(`This word is typically **ignored** by dtSearch engines during searches. `);
    hoverText.appendMarkdown(`Common words like "${word}" are filtered out to improve search performance and relevance.\n\n`);
    hoverText.appendMarkdown(`This is highlighted in **magenta** to warn you that it may not affect your search results.\n\n`);
    hoverText.appendMarkdown(`💡 **Tip:** Use quotes around phrases if you need to search for noise words: \`"the ${word}"\``);
    
    return new vscode.Hover(hoverText, wordRange);
  }

  return undefined;
}

function initializeDecorations() {
  // Load configuration
  const config = vscode.workspace.getConfiguration('dtsearch');
  const enableRainbowBrackets = config.get('enableRainbowBrackets', true);
  const rainbowBracketColors = config.get('rainbowBracketColors', 12);

  // Operator decoration - blue color
  operatorDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#007acc', // Blue
    fontWeight: 'bold'
  });

  // Search term decoration - neutral color
  searchTermDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#a0a0a0' // Neutral gray
  });

  // Create rainbow parentheses decorations
  if (enableRainbowBrackets) {
    // Enhanced rainbow colors with better contrast and visibility
    const rainbowColors = [
      '#ff6b6b', // Red
      '#4ecdc4', // Teal
      '#45b7d1', // Blue
      '#a8e6cf', // Light Green
      '#ffd93d', // Yellow
      '#ff8b94', // Pink
      '#b4a7d6', // Light Purple
      '#f7b731', // Orange
      '#5f6caf', // Indigo
      '#2ed573', // Green
      '#ff9ff3', // Magenta
      '#70a1ff', // Light Blue
      '#ff7675', // Coral
      '#74b9ff', // Sky Blue
      '#fd79a8', // Hot Pink
      '#fdcb6e', // Peach
      '#6c5ce7', // Purple
      '#00b894', // Emerald
      '#e17055', // Burnt Orange
      '#0984e3'  // Royal Blue
    ];
    
    // Use only the number of colors specified in configuration
    const colorsToUse = rainbowColors.slice(0, Math.min(rainbowBracketColors, rainbowColors.length));
    
    for (let i = 0; i < colorsToUse.length; i++) {
      parenDecorationTypes.push(vscode.window.createTextEditorDecorationType({
        color: colorsToUse[i],
        fontWeight: 'bold',
        // Add subtle border for better visibility
        border: `1px solid ${colorsToUse[i]}`,
        borderRadius: '2px'
      }));
    }
  } else {
    // Fallback to simple parentheses highlighting if rainbow is disabled
    parenDecorationTypes.push(vscode.window.createTextEditorDecorationType({
      color: '#ffcc02',
      fontWeight: 'bold'
    }));
  }
  
  // Add decoration type for unmatched parentheses (red)
  parenDecorationTypes.push(vscode.window.createTextEditorDecorationType({
    color: '#ff0000', // Red text color
    fontWeight: 'bold',
    textDecoration: 'underline wavy' // Add wavy underline for emphasis
  }));

  // Quote decoration - neutral color for matched quotes
  quoteDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#d4d4aa', // Light yellow
    fontWeight: 'bold'
  });

  // Unmatched quote decoration - red with wavy underline
  unmatchedQuoteDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#ff0000', // Red text color
    fontWeight: 'bold',
    textDecoration: 'underline wavy' // Red squiggly lines
  });

  // Special operator decoration - purple color for wildcards and special chars
  specialOperatorDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#c586c0', // Purple
    fontWeight: 'bold'
  });

  // Noise word decoration - magenta text color for common words typically ignored by dtSearch
  noiseWordDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#ff00ff', // Magenta text color
    fontStyle: 'italic'
  });
}

function highlightSyntax(editor: vscode.TextEditor) {
  try {
    // Check if highlighting is enabled and if this is a dtSearch file
    if (!isHighlightingEnabled || !isDtSearchFile(editor)) {
      return;
    }

    const config = vscode.workspace.getConfiguration('dtsearch');
    const highlightNoiseWords = config.get('highlightNoiseWords', true);
    const showBalanceErrors = config.get('showBalanceErrors', true);

    const text = editor.document.getText();
  
  // Clear existing decorations
  editor.setDecorations(operatorDecorationType, []);
  editor.setDecorations(searchTermDecorationType, []);
  editor.setDecorations(quoteDecorationType, []);
  editor.setDecorations(unmatchedQuoteDecorationType, []);
  editor.setDecorations(specialOperatorDecorationType, []);
  editor.setDecorations(noiseWordDecorationType, []);
  parenDecorationTypes.forEach(decorationType => {
    editor.setDecorations(decorationType, []);
  });

  const operatorRanges: vscode.Range[] = [];
  const searchTermRanges: vscode.Range[] = [];
  const parenRanges: vscode.Range[][] = parenDecorationTypes.map(() => []);
  const quoteRanges: vscode.Range[] = [];
  const unmatchedQuoteRanges: vscode.Range[] = [];
  const specialOperatorRanges: vscode.Range[] = [];
  const noiseWordRanges: vscode.Range[] = [];

  // Define dtSearch noise words (common words typically ignored in searches)
  const noiseWords = new Set([
    'a', 'about', 'after', 'all', 'also', 'an', 'and', 'another', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by',
    'came', 'can', 'come', 'could',
    'did', 'do',
    'each', 'even',
    'for', 'from', 'further', 'furthermore',
    'get', 'got',
    'had', 'has', 'have', 'he', 'her', 'here', 'hi', 'him', 'himself', 'his', 'how', 'however',
    'i', 'if', 'in', 'indeed', 'into', 'is', 'it', 'its',
    'just',
    'like',
    'made', 'many', 'me', 'might', 'more', 'moreover', 'most', 'much', 'must', 'my',
    'never', 'not', 'now',
    'of', 'on', 'only', 'or', 'other', 'our', 'out', 'over',
    'said', 'same', 'see', 'she', 'should', 'since', 'some', 'still', 'such',
    'take', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'therefore', 'these', 'they', 'this', 'those', 'through', 'thus', 'to', 'too',
    'under', 'up',
    'very',
    'was', 'way', 'we', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would',
    'you', 'your'
  ]);

  // Find operators - comprehensive dtSearch operator list
  const operatorRegex = /\b(AND|OR|NOT|ANDANY|W\/\d+|PRE\/\d+|NOT\s+W\/\d+|NEAR|WITHIN|SENTENCE|PARAGRAPH|DOCUMENT|xfirstword|xlastword|CAPS|STEM|SOUNDEX|NUMERIC|ALPHANUMERIC)\b|date\(|mail\(|creditcard\(|contains\(|field\(/gi;
  let match;
  while ((match = operatorRegex.exec(text)) !== null) {
    const startPos = editor.document.positionAt(match.index);
    const endPos = editor.document.positionAt(match.index + match[0].length);
    operatorRanges.push(new vscode.Range(startPos, endPos));
  }

  // Find special operators and wildcards
  const specialOpRegex = /[~%#=?*]|\d+~~\d+|##/g;
  while ((match = specialOpRegex.exec(text)) !== null) {
    const startPos = editor.document.positionAt(match.index);
    const endPos = editor.document.positionAt(match.index + match[0].length);
    specialOperatorRanges.push(new vscode.Range(startPos, endPos));
  }

  // Find search terms (words that are not operators)
  const wordRegex = /\b\w+\b/g;
  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0].toUpperCase();
    const originalWord = match[0].toLowerCase();
    
    if (!['AND', 'OR', 'NOT', 'ANDANY', 'NEAR', 'WITHIN', 'SENTENCE', 'PARAGRAPH', 'DOCUMENT', 'XFIRSTWORD', 'XLASTWORD', 'DATE', 'MAIL', 'CREDITCARD', 'CAPS', 'STEM', 'SOUNDEX', 'NUMERIC', 'ALPHANUMERIC', 'CONTAINS', 'FIELD'].includes(word) && 
        !word.match(/^W\/\d+$/) && !word.match(/^PRE\/\d+$/)) {
      
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + match[0].length);
      
      // Check if it's a noise word
      if (highlightNoiseWords && noiseWords.has(originalWord)) {
        noiseWordRanges.push(new vscode.Range(startPos, endPos));
      } else {
        searchTermRanges.push(new vscode.Range(startPos, endPos));
      }
    }
  }

  // Find and color-match parentheses pairs
  const parenStack: Array<{pos: number, level: number}> = [];
  const unmatchedParens: number[] = [];
  const matchedPairs: Array<{open: number, close: number, level: number}> = [];
  let level = 0;
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      parenStack.push({pos: i, level: level});
      level++;
    } else if (text[i] === ')') {
      if (parenStack.length > 0) {
        const opening = parenStack.pop()!;
        matchedPairs.push({
          open: opening.pos,
          close: i,
          level: opening.level
        });
      } else {
        // Unmatched closing parenthesis
        unmatchedParens.push(i);
      }
      level = Math.max(0, level - 1);
    }
  }
  
  // Add any remaining unmatched opening parentheses
  parenStack.forEach(paren => {
    unmatchedParens.push(paren.pos);
  });
  
  // Color matched pairs
  const numColors = parenDecorationTypes.length - 1; // Reserve last one for unmatched
  matchedPairs.forEach(pair => {
    const colorIndex = pair.level % numColors;
    
    // Add opening parenthesis
    const openStartPos = editor.document.positionAt(pair.open);
    const openEndPos = editor.document.positionAt(pair.open + 1);
    parenRanges[colorIndex].push(new vscode.Range(openStartPos, openEndPos));
    
    // Add closing parenthesis
    const closeStartPos = editor.document.positionAt(pair.close);
    const closeEndPos = editor.document.positionAt(pair.close + 1);
    parenRanges[colorIndex].push(new vscode.Range(closeStartPos, closeEndPos));
  });
  
  // Color unmatched parentheses in red (last decoration type)
  if (showBalanceErrors) {
    const unmatchedIndex = parenDecorationTypes.length - 1;
    unmatchedParens.forEach(pos => {
      const startPos = editor.document.positionAt(pos);
      const endPos = editor.document.positionAt(pos + 1);
      parenRanges[unmatchedIndex].push(new vscode.Range(startPos, endPos));
    });
  }

  // Find and handle quotes (line by line)
  const lines = text.split('\n');
  let globalOffset = 0;
  
  lines.forEach((line, lineIndex) => {
    const quotePositions: number[] = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        quotePositions.push(globalOffset + i);
      }
    }

    // Color quotes for this line - pairs get normal color, unmatched get red squiggly
    for (let i = 0; i < quotePositions.length; i++) {
      const pos = quotePositions[i];
      const startPos = editor.document.positionAt(pos);
      const endPos = editor.document.positionAt(pos + 1);
      
      // If this line has an even number of quotes, all should be matched
      // If this line has an odd number, the last one is unmatched
      if (quotePositions.length % 2 === 0) {
        // Even number - all quotes in this line are matched
        quoteRanges.push(new vscode.Range(startPos, endPos));
      } else {
        // Odd number - last quote in this line is unmatched
        if (i === quotePositions.length - 1) {
          // This is the unmatched quote - only highlight if error detection is enabled
          if (showBalanceErrors) {
            unmatchedQuoteRanges.push(new vscode.Range(startPos, endPos));
          }
        } else {
          // These are matched quotes
          quoteRanges.push(new vscode.Range(startPos, endPos));
        }
      }
    }
    
    // Update global offset for next line (include the newline character)
    globalOffset += line.length + 1;
  });

  // Apply decorations
  editor.setDecorations(operatorDecorationType, operatorRanges);
  editor.setDecorations(searchTermDecorationType, searchTermRanges);
  editor.setDecorations(quoteDecorationType, quoteRanges);
  editor.setDecorations(unmatchedQuoteDecorationType, unmatchedQuoteRanges);
  editor.setDecorations(specialOperatorDecorationType, specialOperatorRanges);
  editor.setDecorations(noiseWordDecorationType, noiseWordRanges);
  parenDecorationTypes.forEach((decorationType, index) => {
    editor.setDecorations(decorationType, parenRanges[index]);
  });
  } catch (error) {
    console.error('Error in highlightSyntax:', error);
  }
}

function handleRealTimeFormatting(event: vscode.TextDocumentChangeEvent, editor: vscode.TextEditor) {
  // Only process single character insertions (like space, enter, etc.)
  if (event.contentChanges.length !== 1) {
    return;
  }

  const change = event.contentChanges[0];
  
  // Only process when user types a space or other word boundary characters
  if (change.text !== ' ' && change.text !== '\n' && change.text !== '\t' && change.text !== ')' && change.text !== '(' && change.text !== '"' && change.text !== "'") {
    return;
  }

  // Get the position where the change occurred (after the character was inserted)
  const changePosition = change.range.start;
  const line = editor.document.lineAt(changePosition.line);
  const lineText = line.text;
  
  // Find the word that was just completed (before the space/boundary)
  // We need to look before the inserted character
  let wordEnd = changePosition.character;
  let wordStart = wordEnd - 1;
  
  // Move back to find the start of the word
  while (wordStart > 0 && /[a-zA-Z0-9\/]/.test(lineText[wordStart - 1])) {
    wordStart--;
  }
  
  if (wordStart < 0 || wordStart >= wordEnd) {
    return;
  }
  
  const word = lineText.substring(wordStart, wordEnd).toLowerCase();
  
  // Define dtSearch operators and connectors that should be auto-formatted
  const operatorMap: { [key: string]: string } = {
    // Boolean operators
    'and': 'AND',
    'or': 'OR',
    'not': 'NOT',
    'andany': 'ANDANY',
    
    // Proximity operators
    'near': 'NEAR',
    'within': 'WITHIN',
    'sentence': 'SENTENCE',
    'paragraph': 'PARAGRAPH',
    'document': 'DOCUMENT',
    
    // Special function operators
    'xfirstword': 'XFIRSTWORD',
    'xlastword': 'XLASTWORD',
    'caps': 'CAPS',
    'stem': 'STEM',
    'soundex': 'SOUNDEX',
    'numeric': 'NUMERIC',
    'alphanumeric': 'ALPHANUMERIC',
    
    // Additional dtSearch operators
    'contains': 'CONTAINS',
    'field': 'FIELD',
    'date': 'DATE',
    'mail': 'MAIL',
    'creditcard': 'CREDITCARD',
    'ssn': 'SSN',
    'phone': 'PHONE',
    'url': 'URL',
    'zipcode': 'ZIPCODE',
    'currency': 'CURRENCY',
    'percent': 'PERCENT',
    'number': 'NUMBER',
    'time': 'TIME',
    'datetime': 'DATETIME',
    'fileext': 'FILEEXT',
    'filename': 'FILENAME',
    'filepath': 'FILEPATH',
    'filesize': 'FILESIZE',
    'filedate': 'FILEDATE',
    'filetype': 'FILETYPE',
    'title': 'TITLE',
    'subject': 'SUBJECT',
    'author': 'AUTHOR',
    'keywords': 'KEYWORDS',
    'comments': 'COMMENTS',
    'company': 'COMPANY',
    'manager': 'MANAGER',
    'category': 'CATEGORY',
    'hyperlinks': 'HYPERLINKS',
    'images': 'IMAGES',
    'tables': 'TABLES',
    'headers': 'HEADERS',
    'footers': 'FOOTERS'
  };
  
  // Check for proximity patterns (w/n, pre/n)
  const proximityMatch = word.match(/^(w|pre)\/\d+$/i);
  if (proximityMatch) {
    const formattedWord = proximityMatch[1].toUpperCase() + word.substring(proximityMatch[1].length);
    if (word !== formattedWord) {
      applyWordFormattingWithTrigger(editor, wordStart, wordEnd, formattedWord, change.text);
    }
    return;
  }
  
  // Check if the word is an operator that needs formatting
  const formattedWord = operatorMap[word];
  if (formattedWord && word !== formattedWord) {
    applyWordFormattingWithTrigger(editor, wordStart, wordEnd, formattedWord, change.text);
  }
}

function applyWordFormattingWithTrigger(editor: vscode.TextEditor, startChar: number, endChar: number, newText: string, triggerChar: string) {
  const line = editor.selection.active.line;
  const wordRange = new vscode.Range(
    new vscode.Position(line, startChar),
    new vscode.Position(line, endChar)
  );
  
  editor.edit(editBuilder => {
    // Replace just the word, not including the trigger character
    editBuilder.replace(wordRange, newText);
  }).then(() => {
    // Move cursor to after the formatted word and the trigger character
    const newPosition = new vscode.Position(line, startChar + newText.length + 1);
    editor.selection = new vscode.Selection(newPosition, newPosition);
  });
}

interface QueryFix {
  description: string;
  apply: (text: string) => string;
  lineNumber?: number;
  columnStart?: number;
  columnEnd?: number;
}

function analyzeAndSuggestFixes(query: string): QueryFix[] {
  const fixes: QueryFix[] = [];
  const lines = query.split('\n');

  // Helper function to find line number for a pattern
  function findLineNumber(pattern: RegExp, matchText?: string): number | undefined {
    for (let i = 0; i < lines.length; i++) {
      if (matchText) {
        if (lines[i].includes(matchText)) {
          return i + 1; // 1-based line numbers
        }
      } else if (pattern.test(lines[i])) {
        return i + 1; // 1-based line numbers
      }
    }
    return undefined;
  }

  function findUnbalancedQuoteLines(): number[] {
    const unbalancedLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const quoteCount = (lines[i].match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        unbalancedLines.push(i + 1); // 1-based line numbers
      }
    }
    return unbalancedLines;
  }

  // Fix 1: Remove duplicate operators (preserve line structure)
  const duplicateOperatorPattern = /\b(AND|OR|NOT|ANDANY|NEAR|WITHIN)\s+\1\b/gi;
  if (duplicateOperatorPattern.test(query)) {
    const lineNumber = findLineNumber(duplicateOperatorPattern);
    fixes.push({
      description: `Remove duplicate operators (e.g., "AND AND" → "AND")${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text.replace(/\b(AND|OR|NOT|ANDANY|NEAR|WITHIN)\s+\1\b/gi, '$1'),
      lineNumber
    });
  }

  // Fix 2: Fix unbalanced parentheses
  const parenBalance = getParenthesesBalance(query);
  if (parenBalance !== 0) {
    const lineNumber = findLineNumber(/[()]/);
    fixes.push({
      description: `Balance parentheses (${Math.abs(parenBalance)} ${parenBalance > 0 ? 'missing closing' : 'extra closing'} parentheses)${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => fixUnbalancedParentheses(text),
      lineNumber
    });
  }

  // Fix 3: Fix unbalanced quotes (line by line)
  const quoteBalance = getQuoteBalance(query);
  if (quoteBalance !== 0) {
    const unbalancedLines = findUnbalancedQuoteLines();
    const lineNumber = unbalancedLines.length > 0 ? unbalancedLines[0] : undefined;
    const lineInfo = unbalancedLines.length > 1 ? 
      ` - Lines ${unbalancedLines.join(', ')}` : 
      lineNumber ? ` - Line ${lineNumber}` : '';
    fixes.push({
      description: `Balance quotes (add missing closing quote)${lineInfo}`,
      apply: (text: string) => {
        const lines = text.split('\n');
        const fixedLines = lines.map(line => {
          const quoteCount = (line.match(/"/g) || []).length;
          
          // If this line has an odd number of quotes (unbalanced)
          if (quoteCount % 2 !== 0) {
            // Find the last unbalanced quote in this line
            let lastQuotePos = -1;
            let lineQuoteCount = 0;
            
            for (let i = 0; i < line.length; i++) {
              if (line[i] === '"') {
                lineQuoteCount++;
                if (lineQuoteCount % 2 === 1) {
                  lastQuotePos = i;
                }
              }
            }
            
            if (lastQuotePos !== -1) {
              // Look for the next operator after the unbalanced quote
              const textAfterQuote = line.substring(lastQuotePos + 1);
              const operatorMatch = textAfterQuote.match(/\s+(AND|OR|NOT|W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+/i);
              
              if (operatorMatch && operatorMatch.index !== undefined) {
                // Insert closing quote before the operator
                const insertPos = lastQuotePos + 1 + operatorMatch.index;
                return line.slice(0, insertPos) + '"' + line.slice(insertPos);
              } else {
                // No operator found, add quote at end of line (trim any trailing whitespace first)
                return line.trimEnd() + '"';
              }
            }
          }
          
          return line;
        });
        
        return fixedLines.join('\n');
      },
      lineNumber
    });
  }

  // Fix 4: Remove excessive spaces (but preserve line breaks and structure)
  if (/[ \t]{2,}/.test(query)) {
    const lineNumber = findLineNumber(/[ \t]{2,}/);
    fixes.push({
      description: `Remove excessive spaces (preserves line breaks)${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => {
        // Split by lines, clean each line individually, then rejoin
        return text.split('\n').map(line => {
          // Replace multiple spaces/tabs with single space, but preserve line content
          return line.replace(/[ \t]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
        }).join('\n');
      },
      lineNumber
    });
  }

  // Fix 5: Fix invalid proximity operators (preserve line structure)
  const invalidProximityPattern = /\b(w|pre)(\d+)\b/gi;
  if (invalidProximityPattern.test(query)) {
    const lineNumber = findLineNumber(invalidProximityPattern);
    fixes.push({
      description: `Fix proximity operators (e.g., "w5" → "W/5")${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text.replace(/\b(w|pre)(\d+)\b/gi, (match, op, num) => `${op.toUpperCase()}/${num}`),
      lineNumber
    });
  }

  // Fix 6: Fix case inconsistencies in operators (preserve line structure)
  const mixedCaseOperators = /\b(and|or|not|andany|near|within)\b/g;
  if (mixedCaseOperators.test(query)) {
    const lineNumber = findLineNumber(mixedCaseOperators);
    fixes.push({
      description: `Normalize operator case to uppercase${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text.replace(/\b(and|or|not|andany|near|within)\b/gi, match => match.toUpperCase()),
      lineNumber
    });
  }

  // Fix 7: Detect improper nested/mixed proximity operators
  const nestedProximityPattern = /\([^()]*(?:W\/\d+|PRE\/\d+|NEAR|WITHIN)[^()]*(?:W\/\d+|PRE\/\d+|NEAR|WITHIN)[^()]*\)/gi;
  const mixedOperatorPattern = /\([^()]*(?:AND|OR)[^()]*(?:W\/\d+|PRE\/\d+|NEAR|WITHIN)[^()]*\)/gi;
  
  if (nestedProximityPattern.test(query)) {
    const lineNumber = findLineNumber(nestedProximityPattern);
    fixes.push({
      description: `⚠️ Syntax Warning: Multiple proximity operators inside parentheses may cause unexpected results${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix - user needs to restructure manually
      lineNumber
    });
  }
  
  if (mixedOperatorPattern.test(query)) {
    const lineNumber = findLineNumber(mixedOperatorPattern);
    fixes.push({
      description: `⚠️ Syntax Warning: Mixing boolean (AND/OR) and proximity operators in parentheses creates ambiguous precedence${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix - user needs to restructure manually
      lineNumber
    });
  }

  // PERFORMANCE OPTIMIZATION WARNINGS

  // Warning 1: Leading wildcards (*apple) - very slow
  const leadingWildcardPattern = /\*\w+/g;
  if (leadingWildcardPattern.test(query)) {
    const lineNumber = findLineNumber(leadingWildcardPattern);
    fixes.push({
      description: `⚠️ Performance Warning: Leading wildcards (*word) are very slow${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix for this - user decision
      lineNumber
    });
  }

  // Warning 2: Too many OR terms (>10 in one group)
  const orGroupPattern = /\([^()]*(?:\s+OR\s+[^()]*){10,}\)/gi;
  if (orGroupPattern.test(query)) {
    const lineNumber = findLineNumber(orGroupPattern);
    fixes.push({
      description: `⚠️ Performance Warning: Too many OR terms in one group (>10) - consider splitting${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix for this - user decision
      lineNumber
    });
  }

  // Warning 3: Nested wildcards (app*le*) - inefficient
  const nestedWildcardPattern = /\w+\*\w+\*/g;
  if (nestedWildcardPattern.test(query)) {
    const lineNumber = findLineNumber(nestedWildcardPattern);
    fixes.push({
      description: `⚠️ Performance Warning: Nested wildcards (word*sub*) are inefficient${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix for this - user decision
      lineNumber
    });
  }

  // Warning 4: Very wide proximity ranges (W/100+)
  const wideProximityPattern = /W\/([1-9]\d{2,}|\d{4,})/gi; // W/100 or higher
  if (wideProximityPattern.test(query)) {
    const lineNumber = findLineNumber(wideProximityPattern);
    fixes.push({
      description: `⚠️ Performance Warning: Very wide proximity range (W/100+) may be slow${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text.replace(/W\/([1-9]\d{2,}|\d{4,})/gi, 'W/50'), // Suggest W/50 as more reasonable
      lineNumber
    });
  }

  // Warning 5: Multiple leading wildcards in OR group
  const multipleLeadingWildcardsPattern = /\([^()]*\*\w+[^()]*(?:\s+OR\s+[^()]*\*\w+[^()]*)+\)/gi;
  if (multipleLeadingWildcardsPattern.test(query)) {
    const lineNumber = findLineNumber(multipleLeadingWildcardsPattern);
    fixes.push({
      description: `⚠️ Performance Warning: Multiple leading wildcards in OR group - extremely slow${lineNumber ? ` - Line ${lineNumber}` : ''}`,
      apply: (text: string) => text, // No auto-fix for this - user decision
      lineNumber
    });
  }

  return fixes;
}

function fixUnbalancedParentheses(text: string): string {
  const balance = getParenthesesBalance(text);
  
  if (balance > 0) {
    // Missing closing parentheses
    return text + ')'.repeat(balance);
  } else if (balance < 0) {
    // Extra closing parentheses - remove from the end
    let result = text;
    let toRemove = Math.abs(balance);
    
    // Remove excess closing parentheses from the end
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === ')') {
        result = result.slice(0, i) + result.slice(i + 1);
        toRemove--;
      }
    }
    return result;
  }
  
  return text;
}

function getCommonMisspellings(): Map<string, string> {
  const misspellings = new Map<string, string>();
  
  // Common dtSearch-related misspellings
  misspellings.set('appel', 'apple');
  misspellings.set('banan', 'banana');
  misspellings.set('bananna', 'banana');
  misspellings.set('orang', 'orange');
  misspellings.set('cheery', 'cherry');
  misspellings.set('chery', 'cherry');
  misspellings.set('documnt', 'document');
  misspellings.set('documen', 'document');
  misspellings.set('contrat', 'contract');
  misspellings.set('contrct', 'contract');
  misspellings.set('agrement', 'agreement');
  misspellings.set('agremeent', 'agreement');
  misspellings.set('recieve', 'receive');
  misspellings.set('reciev', 'receive');
  misspellings.set('adress', 'address');
  misspellings.set('addres', 'address');
  misspellings.set('occurence', 'occurrence');
  misspellings.set('seperate', 'separate');
  misspellings.set('definately', 'definitely');
  misspellings.set('goverment', 'government');
  misspellings.set('managment', 'management');
  misspellings.set('comittee', 'committee');
  misspellings.set('commitee', 'committee');
  misspellings.set('begining', 'beginning');
  misspellings.set('calender', 'calendar');
  misspellings.set('sucessful', 'successful');
  misspellings.set('necesary', 'necessary');
  misspellings.set('recomend', 'recommend');
  misspellings.set('responsability', 'responsibility');
  
  // Nautical/Maritime terms
  misspellings.set('yact', 'yacht');
  misspellings.set('yatch', 'yacht');
  misspellings.set('captin', 'captain');
  misspellings.set('captian', 'captain');
  misspellings.set('shoar', 'shore');
  misspellings.set('shor', 'shore');
  misspellings.set('harber', 'harbor');
  misspellings.set('habor', 'harbor');
  misspellings.set('ancher', 'anchor');
  misspellings.set('achor', 'anchor');
  misspellings.set('navagation', 'navigation');
  misspellings.set('navegation', 'navigation');
  misspellings.set('passanger', 'passenger');
  misspellings.set('passangers', 'passengers');
  misspellings.set('marinah', 'marina');
  misspellings.set('marena', 'marina');
  
  // Legal/Business terms
  misspellings.set('liabilty', 'liability');
  misspellings.set('liabiity', 'liability');
  misspellings.set('responsibilty', 'responsibility');
  misspellings.set('responsiblity', 'responsibility');
  misspellings.set('guarentee', 'guarantee');
  misspellings.set('garentee', 'guarantee');
  misspellings.set('maintanence', 'maintenance');
  misspellings.set('maintainence', 'maintenance');
  misspellings.set('equipement', 'equipment');
  misspellings.set('equiptment', 'equipment');
  misspellings.set('insureance', 'insurance');
  misspellings.set('insurence', 'insurance');
  misspellings.set('proceduer', 'procedure');
  misspellings.set('proceedure', 'procedure');
  misspellings.set('accomodation', 'accommodation');
  misspellings.set('acommodation', 'accommodation');
  
  // Technology terms
  misspellings.set('sofware', 'software');
  misspellings.set('softare', 'software');
  misspellings.set('hardare', 'hardware');
  misspellings.set('databse', 'database');
  misspellings.set('databas', 'database');
  misspellings.set('netwrok', 'network');
  misspellings.set('netowrk', 'network');
  misspellings.set('sever', 'server');
  misspellings.set('servr', 'server');
  misspellings.set('compny', 'company');
  misspellings.set('companey', 'company');
  
  return misspellings;
}

function splitOrQuery(query: string): string[] {
  // Clean up the query first
  query = query.trim();
  
  // Find OR groups in parentheses like (term1 OR term2 OR term3)
  const orGroupRegex = /\(([^)]*\bOR\b[^)]*)\)/gi;
  const orGroups: Array<{match: string, terms: string[], start: number, end: number}> = [];
  
  let match;
  while ((match = orGroupRegex.exec(query)) !== null) {
    const groupContent = match[1];
    // Split by OR and clean up terms
    const terms = groupContent.split(/\s+OR\s+/i).map(term => term.trim()).filter(term => term.length > 0);
    
    if (terms.length > 1) {
      orGroups.push({
        match: match[0],
        terms: terms,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  
  // If no OR groups found, return the original query
  if (orGroups.length === 0) {
    return [query];
  }
  
  // Generate all combinations
  let results: string[] = [query];
  
  // Process each OR group from right to left to maintain correct indices
  for (let i = orGroups.length - 1; i >= 0; i--) {
    const group = orGroups[i];
    const newResults: string[] = [];
    
    for (const currentQuery of results) {
      for (const term of group.terms) {
        // Replace the OR group with the individual term
        const newQuery = currentQuery.substring(0, group.start) + 
                        term + 
                        currentQuery.substring(group.end);
        newResults.push(newQuery);
      }
    }
    
    results = newResults;
  }
  
  // Clean up the results
  return results.map(result => {
    // Remove extra spaces
    return result.replace(/\s+/g, ' ').trim();
  }).filter(result => result.length > 0);
}

function validateSyntax(document: vscode.TextDocument) {
  // Check if syntax validation is enabled
  const config = vscode.workspace.getConfiguration('dtsearch');
  if (!config.get('enableSyntaxValidation', true)) {
    diagnosticCollection.clear();
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex;

    // Check for consecutive operators (AND AND, OR OR, etc.)
    const consecutiveOperators = line.match(/\b(AND|OR|NOT|ANDANY|NEAR|WITHIN)\s+(AND|OR|NOT|ANDANY|NEAR|WITHIN)\b/gi);
    if (consecutiveOperators) {
      consecutiveOperators.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Consecutive operators "${match}" may cause query failure. Consider adding search terms between operators.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'consecutive-operators';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for operator at start of query (except NOT)
    const startOperatorMatch = line.match(/^\s*(AND|OR|ANDANY|NEAR|WITHIN)\b/i);
    if (startOperatorMatch && startOperatorMatch[1].toUpperCase() !== 'NOT') {
      const startIndex = line.indexOf(startOperatorMatch[1]);
      const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + startOperatorMatch[1].length);
      const diagnostic = new vscode.Diagnostic(
        range,
        `Query cannot start with "${startOperatorMatch[1]}". Start with a search term or use NOT.`,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.code = 'operator-at-start';
      diagnostic.source = 'dtSearch';
      diagnostics.push(diagnostic);
    }

    // Check for operator at end of query
    const endOperatorMatch = line.match(/\b(AND|OR|NOT|ANDANY|NEAR|WITHIN)\s*$/i);
    if (endOperatorMatch) {
      const startIndex = line.lastIndexOf(endOperatorMatch[1]);
      const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + endOperatorMatch[1].length);
      const diagnostic = new vscode.Diagnostic(
        range,
        `Query cannot end with "${endOperatorMatch[1]}". Add a search term after the operator.`,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.code = 'operator-at-end';
      diagnostic.source = 'dtSearch';
      diagnostics.push(diagnostic);
    }

    // Check for mixed AND/OR operators within parentheses
    const parenGroups = line.match(/\([^)]+\)/g);
    if (parenGroups) {
      parenGroups.forEach(group => {
        const hasAnd = /\bAND\b/i.test(group);
        const hasOr = /\bOR\b/i.test(group);
        
        if (hasAnd && hasOr) {
          const startIndex = line.indexOf(group);
          const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + group.length);
          const diagnostic = new vscode.Diagnostic(
            range,
            `Cannot mix AND and OR operators within the same parentheses: "${group}". Use separate parentheses for each operator type or clarify precedence.`,
            vscode.DiagnosticSeverity.Error
          );
          diagnostic.code = 'mixed-operators-in-parens';
          diagnostic.source = 'dtSearch';
          diagnostics.push(diagnostic);
        }

        // Suggest parentheses for complex expressions without them
        const complexWithoutParens = /\b\w+\s+(AND|OR)\s+\w+\s+(AND|OR)\s+\w+\b/i;
        if (!group && complexWithoutParens.test(line)) {
          const match = line.match(complexWithoutParens);
          if (match) {
            const startIndex = line.indexOf(match[0]);
            const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match[0].length);
            const diagnostic = new vscode.Diagnostic(
              range,
              `Consider using parentheses to clarify operator precedence: "${match[0]}". Example: "(term1 OR term2) AND term3"`,
              vscode.DiagnosticSeverity.Information
            );
            diagnostic.code = 'suggest-parentheses';
            diagnostic.source = 'dtSearch';
            diagnostics.push(diagnostic);
          }
        }
      });
    }

    // Check for complex expressions without parentheses (when no parentheses exist on the line)
    if (!parenGroups) {
      const complexPattern = /\b\w+\s+(AND|OR)\s+\w+\s+(AND|OR)\s+\w+/gi;
      let match;
      while ((match = complexPattern.exec(line)) !== null) {
        const operators = [match[1].toUpperCase(), match[2].toUpperCase()];
        if (operators[0] !== operators[1]) { // Different operators
          const range = new vscode.Range(lineNumber, match.index, lineNumber, match.index + match[0].length);
          const diagnostic = new vscode.Diagnostic(
            range,
            `Mixed operators require parentheses for clarity: "${match[0]}". Example: "(${match[0].split(' ')[0]} ${operators[0]} ${match[0].split(' ')[2]}) ${operators[1]} ${match[0].split(' ')[4]}"`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.code = 'mixed-operators-need-parens';
          diagnostic.source = 'dtSearch';
          diagnostics.push(diagnostic);
        }
      }
    }

    // Check for missing search terms around proximity operators
    const proximityWithoutTerms = line.match(/\b(W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+(W\/\d+|PRE\/\d+|NEAR|WITHIN)\b/gi);
    if (proximityWithoutTerms) {
      proximityWithoutTerms.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Proximity operators "${match}" require search terms on both sides.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'proximity-without-terms';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for ambiguous proximity patterns that can produce unclear results
    // Pattern 1: (complex expression) PROXIMITY (complex expression)
    const ambiguousProximity1 = line.match(/\([^)]*\b(AND|OR)\b[^)]*\)\s+(W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+\([^)]*\b(AND|OR)\b[^)]*\)/gi);
    if (ambiguousProximity1) {
      ambiguousProximity1.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Ambiguous proximity pattern "${match}" may produce unclear results. Consider restructuring with simpler proximity expressions or use separate queries.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'ambiguous-proximity-complex';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Pattern 2: (proximity expression) PROXIMITY (proximity or complex expression)
    const ambiguousProximity2 = line.match(/\([^)]*\b(W\/\d+|PRE\/\d+)\b[^)]*\)\s+(W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+\([^)]*\b(AND|OR|W\/\d+|PRE\/\d+)\b[^)]*\)/gi);
    if (ambiguousProximity2) {
      ambiguousProximity2.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Nested proximity pattern "${match}" creates ambiguous scope. Consider using simpler proximity expressions or restructure the query.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'ambiguous-proximity-nested';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Pattern 3: Multiple proximity operators in sequence without clear grouping
    const multipleProximity = line.match(/\b\w+\s+(W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+\w+\s+(W\/\d+|PRE\/\d+|NEAR|WITHIN)\s+\w+/gi);
    if (multipleProximity) {
      multipleProximity.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Multiple proximity operators "${match}" may create ambiguous results. Consider using parentheses to clarify intended scope.`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.code = 'multiple-proximity-operators';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for invalid proximity syntax (w/ without number)
    const invalidProximity = line.match(/\b(w|pre)\/(?!\d)/gi);
    if (invalidProximity) {
      invalidProximity.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Invalid proximity operator "${match}". Use format like "W/5" or "PRE/3" with a number.`,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.code = 'invalid-proximity';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for empty parentheses
    const emptyParens = line.match(/\(\s*\)/g);
    if (emptyParens) {
      emptyParens.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Empty parentheses "()" are not valid. Add search terms inside parentheses.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'empty-parentheses';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for redundant parentheses around single terms
    const redundantParens = line.match(/\(\s*\w+\s*\)/g);
    if (redundantParens) {
      redundantParens.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Parentheses around single term "${match}" are unnecessary. Remove them unless part of a larger expression.`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.code = 'redundant-parentheses';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for nested parentheses that might be confusing
    const nestedParens = line.match(/\([^()]*\([^()]*\)[^()]*\)/g);
    if (nestedParens) {
      nestedParens.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Nested parentheses "${match}" may be confusing. Consider simplifying or using separate expressions.`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.code = 'nested-parentheses';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for double negation (NOT NOT)
    const doubleNot = line.match(/\bNOT\s+NOT\b/gi);
    if (doubleNot) {
      doubleNot.forEach(match => {
        const startIndex = line.indexOf(match);
        const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + match.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Double negation "NOT NOT" may cause unexpected results. Consider simplifying the query.`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.code = 'double-negation';
        diagnostic.source = 'dtSearch';
        diagnostics.push(diagnostic);
      });
    }

    // Check for operator inside quotes (likely unintended)
    // Find all quoted strings first, then check if they contain operators
    const quotedStrings = line.match(/"[^"]*"/g);
    if (quotedStrings) {
      quotedStrings.forEach(quotedString => {
        const operatorInQuote = quotedString.match(/\b(AND|OR|NOT|ANDANY|NEAR|WITHIN)\b/gi);
        if (operatorInQuote) {
          const startIndex = line.indexOf(quotedString);
          const range = new vscode.Range(lineNumber, startIndex, lineNumber, startIndex + quotedString.length);
          const diagnostic = new vscode.Diagnostic(
            range,
            `Operator inside quotes "${quotedString}" will be treated as literal text, not as an operator.`,
            vscode.DiagnosticSeverity.Information
          );
          diagnostic.code = 'operator-in-quotes';
          diagnostic.source = 'dtSearch';
          diagnostics.push(diagnostic);
        }
      });
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  // Clean up decorations
  if (operatorDecorationType) {
    operatorDecorationType.dispose();
  }
  if (searchTermDecorationType) {
    searchTermDecorationType.dispose();
  }
  if (quoteDecorationType) {
    quoteDecorationType.dispose();
  }
  if (unmatchedQuoteDecorationType) {
    unmatchedQuoteDecorationType.dispose();
  }
  if (specialOperatorDecorationType) {
    specialOperatorDecorationType.dispose();
  }
  if (noiseWordDecorationType) {
    noiseWordDecorationType.dispose();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
  }
  parenDecorationTypes.forEach(decorationType => {
    decorationType.dispose();
  });
}

// Operator Flow Diagram Function
async function showOperatorFlowDiagram(queryText: string) {
  const flowSteps = analyzeQueryFlow(queryText);
  const flowDiagram = generateFlowDiagram(flowSteps);
  
  // Create a new untitled document to show the flow diagram
  const document = await vscode.workspace.openTextDocument({
    content: flowDiagram,
    language: 'markdown'
  });
  
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false
  });
}

function analyzeQueryFlow(query: string): FlowStep[] {
  const steps: FlowStep[] = [];
  const tokens = tokenizeForFlow(query);
  
  // Add initial step
  steps.push({
    step: 1,
    operation: 'Parse Query',
    input: query,
    output: 'Tokenized components',
    description: 'Break down query into operators, terms, and groups',
    type: 'parse'
  });
  
  // Analyze operator precedence and execution order
  let stepCounter = 2;
  const precedenceGroups = groupByPrecedence(tokens);
  
  for (const group of precedenceGroups) {
    const step = analyzeOperatorGroup(group, stepCounter++);
    steps.push(step);
  }
  
  // Add final step
  steps.push({
    step: stepCounter,
    operation: 'Return Results',
    input: 'Combined result sets',
    output: 'Final document matches',
    description: 'Present final search results to user',
    type: 'result'
  });
  
  return steps;
}

function tokenizeForFlow(query: string): FlowToken[] {
  const tokens: FlowToken[] = [];
  let i = 0;
  
  while (i < query.length) {
    // Skip whitespace
    while (i < query.length && /\s/.test(query[i])) {
      i++;
    }
    
    if (i >= query.length) {
      break;
    }
    
    let value = '';
    let type: 'term' | 'operator' | 'group_start' | 'group_end' | 'phrase' = 'term';
    
    // Handle parentheses
    if (query[i] === '(') {
      value = '(';
      type = 'group_start';
      i++;
    } else if (query[i] === ')') {
      value = ')';
      type = 'group_end';
      i++;
    }
    // Handle quoted phrases
    else if (query[i] === '"') {
      let j = i + 1;
      value = '"';
      while (j < query.length && query[j] !== '"') {
        value += query[j];
        j++;
      }
      if (j < query.length) {
        value += '"';
        j++;
      }
      type = 'phrase';
      i = j;
    }
    // Handle operators and terms
    else {
      let j = i;
      while (j < query.length && /[a-zA-Z0-9*\/]/.test(query[j])) {
        j++;
      }
      value = query.substring(i, j);
      
      const upperValue = value.toUpperCase();
      if (/^(AND|OR|NOT|NEAR|WITHIN|W\/\d+|PRE\/\d+)$/.test(upperValue)) {
        type = 'operator';
      }
      
      i = j;
    }
    
    if (value) {
      tokens.push({ value, type, precedence: getOperatorPrecedence(value) });
    }
  }
  
  return tokens;
}

function getOperatorPrecedence(value: string): number {
  const upperValue = value.toUpperCase();
  
  // Higher numbers = higher precedence (executed first)
  if (upperValue === 'NOT') {
    return 4;
  }
  if (/^(W\/\d+|PRE\/\d+|NEAR|WITHIN)$/.test(upperValue)) {
    return 3;
  }
  if (upperValue === 'AND') {
    return 2;
  }
  if (upperValue === 'OR') {
    return 1;
  }
  
  return 0; // Terms, phrases, groups
}

function groupByPrecedence(tokens: FlowToken[]): FlowToken[][] {
  const groups: FlowToken[][] = [];
  let currentGroup: FlowToken[] = [];
  let currentPrecedence = -1;
  
  for (const token of tokens) {
    if (token.type === 'operator' && token.precedence !== currentPrecedence) {
      if (currentGroup.length > 0) {
        groups.push([...currentGroup]);
      }
      currentGroup = [token];
      currentPrecedence = token.precedence;
    } else {
      currentGroup.push(token);
    }
  }
  
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  // Sort by precedence (highest first)
  groups.sort((a, b) => {
    const aPrecedence = Math.max(...a.filter(t => t.type === 'operator').map(t => t.precedence));
    const bPrecedence = Math.max(...b.filter(t => t.type === 'operator').map(t => t.precedence));
    return bPrecedence - aPrecedence;
  });
  
  return groups;
}

function analyzeOperatorGroup(group: FlowToken[], stepNumber: number): FlowStep {
  const operators = group.filter(token => token.type === 'operator');
  const mainOperator = operators[0];
  
  if (!mainOperator) {
    return {
      step: stepNumber,
      operation: 'Process Terms',
      input: group.map(t => t.value).join(' '),
      output: 'Document matches',
      description: 'Find documents containing the specified terms',
      type: 'search'
    };
  }
  
  const operatorType = mainOperator.value.toUpperCase();
  
  switch (operatorType) {
    case 'NOT':
      return {
        step: stepNumber,
        operation: 'NOT Operation',
        input: group.map(t => t.value).join(' '),
        output: 'Excluded documents',
        description: 'Remove documents matching the NOT term from results',
        type: 'boolean',
        performance: 'Moderate - Exclusion operation'
      };
      
    case 'AND':
      return {
        step: stepNumber,
        operation: 'AND Operation',
        input: group.map(t => t.value).join(' '),
        output: 'Intersection of results',
        description: 'Find documents containing ALL specified terms',
        type: 'boolean',
        performance: 'Fast - Intersection operation'
      };
      
    case 'OR':
      return {
        step: stepNumber,
        operation: 'OR Operation',
        input: group.map(t => t.value).join(' '),
        output: 'Union of results',
        description: 'Find documents containing ANY of the specified terms',
        type: 'boolean',
        performance: 'Fast - Union operation'
      };
      
    default:
      if (/^W\/\d+$/.test(operatorType)) {
        const distance = operatorType.substring(2);
        return {
          step: stepNumber,
          operation: `Proximity Search (W/${distance})`,
          input: group.map(t => t.value).join(' '),
          output: 'Nearby term matches',
          description: `Find documents where terms appear within ${distance} words of each other`,
          type: 'proximity',
          performance: `Moderate - Proximity scanning within ${distance} words`
        };
      } else if (/^PRE\/\d+$/.test(operatorType)) {
        const distance = operatorType.substring(4);
        return {
          step: stepNumber,
          operation: `Precedes Search (PRE/${distance})`,
          input: group.map(t => t.value).join(' '),
          output: 'Ordered term matches',
          description: `Find documents where first term precedes second term within ${distance} words`,
          type: 'proximity',
          performance: `Moderate - Ordered proximity scanning within ${distance} words`
        };
      }
      
      return {
        step: stepNumber,
        operation: 'Unknown Operation',
        input: group.map(t => t.value).join(' '),
        output: 'Results',
        description: 'Process unknown operator',
        type: 'other'
      };
  }
}

function generateFlowDiagram(steps: FlowStep[]): string {
  let diagram = '# dtSearch Query Execution Flow Diagram\n\n';
  diagram += `Generated on: ${new Date().toLocaleString()}\n\n`;
  diagram += '## Execution Steps\n\n';
  
  // Add execution order explanation
  diagram += '### Operator Precedence (Execution Order)\n';
  diagram += '1. **NOT** (Highest precedence)\n';
  diagram += '2. **Proximity Operators** (W/, PRE/, NEAR)\n';
  diagram += '3. **AND**\n';
  diagram += '4. **OR** (Lowest precedence)\n\n';
  
  // Create flow diagram
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const icon = getFlowIcon(step.type);
    
    diagram += `### ${icon} Step ${step.step}: ${step.operation}\n\n`;
    diagram += `**Input:** \`${step.input}\`\n\n`;
    diagram += `**Output:** ${step.output}\n\n`;
    diagram += `**Description:** ${step.description}\n\n`;
    
    if (step.performance) {
      diagram += `**Performance:** ${step.performance}\n\n`;
    }
    
    // Add arrow to next step (except for last step)
    if (i < steps.length - 1) {
      diagram += '```\n';
      diagram += '    ↓\n';
      diagram += '```\n\n';
    }
  }
  
  // Add performance summary
  diagram += '\n## Performance Analysis\n\n';
  const performanceSteps = steps.filter(s => s.performance);
  if (performanceSteps.length > 0) {
    for (const step of performanceSteps) {
      diagram += `- **${step.operation}:** ${step.performance}\n`;
    }
  } else {
    diagram += 'No specific performance considerations detected.\n';
  }
  
  // Add tips
  diagram += '\n## Optimization Tips\n\n';
  diagram += '- Use **AND** operations when possible (faster than OR with many terms)\n';
  diagram += '- Limit **proximity ranges** (W/5 is faster than W/50)\n';
  diagram += '- Place **most selective terms** first in AND operations\n';
  diagram += '- Use **NOT** operators sparingly\n';
  diagram += '- Consider **phrase searches** ("exact phrase") for better precision\n';
  
  return diagram;
}

function getFlowIcon(type: string): string {
  switch (type) {
    case 'parse': return '🔍';
    case 'boolean': return '🔗';
    case 'proximity': return '↔️';
    case 'search': return '📝';
    case 'result': return '✅';
    default: return '⚙️';
  }
}

// Interface definitions for flow analysis
interface FlowStep {
  step: number;
  operation: string;
  input: string;
  output: string;
  description: string;
  type: 'parse' | 'boolean' | 'proximity' | 'search' | 'result' | 'other';
  performance?: string;
}

interface FlowToken {
  value: string;
  type: 'term' | 'operator' | 'group_start' | 'group_end' | 'phrase';
  precedence: number;
}

// Query Tree Provider Classes
interface QueryNode {
  type: 'root' | 'group' | 'operator' | 'term' | 'phrase' | 'error' | 'warning';
  label: string;
  children?: QueryNode[];
  position?: { start: number; end: number };
  description?: string;
  iconPath?: vscode.ThemeIcon;
}

class QueryTreeProvider implements vscode.TreeDataProvider<QueryNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<QueryNode | undefined | null | void> = new vscode.EventEmitter<QueryNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<QueryNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private queryNodes: QueryNode[] = [];
  private customQueryMode = false;
  private customQueryLineNumber = -1;
  private customQueryText = '';
  private customQueryStartOffset = 0;

  refresh(): void {
    this.customQueryMode = false; // Reset custom mode when refreshing
    this.parseCurrentQuery();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: QueryNode): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(element.label, element.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    
    // Set colorful icons and enhanced labels based on node type
    switch (element.type) {
      case 'root':
        treeItem.iconPath = new vscode.ThemeIcon('symbol-structure', new vscode.ThemeColor('symbolIcon.structureForeground'));
        break;
      case 'group':
        treeItem.iconPath = new vscode.ThemeIcon('bracket', new vscode.ThemeColor('symbolIcon.namespaceForeground'));
        break;
      case 'operator':
        // Color-code different operators
        const operatorColors = this.getOperatorIconAndColor(element.label);
        treeItem.iconPath = new vscode.ThemeIcon(operatorColors.icon, operatorColors.color);
        treeItem.contextValue = 'operator';
        break;
      case 'term':
        // Check if it's a wildcard term and style accordingly
        if (element.label.includes('*')) {
          treeItem.iconPath = new vscode.ThemeIcon('search', new vscode.ThemeColor('symbolIcon.keywordForeground'));
          if (element.label.includes('*') && element.label.indexOf('*') < element.label.length - 1) {
            // Leading wildcard gets lightning bolt for performance warning in icon
            treeItem.iconPath = new vscode.ThemeIcon('zap', new vscode.ThemeColor('warningForeground'));
          }
        } else {
          treeItem.iconPath = new vscode.ThemeIcon('symbol-string', new vscode.ThemeColor('symbolIcon.stringForeground'));
        }
        break;
      case 'phrase':
        treeItem.iconPath = new vscode.ThemeIcon('quote', new vscode.ThemeColor('symbolIcon.stringForeground'));
        break;
      case 'error':
        treeItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
        break;
      case 'warning':
        treeItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('warningForeground'));
        break;
    }

    if (element.description) {
      treeItem.description = element.description;
    }

    if (element.position) {
      treeItem.contextValue = 'queryNode';
      treeItem.command = {
        command: 'dtsearchsyntaxhelper.jumpToQueryNode',
        title: 'Jump to Query Node',
        arguments: [element.position]
      };
    }

    return treeItem;
  }

  getChildren(element?: QueryNode): Thenable<QueryNode[]> {
    if (!element) {
      return Promise.resolve(this.queryNodes);
    }
    return Promise.resolve(element.children || []);
  }

  private parseCurrentQuery(): void {
    // Skip parsing if we're in custom query mode
    if (this.customQueryMode) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.queryNodes = [];
      return;
    }

    const document = editor.document;
    if (document.languageId !== 'dtsearch' && !document.fileName.endsWith('.dt')) {
      this.queryNodes = [];
      return;
    }

    const text = document.getText();
    if (!text.trim()) {
      this.queryNodes = [];
      return;
    }

    this.queryNodes = this.parseQuery(text);
  }

  private parseQuery(text: string): QueryNode[] {
    const lines = text.split('\n');
    const queryNodes: QueryNode[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex].trim();
      
      // Skip comments and empty lines
      if (!line || line.startsWith('//')) {
        continue;
      }

      const lineStart = text.indexOf(lines[lineIndex]);
      const parsedLine = this.parseQueryLine(line, lineStart);
      if (parsedLine) {
        queryNodes.push(parsedLine);
      }
    }

    return queryNodes;
  }

  private parseQueryLine(query: string, offset: number): QueryNode | null {
    if (!query.trim()) {
      return null;
    }

    const rootNode: QueryNode = {
      type: 'root',
      label: `${this.customQueryMode ? 'Custom ' : ''}Query: ${query.length > 30 ? query.substring(0, 30) + '...' : query}`,
      children: [],
      position: { start: offset, end: offset + query.length }
    };

    try {
      const tokens = this.tokenizeQuery(query, offset);
      rootNode.children = this.buildQueryTree(tokens);
      
      // Add error detection
      this.detectErrors(rootNode, query, offset);
      
    } catch (error) {
      rootNode.children = [{
        type: 'error',
        label: 'Parse Error',
        description: 'Could not parse query structure',
        position: { start: offset, end: offset + query.length }
      }];
    }

    return rootNode;
  }

  private tokenizeQuery(query: string, offset: number): Array<{type: string, value: string, start: number, end: number}> {
    const tokens: Array<{type: string, value: string, start: number, end: number}> = [];
    let i = 0;
    
    while (i < query.length) {
      // Skip whitespace
      while (i < query.length && /\s/.test(query[i])) {
        i++;
      }
      
      if (i >= query.length) {
        break;
      }
      
      const start = offset + i;
      let value = '';
      let type = 'term';
      
      // Handle parentheses
      if (query[i] === '(' || query[i] === ')') {
        value = query[i];
        type = 'paren';
        i++;
      }
      // Handle quoted phrases
      else if (query[i] === '"') {
        let j = i + 1;
        value = '"';
        while (j < query.length && query[j] !== '"') {
          value += query[j];
          j++;
        }
        if (j < query.length) {
          value += '"'; // Add closing quote
          j++;
        }
        type = 'phrase';
        i = j;
      }
      // Handle operators and terms
      else {
        // Read the word
        let j = i;
        while (j < query.length && /[a-zA-Z0-9*\/]/.test(query[j])) {
          j++;
        }
        value = query.substring(i, j);
        
        // Check if it's an operator (must be standalone word)
        const upperValue = value.toUpperCase();
        if (/^(AND|OR|NOT|NEAR|WITHIN|W\/\d+|PRE\/\d+)$/.test(upperValue)) {
          // Verify it's a standalone word by checking boundaries
          const beforeChar = i > 0 ? query[i - 1] : ' ';
          const afterChar = j < query.length ? query[j] : ' ';
          
          if (/\s|\(|\)|^/.test(beforeChar) && /\s|\(|\)|$/.test(afterChar)) {
            type = 'operator';
          } else {
            type = 'term'; // It's part of a larger word
          }
        } else if (value.includes('*')) {
          type = 'wildcard';
        }
        
        i = j;
      }
      
      if (value) {
        const end = start + value.length;
        tokens.push({ type, value, start, end });
      }
    }

    return tokens;
  }

  private buildQueryTree(tokens: Array<{type: string, value: string, start: number, end: number}>, depth: number = 0): QueryNode[] {
    const nodes: QueryNode[] = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === 'paren' && token.value === '(') {
        // Find matching closing parenthesis
        let parenCount = 1;
        let j = i + 1;
        const groupTokens: Array<{type: string, value: string, start: number, end: number}> = [];

        while (j < tokens.length && parenCount > 0) {
          if (tokens[j].value === '(') {
            parenCount++;
          } else if (tokens[j].value === ')') {
            parenCount--;
          }

          if (parenCount > 0) {
            groupTokens.push(tokens[j]);
          }
          j++;
        }

        const groupNode: QueryNode = {
          type: 'group',
          label: `📦 Group (${groupTokens.length} items)`,
          children: this.buildQueryTree(groupTokens, depth + 1),
          position: { start: token.start, end: j > i ? tokens[j-1].end : token.end }
        };

        nodes.push(groupNode);
        i = j;
      } else if (token.type === 'operator') {
        // Create an operator node with its operands as children
        const operatorNode: QueryNode = {
          type: 'operator',
          label: this.colorizeOperatorLabel(token.value),
          children: [],
          position: { start: token.start, end: token.end },
          description: this.getOperatorDescription(token.value)
        };

        // Look ahead to group terms with this operator
        const operands: QueryNode[] = [];
        let k = i + 1;
        
        // Collect operands (terms, phrases, wildcards) that follow this operator
        while (k < tokens.length && tokens[k].type !== 'operator' && tokens[k].type !== 'paren') {
          const operandToken = tokens[k];
          
          if (operandToken.type === 'phrase') {
            operands.push({
              type: 'phrase',
              label: `💬 ${operandToken.value}`,
              position: { start: operandToken.start, end: operandToken.end },
              description: 'Exact phrase search'
            });
          } else if (operandToken.type === 'wildcard') {
            operands.push({
              type: 'warning',
              label: `🔍 ${operandToken.value}`,
              position: { start: operandToken.start, end: operandToken.end },
              description: 'Wildcard search (may impact performance)'
            });
          } else {
            operands.push({
              type: 'term',
              label: `📝 ${operandToken.value}`,
              position: { start: operandToken.start, end: operandToken.end },
              description: 'Search term'
            });
          }
          k++;
        }

        if (operands.length > 0) {
          operatorNode.children = operands;
          i = k; // Skip the processed operands
        } else {
          i++;
        }

        nodes.push(operatorNode);
      } else {
        // Handle standalone terms, phrases, wildcards
        if (token.type === 'phrase') {
          nodes.push({
            type: 'phrase',
            label: `💬 ${token.value}`,
            position: { start: token.start, end: token.end },
            description: 'Exact phrase search'
          });
        } else if (token.type === 'wildcard') {
          nodes.push({
            type: 'warning',
            label: `🔍 ${token.value}`,
            position: { start: token.start, end: token.end },
            description: 'Wildcard search (may impact performance)'
          });
        } else {
          nodes.push({
            type: 'term',
            label: `📝 ${token.value}`,
            position: { start: token.start, end: token.end },
            description: 'Search term'
          });
        }
        i++;
      }
    }

    return nodes;
  }

  private getOperatorDescription(operator: string): string {
    switch (operator.toUpperCase()) {
      case 'AND': return 'Both terms must be present';
      case 'OR': return 'Either term can be present';
      case 'NOT': return 'Exclude documents with this term';
      case 'NEAR': return 'Terms must be near each other';
      case 'WITHIN': return 'Terms within specified scope';
      default:
        if (operator.match(/W\/\d+/i)) {
          return `Terms within ${operator.split('/')[1]} words`;
        }
        if (operator.match(/PRE\/\d+/i)) {
          return `First term precedes second by ${operator.split('/')[1]} words`;
        }
        return operator;
    }
  }

  private detectErrors(rootNode: QueryNode, query: string, offset: number): void {
    const errors: QueryNode[] = [];

    // Check for unbalanced parentheses
    const parenBalance = this.getParenthesesBalance(query);
    if (parenBalance !== 0) {
      errors.push({
        type: 'error',
        label: 'Unbalanced Parentheses',
        description: `${Math.abs(parenBalance)} ${parenBalance > 0 ? 'missing closing' : 'extra closing'} parentheses`,
        position: { start: offset, end: offset + query.length }
      });
    }

    // Check for unbalanced quotes
    const quoteBalance = this.getQuoteBalance(query);
    if (quoteBalance !== 0) {
      errors.push({
        type: 'error',
        label: 'Unbalanced Quotes',
        description: 'Missing closing quote',
        position: { start: offset, end: offset + query.length }
      });
    }

    // Check for performance issues
    if (query.includes('*') && query.match(/\*\w+/)) {
      errors.push({
        type: 'warning',
        label: 'Leading Wildcard',
        description: 'Leading wildcards can be very slow',
        position: { start: offset, end: offset + query.length }
      });
    }

    if (errors.length > 0) {
      rootNode.children = [...(rootNode.children || []), ...errors];
    }
  }

  private getParenthesesBalance(text: string): number {
    let balance = 0;
    for (const char of text) {
      if (char === '(') {
        balance++;
      } else if (char === ')') {
        balance--;
      }
    }
    return balance;
  }

  private getQuoteBalance(text: string): number {
    const quotes = (text.match(/"/g) || []).length;
    return quotes % 2;
  }

  private getOperatorIconAndColor(operatorText: string): {icon: string, color: vscode.ThemeColor} {
    const operator = operatorText.toUpperCase().trim();
    
    switch (operator) {
      case 'AND':
        return {
          icon: 'symbol-operator',
          color: new vscode.ThemeColor('symbolIcon.operatorForeground')
        };
      case 'OR':
        return {
          icon: 'git-branch',
          color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
        };
      case 'NOT':
        return {
          icon: 'circle-slash',
          color: new vscode.ThemeColor('errorForeground')
        };
      default:
        // Proximity operators (W/, PRE/, NEAR)
        if (operator.includes('W/') || operator.includes('PRE/') || operator.includes('NEAR')) {
          return {
            icon: 'arrow-both',
            color: new vscode.ThemeColor('symbolIcon.keywordForeground')
          };
        }
        return {
          icon: 'symbol-operator',
          color: new vscode.ThemeColor('symbolIcon.operatorForeground')
        };
    }
  }

  private colorizeOperatorLabel(operatorText: string): string {
    const operator = operatorText.toUpperCase().trim();
    
    switch (operator) {
      case 'AND':
        return `🔗 ${operatorText}`;
      case 'OR':
        return `🌿 ${operatorText}`;
      case 'NOT':
        return `❌ ${operatorText}`;
      default:
        // Proximity operators
        if (operator.includes('W/') || operator.includes('PRE/') || operator.includes('NEAR')) {
          return `↔️ ${operatorText}`;
        }
        return `⚙️ ${operatorText}`;
    }
  }

  private getIndentedLabel(text: string, depth: number): string {
    // Instead of text indentation, use different visual cues for different types
    // VS Code tree view already provides visual indentation through hierarchy
    
    // Add type-specific prefixes for better categorization
    switch (depth) {
      case 0:
        return text; // Root level - no prefix
      case 1:
        return `▶ ${text}`; // First level - arrow
      case 2:
        return `◆ ${text}`; // Second level - diamond
      case 3:
        return `◇ ${text}`; // Third level - hollow diamond
      default:
        return `• ${text}`; // Deeper levels - bullet
    }
  }

  setCustomQuery(queryText: string, lineNumber?: number, startOffset?: number): void {
    // Parse the custom query and update the tree
    this.customQueryMode = true;
    this.customQueryText = queryText;
    this.customQueryLineNumber = lineNumber || -1;
    this.customQueryStartOffset = startOffset || 0;
    this.queryNodes = this.parseQuery(queryText);
    this._onDidChangeTreeData.fire();
  }

  isInCustomQueryMode(): boolean {
    return this.customQueryMode;
  }

  getCustomLineInfo(): {lineNumber: number, queryText: string, startOffset: number} {
    return {
      lineNumber: this.customQueryLineNumber,
      queryText: this.customQueryText,
      startOffset: this.customQueryStartOffset
    };
  }
}

// Global query tree provider instance
let queryTreeProvider: QueryTreeProvider;