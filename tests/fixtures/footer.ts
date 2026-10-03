import { createPrompt, isEnterKey, useKeypress } from '@inquirer/core';
import runTerminalTask from '../../src/terminal/run-terminal-task.js';
import setSetupLayout from '../../src/terminal/set-setup-layout.js';
import useSetupScreen from '../../src/terminal/use-setup-screen.js';
import select from '../../src/setup/select-option.js';

setSetupLayout('Opening velora…', '', '/velora', 'Ctrl+C Close');
await runTerminalTask(async function () { await Bun.sleep(150); });
setSetupLayout('Checking your license…', '', '/velora/license-api/', 'Ctrl+C Close');
await runTerminalTask(async function (_signal, progress) {
    await Bun.sleep(100);
    progress({ downloaded: 0, total: 0, message: 'Checking license access.' });
    await Bun.sleep(150);
});
setSetupLayout('License input', '', '/velora/license-api/', 'Enter Continue · Esc Back · Ctrl+C Quit');
var prompt = createPrompt<void, { content: string; error?: string }>(function (config, done) {
    useKeypress(function (key) { if (isEnterKey(key)) { done(); } });
    return useSetupScreen(config.content, config.error);
});
await prompt({ content: '  License key: ', error: 'Enter a license key.' });
setSetupLayout('Full content', '', '/velora', 'Enter Continue · Ctrl+C Quit');
await prompt({ content: '  Extra content row\n'.repeat(80) });
setSetupLayout('Selected model: Test model', '', '/velora');
await select({ message: '', back: true, choices: [{ name: 'Settings', value: 'settings' }] });
process.stdout.write('Footer verified.\n');
