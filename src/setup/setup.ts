import installedModels from '../models/installed-models.js';
import select from './select-option.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import { ExitPromptError } from '@inquirer/core';
import engineUpdatePreferences from '../updates/engine-update-preferences.js';
import manageLicense from '../license/manage-license.js';
import licenseStore from '../license/license-store.js';
import downloadScreen from './download-screen.js';
import modelList from './model-list.js';
import licenseInput from './license-input.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function setup(options: { modelsOnly?: boolean } = {}): Promise<boolean | undefined> {
    while (true) {
        setSetupLayout('Choose your model access.', 'Use a license or explore the upcoming public model.', '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel');
        var choice = 'license';
        if (!options.modelsOnly) {
            choice = await select({
                message: 'How would you like to begin?',
                choices: [
                    { name: 'Use a license', value: 'license', description: 'Access licensed models with your Themistic key.' },
                    { name: 'Use a public model', value: 'public', description: 'Start without a license. Public Veyra1 is coming later.' }
                ]
            });
        }
        if (choice === 'public') {
            setSetupLayout('Public models will be available soon.', 'Veyra1 is coming. You can use a license in the meantime.', 'Enter Go back  ·  Ctrl+C Cancel');
            await select({
                message: 'Next step',
                choices: [{ name: 'Go back', value: 'back' }]
            });
            continue;
        }

        while (true) {
            try {
                var savedLicense = await licenseStore({ operation: 'read' });
            } catch (error) {
                var message = 'Could not read the system credential store.';
                if (error instanceof Error) {
                    message = error.message;
                }
                setSetupLayout('Saved license unavailable.', message, '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/licenses');
                var storageAction = await select({ message: 'Next step', choices: [
                    { name: 'Enter a license', value: 'enter' }, { name: 'Go back', value: 'back' }
                ] });
                if (storageAction === 'back') {
                    break;
                }
                savedLicense = null;
            }
            var useSaved = false;
            if (savedLicense && !options.modelsOnly) {
                setSetupLayout('Your saved license.', 'The key is stored in the system credential store.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/licenses');
                var licenseChoice = await select({ message: 'How would you like to continue?', choices: [
                    { name: 'Use saved license', value: 'saved' },
                    { name: 'Use a different license', value: 'change' },
                    { name: 'Go back', value: 'back' }
                ] });
                if (licenseChoice === 'back') {
                    break;
                }
                useSaved = licenseChoice === 'saved';
            }
            if (options.modelsOnly && savedLicense) {
                useSaved = true;
            }
            var license = savedLicense || '';
            if (!useSaved) {
                setSetupLayout('Enter your license.', 'The key is verified, then saved in the system credential store.', 'Enter Continue · Esc Back · Ctrl+C Quit', '/licenses');
                license = await licenseInput({});
                if (!license) {
                    break;
                }
            }
            setSetupLayout('Checking your license.', 'Looking up your models.', 'Ctrl+C Cancel', '/licenses');
            var result = await runTerminalTask(function (signal) {
                if (useSaved) {
                    return manageLicense({ operation: 'status' }, signal);
                }
                return manageLicense({ operation: 'set', license }, signal);
            });
            if (!result.ok) {
                setSetupLayout('License check unsuccessful.', result.message, '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel', '/licenses');
                var action = await select({ message: 'Next step', choices: [
                    { name: 'Try again', value: 'retry' }, { name: 'Go back', value: 'back' }
                ] });
                if (action === 'retry') {
                    continue;
                }
                break;
            }
            license = result.license;
            var expires = new Date(result.expiresAt).toISOString().slice(0, 10);
            while (true) {
                var next = await modelList(result.models, 'Expires ' + expires + ' · Devices ' + result.registeredDevices + '/' + result.maxDevices);
                if (next === 'finish') {
                    return true;
                }
                if (next === 'back') {
                    if (options.modelsOnly) {
                        return;
                    }
                    break;
                }
                setSetupLayout('Download ' + next.name + '?', 'This registers this device with your license.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/models/' + next.id);
                var confirmation = await select({ message: 'Continue with installation?', choices: [
                    { name: 'Download model', value: 'download' }, { name: 'Go back', value: 'back' }
                ] });
                if (confirmation === 'back') {
                    continue;
                }
                var downloadOutcome = await downloadScreen(license, next);
                if (downloadOutcome === 'cancelled-after-install') {
                    throw new ExitPromptError('Setup cancelled after installation.');
                }
                if (downloadOutcome !== 'complete') {
                    continue;
                }
                await installedModels({ operation: 'select', id: next.id });
                setSetupLayout('Engine update checks.', 'Allow this model’s engine to look for its own updates.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/velora/updates');
                var checks = await select({ message: 'Allow the engine to check for updates itself?', choices: [
                    { name: 'No, do not check automatically', value: 'no' }, { name: 'Yes, allow automatic engine checks', value: 'yes' }
                ] });
                var installAutomatically = false;
                if (checks === 'yes') {
                    setSetupLayout('Engine update installation.', 'Allow the engine to install its own eligible updates.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/velora/updates');
                    var installation = await select({ message: 'Allow the engine to install updates automatically?', choices: [
                        { name: 'No, install manually', value: 'no' }, { name: 'Yes, allow automatic engine installation', value: 'yes' }
                    ] });
                    installAutomatically = installation === 'yes';
                }
                try {
                    await engineUpdatePreferences(next.id, { checkAutomatically: checks === 'yes', installAutomatically });
                } catch {
                    setSetupLayout('Model installed. Preferences not saved.', 'Open Settings to save engine update permissions.', 'Enter Continue · Ctrl+C Close', '/velora/updates');
                    await select({ message: '', choices: [{ name: 'Continue', value: 'continue' }] });
                }
                return true;
            }
            break;
        }
        if (options.modelsOnly) {
            return;
        }
    }
}
