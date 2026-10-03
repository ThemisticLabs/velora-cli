import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';
import syncDirectory from '../system/sync-directory.js';

export var INTRO_STEPS = 4;

export default async function setupProgress(step?: number, directory = dataDirectory()): Promise<number> {
    var path = join(directory, 'setup.json');
    var saving = step !== undefined;
    if (step === undefined) {
        try {
            var file = await lstat(path);
            var MAX_PROGRESS_BYTES = 1024;
            if (!file.isFile() || file.size > MAX_PROGRESS_BYTES) { throw new Error('Invalid setup progress.'); }
            var stored: unknown = JSON.parse(await readFile(path, 'utf8'));
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return 0; }
            throw new Error('Could not read setup.json. Check the file and storage access.');
        }
        if (!stored || typeof stored !== 'object' || !('step' in stored) || typeof stored.step !== 'number') {
            throw new Error('Invalid setup progress. Check setup.json.');
        }
        step = stored.step;
    }
    if (!Number.isInteger(step) || step < 0 || step > INTRO_STEPS) { throw new Error('Invalid setup step.'); }
    if (!saving) { return step; }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) { throw new Error('Setup storage must not be a symbolic link.'); }
    var temporary = await mkdtemp(join(directory, '.setup-'));
    try {
        var output = await open(join(temporary, 'setup.json'), 'wx', 0o600);
        try {
            await output.writeFile(JSON.stringify({ step }) + '\n');
            await output.sync();
        } finally {
            await output.close();
        }
        await rename(join(temporary, 'setup.json'), path);
        await syncDirectory(directory);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
    return step;
}
