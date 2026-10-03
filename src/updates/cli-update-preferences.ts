import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import syncDirectory from '../system/sync-directory.js';
import dataDirectory from '../system/data-directory.js';

export type CliUpdatePreferences = { checkAutomatically: boolean | null; installAutomatically: boolean | null };

export default async function cliUpdatePreferences(preferences?: CliUpdatePreferences, directory = dataDirectory(), signal?: AbortSignal, scope: 'cli' | 'engine' = 'cli'): Promise<CliUpdatePreferences | null> {
    var filename = scope + '-updates.json';
    var path = join(directory, filename);
    if (!preferences) {
        try {
            var stored: unknown = JSON.parse(await readFile(path, 'utf8'));
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return null;
            }
            throw new Error('Could not read ' + filename + '. Check the file and try again.');
        }
    } else {
        stored = preferences;
    }
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
    if (preferences) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if ((await lstat(directory)).isSymbolicLink()) {
            throw new Error('Update storage must not be a symbolic link.');
        }
        var temporary = await mkdtemp(join(directory, '.cli-preferences-'));
        try {
            var temporaryPath = join(temporary, filename);
            var file = await open(temporaryPath, 'wx', 0o600);
            try {
                await file.writeFile(JSON.stringify({ checkAutomatically: allowed, installAutomatically }, null, 2) + '\n');
                await file.sync();
            } finally {
                await file.close();
            }
            signal?.throwIfAborted();
            await rename(temporaryPath, path);
            await syncDirectory(directory);
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    }
    return { checkAutomatically: allowed, installAutomatically };
}
