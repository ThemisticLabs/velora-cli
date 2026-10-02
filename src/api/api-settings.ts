import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';

export var DEFAULT_API_PORT = 8001;
export var MAX_API_PORT = 65535;

export default async function apiSettings(port?: number, directory = dataDirectory()): Promise<{ port: number }> {
    var path = join(directory, 'api.json');
    var saving = port !== undefined;
    if (port === undefined) {
        try {
            var stored: unknown = JSON.parse(await readFile(path, 'utf8'));
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return { port: DEFAULT_API_PORT };
            }
            throw new Error('Could not read API settings. Check api.json and try again.');
        }
        if (typeof stored !== 'object' || stored === null || !('port' in stored) || typeof stored.port !== 'number') {
            throw new Error('Invalid API settings. Check the port in api.json.');
        }
        port = stored.port;
    }
    if (!Number.isInteger(port) || port < 1 || port > MAX_API_PORT) {
        throw new Error('Choose a port from 1 to ' + MAX_API_PORT + '.');
    }
    if (!saving) {
        return { port };
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) {
        throw new Error('API settings storage must not be a symbolic link.');
    }
    var temporary = await mkdtemp(join(directory, '.api-settings-'));
    try {
        var temporaryPath = join(temporary, 'api.json');
        await writeFile(temporaryPath, JSON.stringify({ port }) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, path);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
    return { port };
}
