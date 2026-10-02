import updateMenu from './update-menu.js';
import select from '../setup/select-option.js';
import licenseInput from '../setup/license-input.js';
import manageLicense from '../license/manage-license.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import manageModels from './manage-models.js';
import doctorScreen from './doctor-screen.js';
import updateSettings from './update-settings.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import editApiSettings from './api-settings.js';

export default async function settingsMenu(): Promise<void> {
    var FOOTER = '↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit';
    var currentChoice = 'permissions';
    while (true) {
        setSetupLayout('Settings', '', FOOTER, '/velora/settings');
        var choice = await select({ back: true, message: '', initialValue: currentChoice, choices: [
            { name: 'Update permissions', value: 'permissions' },
            { name: 'Change license', value: 'license' },
            { name: 'Manage models', value: 'models' },
            { name: 'Check for updates', value: 'updates' },
            { name: 'Local API port', value: 'api' },
            { name: 'Doctor', value: 'doctor' }
        ] });
        currentChoice = choice;
        if (choice === 'back') {
            break;
        }
        if (choice === 'permissions') {
            await updateSettings();
            continue;
        }
        if (choice === 'api') {
            await editApiSettings();
            continue;
        }
        if (choice === 'models') {
            await manageModels();
            continue;
        }
        if (choice === 'doctor') {
            await doctorScreen();
            continue;
        }
        if (choice === 'license') {
            setSetupLayout('Settings / License', 'A verified key replaces the saved license.', 'Enter Continue · Esc Back · Ctrl+C Quit', '/velora/license-api/');
            var license = await licenseInput({});
            if (!license) {
                continue;
            }
            setSetupLayout('Checking your license…', '', 'Ctrl+C Close', '/velora/license-api/');
            var result = await runTerminalTask(function (signal, progress) { return manageLicense({ operation: 'set', license }, signal, undefined, progress); });
            var message = 'License saved.';
            if (!result.ok) {
                message = result.message;
            }
            setSetupLayout('License', '', 'Esc Back · Ctrl+C Quit', '/velora/license-api/');
            await select({ back: true, message, choices: [] });
            continue;
        }
        if (choice === 'updates') {
            await updateMenu();

        }
    }
}
