import DownloadError from '../downloads/download-error.js';
import modelUpdate from '../updates/model-update.js';
import select from '../setup/select-option.js';
import licenseInput from '../setup/license-input.js';
import manageLicense from '../license/manage-license.js';
import installedModels, { type InstalledModel } from '../models/installed-models.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import cliUpdate, { updateCheckStatus } from '../updates/cli-update.js';
import modelSettings from './model-settings.js';
import updateSettings from './update-settings.js';
import runTerminalTask from '../terminal/run-terminal-task.js';

export default async function settingsMenu(selected?: InstalledModel): Promise<void> {
    var FOOTER = '↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit';
    var currentChoice = 'permissions';
    while (true) {
        setSetupLayout('Settings', '', FOOTER, '/velora/settings');
        var choice = await select({ message: '', initialValue: currentChoice, choices: [
            { name: 'Update permissions', value: 'permissions' },
            { name: 'Change license', value: 'license' },
            { name: 'Switch model', value: 'model' },
            { name: 'Delete model', value: 'delete' },
            { name: 'Check for updates', value: 'updates' },
            { name: 'Go back', value: 'back' }
        ] });
        currentChoice = choice;
        if (choice === 'back') {
            break;
        }
        if (choice === 'permissions') {
            await updateSettings(selected);
            continue;
        }
        if (choice === 'model' || choice === 'delete') {
            var operation: 'switch' | 'delete' = 'switch';
            if (choice === 'delete') {
                operation = 'delete';
            }
            await modelSettings(operation);
            selected = undefined;
            for (var model of await installedModels({ operation: 'list' })) {
                if (model.selected) {
                    selected = model;
                }
            }
            continue;
        }
        if (choice === 'license') {
            setSetupLayout('Settings / License', 'A verified key replaces the saved license.', 'Enter Continue · Esc Back · Ctrl+C Quit', '/licenses');
            var license = await licenseInput({});
            if (!license) {
                continue;
            }
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
            setSetupLayout('Settings / Updates', '', FOOTER, '/velora/updates');
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
