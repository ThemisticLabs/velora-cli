import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import apiKeys from '../api/api-keys.js';
import apiSettings from '../api/api-settings.js';
import cliUpdatePreferences from './cli-update-preferences.js';
import packageInfo from '../../package.json' with { type: 'json' };
import dataDirectory from '../system/data-directory.js';

export default async function selfTest(directory = dataDirectory()): Promise<void> {
    await apiKeys({ operation: 'list' }, directory);
    await apiSettings(undefined, directory);
    await cliUpdatePreferences(undefined, directory);
    await cliUpdatePreferences(undefined, directory, undefined, 'engine');
    try {
        var path = join(directory, 'selected-model.json');
        var file = await lstat(path);
        if (!file.isFile() || file.size > 1024 * 1024) { throw new Error('Model selection is unreadable.'); }
        var selection: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!selection || typeof selection !== 'object' || !('id' in selection) || typeof selection.id !== 'string') { throw new Error('Model selection is unreadable.'); }
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; }
    }
    process.stdout.write('velora self-test ' + packageInfo.version + '\n');
}
