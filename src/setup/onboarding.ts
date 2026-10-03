import apiKeys from '../api/api-keys.js';
import manageApiKeys from '../menu/api-keys.js';
import updateSettings from '../menu/update-settings.js';
import autostartSettings from '../menu/autostart-settings.js';
import setupProgress, { INTRO_STEPS } from './setup-progress.js';
import select from './select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';

export default async function onboarding(options: { review?: boolean } = {}): Promise<boolean> {
    while (true) {
        try { var step = await setupProgress(); break; }
        catch {
            if (!await retryStorage('Setup progress unavailable.', 'Check setup.json and storage access.')) { return false; }
        }
    }
    if (options.review) { step = 0; }
    while (step < INTRO_STEPS) {
        if (step === 0) {
            try { var keys = await apiKeys({ operation: 'list' }); }
            catch {
                if (!await retryStorage('API keys unavailable.', 'Check API key storage and file permissions.')) { return false; }
                continue;
            }
            setSetupLayout('Setup 1 of 5 / First API key', 'Give your application access to the local API. Keys do not encrypt processing.', '/velora');
            var choices = [{ name: 'Create API key', value: 'create' }, { name: 'Set up later', value: 'continue' }];
            if (keys.keys.length > 0) {
                choices = [{ name: 'Continue with existing keys', value: 'continue' }, { name: 'Create another API key', value: 'create' }];
            }
            var choice = await select({ back: true, message: '', choices });
            if (choice === 'back') { return false; }
            if (choice === 'create') {
                if (!await manageApiKeys(undefined, undefined, { createOnly: true })) { continue; }
            }
        }
        if (step === 1 && !await updateSettings({ setup: true })) { step--; continue; }
        if (step === 2 && !await autostartSettings({ setup: true })) { step--; continue; }
        if (step === 3) {
            var pages = [
                { title: 'Start and stop', text: 'Choose Start in the main menu to load your model and open the local API. Stop finishes the active request, then unloads the model.' },
                { title: 'Your applications', text: 'Manage access under API keys. Use a different key for each app. Settings contains models, licenses, updates and the local API port.' },
                { title: 'The macOS menu bar', text: 'Click the velora icon to see service status. Start/Stop controls the service. Open velora opens the CLI. Settings opens its settings. The power button quits velora and stops the service.' },
                { title: 'Keep it running', text: 'Ctrl+C closes this interactive session. The service keeps running. Use velora serve start --headless to start it without keeping a terminal open.' },
                { title: 'Find your way', text: 'Use arrow keys and Enter to select. Esc returns to the previous page. F1 opens documentation. Next, add your license and download a model.' }
            ];
            var page = 0;
            while (page < pages.length) {
                var current = pages[page]!;
                setSetupLayout('Setup 4 of 5 / Using velora', '', '/velora');
                var next = 'Next';
                if (page === pages.length - 1) { next = 'Set up license and model'; }
                var action = await select({ back: true, message: current.title + '\n\n' + current.text,
                    choices: [{ name: next, value: 'next' }] });
                if (action === 'back') { page--; }
                else { page++; }
                if (page < 0) { break; }
            }
            if (page < 0) { step--; continue; }
        }
        step++;
        while (true) {
            try { await setupProgress(step); break; }
            catch {
                if (!await retryStorage('Could not save setup progress.', 'Your completed changes remain saved. Check setup.json and storage access.')) { return false; }
            }
        }
    }
    return true;
}

async function retryStorage(title: string, detail: string): Promise<boolean> {
    setSetupLayout(title, detail, '/velora/setup', undefined, 'Error');
    return await select({ back: true, message: '', choices: [{ name: 'Try again', value: 'retry' }] }) !== 'back';
}
