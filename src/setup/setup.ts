import installedModels from '../models/installed-models.js';
import select from './select-option.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import { ExitPromptError } from '@inquirer/core';
import manageLicense from '../license/manage-license.js';
import licenseStore from '../license/license-store.js';
import downloadScreen from './download-screen.js';
import modelList from './model-list.js';
import licenseInput from './license-input.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import licensePurchase from '../system/license-purchase.js';

export default async function setup(options: { modelsOnly?: boolean } = {}): Promise<boolean | undefined> {
    while (true) {
        var title = 'Setup 5 of 5 / License and model';
        if (options.modelsOnly) { title = 'Install a model'; }
        setSetupLayout(title, 'Use a license or explore the upcoming public model.', '/velora/license-api/', '↑/↓ Move  ·  Enter Select  ·  Ctrl+C Cancel');
        var choice = 'license';
        if (!options.modelsOnly) {
            choice = await select({
                message: 'How would you like to begin?',
                choices: [
                    { name: 'Use a license', value: 'license', description: 'Access licensed models with your Themistic key.' },
                    { name: 'Get license', value: 'purchase', description: 'Open the Themistic license store.' },
                    { name: 'Use a public model', value: 'public', description: 'Start without a license. Public Veyra1 is coming later.' }
                ]
            });
        }
        if (choice === 'purchase') {
            setSetupLayout('Get license', '', '/velora/license-api/', 'Esc Back · Ctrl+C Quit');
            await select({ back: true, message: await licensePurchase(), choices: [] });
            continue;
        }
        if (choice === 'public') {
            setSetupLayout('Public models will be available soon.', 'Veyra1 is coming. You can use a license in the meantime.', '/velora/setup', 'Esc Back · Ctrl+C Quit');
            await select({ back: true,
                message: '',
                choices: []
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
                setSetupLayout('Saved license unavailable.', message, '/velora/license-api/');
                var storageAction = await select({ back: true, message: 'Next step', choices: [
                    { name: 'Enter a license', value: 'enter' }
                ] });
                if (storageAction === 'back') {
                    break;
                }
                savedLicense = null;
            }
            var useSaved = false;
            if (savedLicense && !options.modelsOnly) {
                setSetupLayout('Your saved license.', 'The key is stored in the system credential store.', '/velora/license-api/');
                var licenseChoice = await select({ back: true, message: 'How would you like to continue?', choices: [
                    { name: 'Use saved license', value: 'saved' },
                    { name: 'Use a different license', value: 'change' }
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
                setSetupLayout('Enter your license.', 'The key is verified, then saved in the system credential store.', '/velora/license-api/', 'Enter Continue · Esc Back · Ctrl+C Quit');
                license = await licenseInput({});
                if (!license) {
                    break;
                }
            }
            setSetupLayout('Checking your license.', 'Preparing the engine and looking up your models.', '/velora/license-api/', 'Ctrl+C Cancel');
            var result = await runTerminalTask(function (signal, progress) {
                if (useSaved) {
                    return manageLicense({ operation: 'status' }, signal, undefined, progress);
                }
                return manageLicense({ operation: 'set', license }, signal, undefined, progress);
            });
            if (!result.ok) {
                setSetupLayout('License check unsuccessful.', result.message, '/velora/license-api/', undefined, 'Error');
                var action = await select({ back: true, message: 'Next step', choices: [
                    { name: 'Try again', value: 'retry' }
                ] });
                if (action === 'retry') {
                    continue;
                }
                break;
            }
            license = result.license;
            var expires = new Date(result.expiresAt).toISOString().slice(0, 10);
            while (true) {
                var installedIds = new Set<string>();
                for (var installed of await installedModels({ operation: 'list' })) {
                    installedIds.add(installed.id);
                }
                var availableModels = [];
                for (var model of result.models) {
                    if (!installedIds.has(model.id)) {
                        availableModels.push(model);
                    }
                }
                if (result.models.length > 0 && availableModels.length === 0) {
                    setSetupLayout('All your models are installed.', '', '/velora/models', 'Esc Back · Ctrl+C Quit');
                    await select({ back: true, message: '', choices: [] });
                    return true;
                }
                var next = await modelList(availableModels, 'Expires ' + expires + ' · Devices ' + result.registeredDevices + '/' + result.maxDevices);
                if (next === 'finish') {
                    return true;
                }
                if (next === 'back') {
                    if (options.modelsOnly) {
                        return;
                    }
                    break;
                }
                setSetupLayout('Download ' + next.name + '?', 'This registers this device with your license.', '/velora/models/' + next.id, 'Enter Download · Esc Back · Ctrl+C Quit');
                var confirmation = await select({ back: true, message: 'Continue with installation?', choices: [
                    { name: 'Download model', value: 'download' }
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
                return true;
            }
            break;
        }
        if (options.modelsOnly) {
            return;
        }
    }
}
