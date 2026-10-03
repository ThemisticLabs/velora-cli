import cliUpdatePreferences from './cli-update-preferences.js';
import dataDirectory from '../system/data-directory.js';
import selectOption from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';
import cliUpdate from './cli-update.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import installCliUpdate from './install-cli-update.js';

export default async function startupUpdate(signal: AbortSignal, directory = dataDirectory(), choose = selectOption, check = cliUpdate, install = installCliUpdate): Promise<boolean | void> {
    try {
        var preferences = await cliUpdatePreferences(undefined, directory);
    } catch {
        process.stderr.write(style('Could not read cli-updates.json. Update checks are off. Check the file and try again.', 'Warning') + '\n');
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
                setSetupLayout('velora updates', 'Check GitHub for new versions of velora.', '/velora/updates', '↑/↓ Move · Enter Select · Ctrl+C Cancel');
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
                setSetupLayout('Automatic velora updates', 'Install verified velora releases automatically. Your saved data stays in place.', '/velora/updates', '↑/↓ Move · Enter Select · Ctrl+C Cancel');
                var installation = await choose({
                    message: 'Allow automatic velora updates?',
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
            process.stderr.write(style('Could not save update preferences. Update checks are off. Check storage permissions and try again.', 'Warning') + '\n');
            return;
        }
    }
    if (!allowed || signal.aborted) {
        return;
    }
    var version = await check(undefined, undefined, signal);
    if (!version || !installAutomatically) { return; }
    var releaseVersion = version;
    try {
        if (install === installCliUpdate && process.stdout.isTTY) {
            process.stdout.write('\u001b[?1049h');
            try {
                setSetupLayout('Updating velora…', '', '/velora/updates', 'Ctrl+C Cancel');
                await runTerminalTask(function (taskSignal, progress) { return install(releaseVersion, AbortSignal.any([signal, taskSignal]), progress); });
            } finally { process.stdout.write('\u001b[?25h\u001b[?1049l'); }
        } else { await install(version, signal); }
        return true;
    } catch (error) {
        if (signal.aborted || error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { throw error; }
        process.stdout.write(style('Could not install the velora update. Your current version was kept. Check Settings / Updates.', 'Warning') + '\n');
    }
}
