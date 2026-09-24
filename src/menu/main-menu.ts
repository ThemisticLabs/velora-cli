import runTerminalTask from '../terminal/run-terminal-task.js';
import settingsMenu from './settings-menu.js';
import setup from '../setup/setup.js';
import select from '../setup/select-option.js';
import licenseStore from '../license/license-store.js';
import installedModels, { type InstalledModel } from '../models/installed-models.js';
import setupDimensions, { MIN_COLUMNS, MIN_ROWS } from '../terminal/setup-dimensions.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function mainMenu(startSetup = false): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write('Setup needs an interactive terminal. Run velora setup in your terminal.\n');
        process.exitCode = 1;
        return;
    }
    if (setupDimensions().tooSmall) {
        process.stdout.write('Enlarge the terminal to ' + MIN_COLUMNS + ' × ' + MIN_ROWS + ' and run velora again.\n');
        return;
    }
    var FOOTER = '↑/↓ Move · Enter Select · Ctrl+C Close';
    var ENTER_ALTERNATE_SCREEN = '\u001b[?1049h';
    var RESTORE_TERMINAL = '\u001b[?25h\u001b[?1049l';
    var failure = '';
    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    try {
        try {
            setSetupLayout('Opening velora…', '', 'Ctrl+C Close', '/velora');
            var savedLicense = await runTerminalTask(function () { return licenseStore({ operation: 'read' }); });
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) {
                throw error;
            }
            setSetupLayout('Saved license unavailable.', 'Unlock your system credential store and try again.', FOOTER, '/licenses');
            var recovery = await select({ message: 'Next step', choices: [
                { name: 'Enter a license', value: 'enter' }, { name: 'Close', value: 'close' }
            ] });
            if (recovery === 'close') {
                return;
            }
            savedLicense = null;
        }
        if (startSetup || !savedLicense) {
            if (!await setup()) {
                return;
            }
        }
        while (true) {
            try {
                var models = await installedModels({ operation: 'list' });
                var selected: InstalledModel | undefined = undefined;
                for (var model of models) {
                    if (model.selected) {
                        selected = model;
                    }
                }
                var title = 'Selected model: None';
                if (selected) {
                    title = 'Selected model: ' + selected.name;
                }
                setSetupLayout(title, '', 'Enter Settings · Ctrl+C Quit', '/velora');
                await select({ message: '', choices: [{ name: 'Settings', value: 'settings' }] });
                await settingsMenu(selected);
            } catch (error) {
                if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) {
                    throw error;
                }
                var message = 'Check model storage permissions and try again.';
                if (error instanceof Error && error.name === 'ModelStorageError') {
                    message = error.message;
                }
                if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
                    message = 'Another installation holds the model lock. Wait for it to finish and try again.';
                }
                setSetupLayout('Could not complete this action.', '', 'Esc Back · Ctrl+C Quit', '/velora/settings');
                await select({ back: true, message, choices: [] });
            }
        }
    } catch (error) {
        if (!(error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name))) {
            failure = 'Could not open velora. Try again or run velora doctor.';
        }
    } finally {
        process.stdout.write(RESTORE_TERMINAL);
        if (failure) {
            process.stdout.write(failure + '\n');
        }
    }
}
