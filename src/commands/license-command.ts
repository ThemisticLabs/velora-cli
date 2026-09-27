import runTerminalTask from '../terminal/run-terminal-task.js';
import manageLicense from '../license/manage-license.js';
import licenseInput from '../setup/license-input.js';
import setupDimensions, { MIN_COLUMNS, MIN_ROWS } from '../terminal/setup-dimensions.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import header from '../terminal/header.js';

export default async function licenseCommand(operation: 'set' | 'status'): Promise<void> {
    if (operation === 'set' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        process.stdout.write('Run velora license set in an interactive terminal.\n');
        return;
    }
    if (operation === 'set' && setupDimensions().tooSmall) {
        process.stdout.write('Enlarge the terminal to ' + MIN_COLUMNS + ' × ' + MIN_ROWS + ' and try again.\n');
        return;
    }
    var controller = new AbortController();
    var cancel = function () { controller.abort(); };
    var alternateScreen = operation === 'set';
    var summary = 'License check cancelled.';
    var task: ReturnType<typeof manageLicense> | undefined;
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    try {
        if (operation === 'status') {
            task = manageLicense({ operation: 'status' }, controller.signal);
            var result = await task;
        } else {
            process.stdout.write('\u001b[?1049h');
            setSetupLayout('Set your license.', 'A verified key replaces the saved license.', 'Enter Continue · Esc Cancel · Ctrl+C Quit', '/velora/license-api/');
            var license = await licenseInput({}, { signal: controller.signal });
            if (!license) {
                return;
            }
            setSetupLayout('Checking your license.', '', 'Ctrl+C Cancel', '/velora/license-api/');
            var result = await runTerminalTask(function (signal, progress) {
                task = manageLicense({ operation: 'set', license }, AbortSignal.any([signal, controller.signal]), undefined, progress);
                return task;
            });
        }
        if (!result.ok) {
            summary = result.message;
            return;
        }
        summary = 'License valid.';
        if (result.saved) {
            summary = 'License saved.';
        }
        summary += '\nExpires ' + new Date(result.expiresAt).toISOString().slice(0, 10);
        summary += ' · Devices ' + result.registeredDevices + '/' + result.maxDevices;
    } catch (error) {
        if (!controller.signal.aborted && !(error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name))) {
            summary = 'Could not manage the license. Try again.';
        }
    } finally {
        controller.abort();
        if (task) {
            try {
                var settled = await task;
                if (settled.ok && settled.saved && summary === 'License check cancelled.') {
                    summary = 'License verified and saved before cancellation completed.';
                }
            } catch {
                // The operation was cancelled before the credential write started.
            }
        }
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
        if (alternateScreen) {
            process.stdout.write('\u001b[?25h\u001b[?1049l');
        }
        process.stdout.write(header(true) + summary + '\n');
    }
}
