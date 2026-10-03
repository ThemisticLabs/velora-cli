import { lstat, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, isAbsolute, basename } from 'node:path';
import syncDirectory from '../system/sync-directory.js';
import { MAX_UPDATE_STATE_BYTES, UPDATE_STATE_SUFFIX, UPDATE_WORKSPACE_PREFIX } from './update-contract.js';

export type UpdateState = {
    phase: 'prepared' | 'installing' | 'installed' | 'restored' | 'failed';
    workdir: string; version: string; previousVersion: string; previousHash: string;
    nextHash: string; target: string; dataDirectory: string; parentPid: number; workerPid: number;
    lockToken?: string;
};

export default async function updateState(target: string, value?: UpdateState): Promise<UpdateState | null> {
    var path = target + UPDATE_STATE_SUFFIX;
    if (!value) {
        try {
            var file = await lstat(path);
            if (!file.isFile() || file.size > MAX_UPDATE_STATE_BYTES) { throw new Error('Invalid update state.'); }
            var stored: unknown = JSON.parse(await readFile(path, 'utf8'));
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null; }
            throw new Error('Could not read update recovery information. Keep the update backup and check file permissions.');
        }
        if (!stored || typeof stored !== 'object' || !('target' in stored) || stored.target !== target ||
            !('phase' in stored) || !['prepared', 'installing', 'installed', 'restored', 'failed'].includes(String(stored.phase)) ||
            !('workdir' in stored) || typeof stored.workdir !== 'string' || !isAbsolute(stored.workdir) || dirname(stored.workdir) !== dirname(target) || !basename(stored.workdir).startsWith(UPDATE_WORKSPACE_PREFIX) ||
            !('version' in stored) || typeof stored.version !== 'string' || !('previousVersion' in stored) || typeof stored.previousVersion !== 'string' ||
            !('previousHash' in stored) || typeof stored.previousHash !== 'string' || !/^[a-f0-9]{64}$/.test(stored.previousHash) ||
            !('nextHash' in stored) || typeof stored.nextHash !== 'string' || !/^[a-f0-9]{64}$/.test(stored.nextHash) ||
            !('dataDirectory' in stored) || typeof stored.dataDirectory !== 'string' || !isAbsolute(stored.dataDirectory) ||
            !('parentPid' in stored) || !Number.isSafeInteger(stored.parentPid) || Number(stored.parentPid) < 1 ||
            !('workerPid' in stored) || !Number.isSafeInteger(stored.workerPid) || Number(stored.workerPid) < 0 ||
            'lockToken' in stored && (typeof stored.lockToken !== 'string' || !/^[a-f0-9-]{36}$/.test(stored.lockToken))) {
            throw new Error('Invalid update recovery information. Your executable was kept.');
        }
        return stored as UpdateState;
    }
    var directory = dirname(target);
    var temporary = await mkdtemp(join(directory, '.velora-state-'));
    try {
        var output = await open(join(temporary, 'state'), 'wx', 0o600);
        try {
            await output.writeFile(JSON.stringify(value) + '\n');
            await output.sync();
        } finally {
            await output.close();
        }
        await rename(join(temporary, 'state'), path);
        await syncDirectory(directory);
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return value;
}
