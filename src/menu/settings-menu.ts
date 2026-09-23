import DownloadError from '../downloads/download-error.js';
import modelUpdate from '../updates/model-update.js';
import select from '../setup/select-option.js';
import licenseInput from '../setup/license-input.js';
import manageLicense from '../license/manage-license.js';
import type { InstalledModel } from '../models/installed-models.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import cliUpdate, { updateCheckStatus } from '../updates/cli-update.js';
import modelSettings from './model-settings.js';
import updateSettings from './update-settings.js';
import runTerminalTask from '../terminal/run-terminal-task.js';

export default async function settingsMenu(selected?: InstalledModel): Promise<void> {
    var FOOTER = '↑/↓ Move · Enter Select · Ctrl+C Close';
    while (true) {
        setSetupLayout('Settings', '', FOOTER, '/velora/settings');
        var choice = await select({ message: '', choices: [
            { name: 'Update permissions', value: 'permissions' },
            { name: 'Change license', value: 'license' },
            { name: 'Switch model', value: 'model' },
            { name: 'Delete model', value: 'delete' },
            { name: 'Check for updates', value: 'updates' },
            { name: 'Go back', value: 'back' }
        ] });
        if (choice === 'back') {
            break;
        }
        if (choice === 'permissions') {
            setSetupLayout('Update permissions', '', FOOTER, '/velora/updates');
            var permissions = [{ name: 'velora', value: 'cli' }];
            if (selected) {
                permissions.push({ name: 'Engine: ' + selected.name, value: 'engine' });
            }
            permissions.push({ name: 'Go back', value: 'back' });
            var scope = await select({ message: '', choices: permissions });
            if (scope === 'cli') {
                await updateSettings();
            }
            if (scope === 'engine') {
                await updateSettings(selected);
            }
            continue;
        }
        if (choice === 'model' || choice === 'delete') {
            var operation: 'switch' | 'delete' = 'switch';
            if (choice === 'delete') {
                operation = 'delete';
            }
            await modelSettings(operation);
            break;
        }
        if (choice === 'license') {
            setSetupLayout('Change license', 'A verified key replaces the saved license.', 'Enter Continue · Ctrl+C Close', '/licenses');
            var license = await licenseInput({});
            setSetupLayout('Checking your license…', '', 'Ctrl+C Close', '/licenses');
            var result = await runTerminalTask(function (signal) { return manageLicense({ operation: 'set', license }, signal); });
            var message = 'License saved.';
            if (!result.ok) {
                message = result.message;
            }
            setSetupLayout('License', '', FOOTER, '/licenses');
            await select({ message, choices: [{ name: 'Go back', value: 'back' }] });
            continue;
        }
        if (choice === 'updates') {
            setSetupLayout('Check for updates', '', FOOTER, '/velora/updates');
            var targets = [{ name: 'velora', value: 'cli' }];
            if (selected) {
                targets.push({ name: selected.name + ' and its engine', value: 'model' });
            }
            targets.push({ name: 'Go back', value: 'back' });
            var target = await select({ message: '', choices: targets });
            if (target === 'back') {
                continue;
            }
            setSetupLayout('Checking for updates…', '', 'Ctrl+C Close', '/velora/updates');
            var message = 'Could not check for updates. Try again later.';
            if (target === 'cli') {
                var version = await runTerminalTask(function (signal) { return cliUpdate(undefined, undefined, signal); });
                if (updateCheckStatus === 'current') {
                    message = 'velora is up to date.';
                }
                if (version) {
                    message = 'velora ' + version + ' is available.';
                }
            }
            if (target === 'model' && selected) {
                try {
                    var model = selected;
                    message = await runTerminalTask(function (signal) { return modelUpdate(model, signal); });
                } catch (error) {
                    if (error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) {
                        throw error;
                    }
                    if (error instanceof DownloadError) {
                        message = error.message;
                    }
                }
            }
            setSetupLayout('Update check', '', FOOTER, '/velora/updates');
            await select({ message, choices: [{ name: 'Go back', value: 'back' }] });
            continue;
        }
    }
}
