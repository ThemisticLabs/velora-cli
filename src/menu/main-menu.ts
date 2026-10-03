import { cliUpdatePending } from '../updates/install-cli-update.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import settingsMenu from './settings-menu.js';
import setup from '../setup/setup.js';
import select from '../setup/select-option.js';
import startupLicense from '../license/startup-license.js';
import engineUpdate from '../updates/engine-update.js';
import engineUpdatePreferences from '../updates/engine-update-preferences.js';
import licenseStore from '../license/license-store.js';
import installedModels, { type InstalledModel } from '../models/installed-models.js';
import setupDimensions, { MIN_COLUMNS, MIN_ROWS } from '../terminal/setup-dimensions.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import menuBar from '../system/menu-bar.js';
import manageApiKeys from './api-keys.js';

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
    var tray: Awaited<ReturnType<typeof menuBar>> | undefined;
    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    try {
        tray = await menuBar();
        try {
            setSetupLayout('Opening velora…', '', '/velora', 'Ctrl+C Close');
            var savedLicense = await runTerminalTask(function () { return licenseStore({ operation: 'read' }); });
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) {
                throw error;
            }
            setSetupLayout('Saved license unavailable.', 'Unlock your system credential store and try again.', '/velora/license-api/', FOOTER);
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
        var licenseVerified = true;
        if (!startSetup && savedLicense) {
            licenseVerified = await startupLicense(savedLicense);
        }
        try {
            var enginePreferences = await engineUpdatePreferences();
            if (licenseVerified && enginePreferences?.checkAutomatically) {
                setSetupLayout('Checking engine updates…', '', '/velora/updates', 'Ctrl+C Close');
                await runTerminalTask(function (signal) { return engineUpdate(signal); });
            }
        } catch (error) {
            if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) {
                throw error;
            }
            // Update availability never prevents access to settings.
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
                setSetupLayout(title, '', '/velora', FOOTER);
                var choice = await select({ message: '', choices: [
                    { name: 'API keys', value: 'keys' },
                    { name: 'Settings', value: 'settings' }
                ] });
                if (choice === 'keys') {
                    await manageApiKeys();
                    continue;
                }
                await settingsMenu();
                if (cliUpdatePending) { return; }
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
                setSetupLayout('Could not complete this action.', '', '/velora/settings', 'Esc Back · Ctrl+C Quit');
                await select({ back: true, message, choices: [] });
            }
        }
    } catch (error) {
        if (!(error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name))) {
            failure = 'Could not open velora. Try again or run velora doctor.';
        }
    } finally {
        tray?.close();
        process.stdout.write(RESTORE_TERMINAL);
        if (cliUpdatePending) { process.stdout.write('velora update prepared. Start velora again in a moment.\n'); }
        if (tray && !tray.available) { process.stdout.write('Could not display the macOS menu bar icon.\n'); }
        if (failure) {
            process.stdout.write(failure + '\n');
        }
    }
}
