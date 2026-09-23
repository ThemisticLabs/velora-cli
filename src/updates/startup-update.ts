import cliUpdatePreferences from './cli-update-preferences.js';
import dataDirectory from '../system/data-directory.js';
import selectOption from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import cliUpdate from './cli-update.js';

export default async function startupUpdate(signal: AbortSignal, directory = dataDirectory(), choose = selectOption, check = cliUpdate): Promise<void> {
    try {
        var preferences = await cliUpdatePreferences(undefined, directory);
    } catch {
        process.stderr.write('Could not read cli-updates.json. Update checks are off. Check the file and try again.\n');
        return;
    }
    var firstLaunch = preferences === null;
    var savePreferences = firstLaunch;
    var allowed = preferences?.checkAutomatically ?? null;
    var installAutomatically = preferences?.installAutomatically ?? null;
    signal.throwIfAborted();
    if (!firstLaunch && (allowed === null || allowed && installAutomatically === null)) {
        process.stdout.write('\u001b[?1049h');
        try {
            if (allowed === null) {
                setSetupLayout('velora updates', 'Check GitHub for new versions of velora.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/velora/updates');
                var choice = await choose({
                    message: 'Check for velora updates on startup?',
                    choices: [
                        { name: 'No', value: 'no' },
                        { name: 'Yes', value: 'yes' }
                    ]
                }, { signal });
                allowed = choice === 'yes';
            }
            installAutomatically = false;
            if (allowed) {
                setSetupLayout('Automatic velora updates', 'Save your choice. Automatic installation is coming later.', '↑/↓ Move · Enter Select · Ctrl+C Cancel', '/velora/updates');
                var installation = await choose({
                    message: 'Allow automatic installation when available?',
                    choices: [
                        { name: 'No, install manually', value: 'no' },
                        { name: 'Yes, allow automatic installation', value: 'yes' }
                    ]
                }, { signal });
                installAutomatically = installation === 'yes';
            }
            savePreferences = true;
        } finally {
            process.stdout.write('\u001b[?25h\u001b[?1049l');
        }
    }
    signal.throwIfAborted();
    if (savePreferences) {
        try {
            await cliUpdatePreferences({ checkAutomatically: allowed, installAutomatically }, directory, signal);
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            process.stderr.write('Could not save update preferences. Update checks are off. Check storage permissions and try again.\n');
            return;
        }
    }
    if (!allowed || signal.aborted) {
        return;
    }
    await check(undefined, undefined, signal);
}
