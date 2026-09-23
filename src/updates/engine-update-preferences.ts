import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';

export type EngineUpdatePreferences = { checkAutomatically: boolean; installAutomatically: boolean };

export default async function engineUpdatePreferences(modelId: string, preferences: EngineUpdatePreferences, directory = dataDirectory()): Promise<void> {
    if (!/^[a-z0-9_-]{2,64}$/.test(modelId) || typeof preferences.checkAutomatically !== 'boolean' ||
        typeof preferences.installAutomatically !== 'boolean' || preferences.installAutomatically && !preferences.checkAutomatically) {
        throw new Error('Invalid engine update preferences.');
    }
    var root = join(directory, 'models', modelId);
    for (var parent of [directory, join(directory, 'models'), root]) {
        await mkdir(parent, { recursive: true, mode: 0o700 });
        if ((await lstat(parent)).isSymbolicLink()) {
            throw new Error('Model storage directories must not be symbolic links.');
        }
    }
    var temporary = await mkdtemp(join(root, '.preferences-'));
    try {
        var path = join(temporary, 'engine-updates.json');
        var file = await open(path, 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify(preferences, null, 2) + '\n');
            await file.sync();
        } finally {
            await file.close();
        }
        await rename(path, join(root, 'engine-updates.json'));
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}
