import cliUpdatePreferences from './cli-update-preferences.js';
import dataDirectory from '../system/data-directory.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';
import cliUpdate from './cli-update.js';
import runTerminalTask from '../terminal/run-terminal-task.js';
import installCliUpdate from './install-cli-update.js';

export default async function startupUpdate(signal: AbortSignal, directory = dataDirectory(), check = cliUpdate, install = installCliUpdate): Promise<boolean | void> {
    try {
        var preferences = await cliUpdatePreferences(undefined, directory);
    } catch {
        process.stderr.write(style('Could not read cli-updates.json. Update checks are off. Check the file and try again.', 'Warning') + '\n');
        return;
    }
    signal.throwIfAborted();
    var allowed = preferences?.checkAutomatically === true;
    var installAutomatically = preferences?.installAutomatically === true;
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
