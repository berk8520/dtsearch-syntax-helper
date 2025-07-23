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

// Debouncing for performance
let highlightTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Initialize decoration types and status bar
  initializeDecorations();
  
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

  // Register event listeners for active editor changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    // Reset force mode when switching editors
    forceDtSearchMode = false;
    
    if (editor && isDtSearchFile(editor)) {
      debouncedHighlight(editor);
      updateStatusBar();
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    if (vscode.window.activeTextEditor && 
        event.document === vscode.window.activeTextEditor.document &&
        isDtSearchFile(vscode.window.activeTextEditor)) {
      debouncedHighlight(vscode.window.activeTextEditor);
      updateStatusBar();
    }
  }, null, context.subscriptions);

  // Auto-save cleanup if enabled
  vscode.workspace.onDidSaveTextDocument(document => {
    const config = vscode.workspace.getConfiguration('dtsearch');
    if (config.get('autoCleanupOnSave', false) && document.fileName.endsWith('.dts')) {
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
  return fileName.endsWith('.dts') || editor.document.languageId === 'dtsearch' || forceDtSearchMode;
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
  const quotes = (text.match(/"/g) || []).length;
  return quotes % 2;
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

  // Get the word at the current position
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

  // Check if the word is a noise word
  if (noiseWords.has(word)) {
    const hoverText = new vscode.MarkdownString();
    hoverText.appendMarkdown(`**dtSearch Noise Word:** \`${word}\`\n\n`);
    hoverText.appendMarkdown(`This word is typically **ignored** by dtSearch engines during searches. `);
    hoverText.appendMarkdown(`Common words like "${word}" are filtered out to improve search performance and relevance.\n\n`);
    hoverText.appendMarkdown(`💡 **Tip:** Use quotes around phrases if you need to search for noise words: \`"the ${word}"\``);
    
    return new vscode.Hover(hoverText, wordRange);
  }

  return undefined;
}

function initializeDecorations() {
  // Operator decoration - blue color
  operatorDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#007acc', // Blue
    fontWeight: 'bold'
  });

  // Search term decoration - neutral color
  searchTermDecorationType = vscode.window.createTextEditorDecorationType({
    color: '#a0a0a0' // Neutral gray
  });

  // Create multiple decoration types for different parentheses pairs
  const colors = ['#ffcc02', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#9b59b6'];
  for (let i = 0; i < colors.length; i++) {
    parenDecorationTypes.push(vscode.window.createTextEditorDecorationType({
      color: colors[i], // Text color instead of background
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

  // Find and handle quotes
  const quotePositions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      quotePositions.push(i);
    }
  }

  // Color quotes - pairs get normal color, unmatched get red squiggly
  for (let i = 0; i < quotePositions.length; i++) {
    const pos = quotePositions[i];
    const startPos = editor.document.positionAt(pos);
    const endPos = editor.document.positionAt(pos + 1);
    
    // If we have an even number of quotes, all should be matched
    // If we have an odd number, the last one is unmatched
    if (quotePositions.length % 2 === 0) {
      // Even number - all quotes are matched
      quoteRanges.push(new vscode.Range(startPos, endPos));
    } else {
      // Odd number - last quote is unmatched
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
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
  }
  parenDecorationTypes.forEach(decorationType => {
    decorationType.dispose();
  });
}