import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';
import selectOption from '../setup/select-option.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import cliUpdate from './cli-update.js';

export default async function startupUpdate(signal: AbortSignal, directory = dataDirectory(), choose = selectOption, check = cliUpdate): Promise<void> {
    var path = join(directory, 'cli-updates.json');
    var firstLaunch = false;
    var savePreferences = false;
    try {
        var stored: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (typeof stored !== 'object' || stored === null || !('checkAutomatically' in stored) ||
            stored.checkAutomatically !== null && typeof stored.checkAutomatically !== 'boolean') {
            throw new Error('Invalid update preferences.');
        }
        var allowed = stored.checkAutomatically;
        var installAutomatically: boolean | null = null;
        if ('installAutomatically' in stored) {
            if (stored.installAutomatically !== null && typeof stored.installAutomatically !== 'boolean') {
                throw new Error('Invalid installation preference.');
            }
            installAutomatically = stored.installAutomatically;
        }
        if (installAutomatically === true && allowed !== true) {
            throw new Error('Automatic installation requires update checks.');
        }
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            process.stderr.write('Could not read cli-updates.json. Update checks are off. Check the file and try again.\n');
            return;
        }
        allowed = null;
        installAutomatically = null;
        firstLaunch = true;
        savePreferences = true;
    }
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
            await mkdir(directory, { recursive: true, mode: 0o700 });
            if ((await lstat(directory)).isSymbolicLink()) {
                throw new Error('Update storage must not be a symbolic link.');
            }
            var temporary = await mkdtemp(join(directory, '.cli-preferences-'));
            try {
                var temporaryPath = join(temporary, 'cli-updates.json');
                var file = await open(temporaryPath, 'wx', 0o600);
                try {
                    await file.writeFile(JSON.stringify({ checkAutomatically: allowed, installAutomatically }, null, 2) + '\n');
                    await file.sync();
                } finally {
                    await file.close();
                }
                signal.throwIfAborted();
                await rename(temporaryPath, path);
            } finally {
                await rm(temporary, { recursive: true, force: true });
            }
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
