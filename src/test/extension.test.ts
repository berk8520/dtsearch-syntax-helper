import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Purview help command is registered', async () => {
		// Get all available commands
		const commands = await vscode.commands.getCommands(true);
		
		// Verify that our new Purview help command is registered
		assert.ok(commands.includes('dtsearchsyntaxhelper.showPurviewHelp'), 
			'Command dtsearchsyntaxhelper.showPurviewHelp should be registered');
	});
});
