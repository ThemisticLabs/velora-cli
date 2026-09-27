import licenseAccess from './license-access.js';
import manageLicense from './manage-license.js';
import licenseInput from '../setup/license-input.js';
import select from '../setup/select-option.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function startupLicense(license: string): Promise<boolean> {
    setSetupLayout('Checking your license…', '', 'Ctrl+C Close', '/velora/license-api/');
    var result = await runTerminalTask(function (signal, progress) { return licenseAccess(license, signal, undefined, progress); });
    while (true) {
        if (result.ok) {
            return true;
        }
        var title = 'License could not be checked.';
        if ('reason' in result && ['expired', 'revoked', 'unknown_key'].includes(result.reason || '')) {
            title = result.message;
        }
        var message = result.message;
        if (title === message) {
            message = 'Change your license or check again.';
        }
        setSetupLayout(title, message, '↑/↓ Move · Enter Select · Ctrl+C Quit', '/velora/license-api/');
        var choice = await select({ message: '', choices: [
            { name: 'Change license', value: 'change' },
            { name: 'Check again', value: 'retry' },
            { name: 'Continue to menu', value: 'continue' }
        ] });
        if (choice === 'continue') {
            return false;
        }
        if (choice === 'retry') {
            setSetupLayout('Checking your license…', '', 'Ctrl+C Close', '/velora/license-api/');
            result = await runTerminalTask(function (signal, progress) { return licenseAccess(license, signal, undefined, progress); });
            continue;
        }
        setSetupLayout('Change license', '', 'Enter Continue · Esc Back · Ctrl+C Quit', '/velora/license-api/');
        var replacement = await licenseInput({});
        if (!replacement) {
            continue;
        }
        setSetupLayout('Checking your license…', '', 'Ctrl+C Close', '/velora/license-api/');
        var saved = await runTerminalTask(function (signal, progress) {
            return manageLicense({ operation: 'set', license: replacement }, signal, undefined, progress);
        });
        if (saved.ok) {
            return true;
        }
        setSetupLayout('License not saved.', saved.message, 'Esc Back · Ctrl+C Quit', '/velora/license-api/');
        await select({ back: true, message: '', choices: [] });
    }
}
