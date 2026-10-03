import { randomUUID } from 'node:crypto';
import { link, lstat, mkdtemp, open, readFile, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import syncDirectory from './sync-directory.js';

export type DirectoryLease = { token: string; owner: string };
type Claim = { operation: 'acquire'; path: string; token?: string };
type Cleanup = { operation: 'release'; path: string; lease: DirectoryLease } | { operation: 'clean'; path: string };
type Owner = { name: string; token: string; running: boolean };

export default function directoryLock(action: Claim): Promise<DirectoryLease>;
export default function directoryLock(action: Cleanup): Promise<void>;
export default async function directoryLock(action: Claim | Cleanup): Promise<DirectoryLease | void> {
    if (action.operation !== 'acquire') {
        if (action.operation === 'release') {
            await unlink(join(action.path, action.lease.owner)).catch(function (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            });
        }
        var owners = await lockOwners(action.path);
        for (var owner of owners) {
            if (!owner.running) {
                await unlink(join(action.path, owner.name)).catch(function (error) {
                    if (error.code !== 'ENOENT') {
                        throw error;
                    }
                });
            }
        }
        try {
            await rmdir(action.path);
            await syncDirectory(dirname(action.path));
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code)))) {
                throw error;
            }
        }
        return;
    }
    var token = action.token || randomUUID();
    var ownerName = randomUUID() + '.json';
    var temporary = await mkdtemp(join(dirname(action.path), '.velora-owner-'));
    var published = false;
    try {
        var file = await open(join(temporary, ownerName), 'wx', 0o600);
        try {
            await file.writeFile(JSON.stringify({ token, pid: process.pid }) + '\n');
            await file.sync();
        } finally {
            await file.close();
        }
        await syncDirectory(temporary);
        if (action.token) {
            await lockOwners(action.path);
            await link(join(temporary, ownerName), join(action.path, ownerName));
            try {
                var owners = await lockOwners(action.path);
                for (var owner of owners) {
                    if (owner.token !== token) {
                        throw new Error('The storage lock belongs to another operation.');
                    }
                }
                await syncDirectory(action.path);
                published = true;
                return { token, owner: ownerName };
            } finally {
                if (!published) {
                    await unlink(join(action.path, ownerName)).catch(function (error) {
                        if (error.code !== 'ENOENT') {
                            throw error;
                        }
                    });
                }
            }
        }
        var CLAIM_ATTEMPTS = 3;
        for (var attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
            try {
                await rename(temporary, action.path);
                published = true;
                await syncDirectory(dirname(action.path));
                return { token, owner: ownerName };
            } catch (error) {
                if (published) {
                    await unlink(join(action.path, ownerName));
                    await rmdir(action.path).catch(function (cleanupError) {
                        if (cleanupError.code !== 'ENOENT' && cleanupError.code !== 'ENOTEMPTY' && cleanupError.code !== 'EEXIST') {
                            throw cleanupError;
                        }
                    });
                    throw error;
                }
                if (!(error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code)))) {
                    throw error;
                }
                var owners = await lockOwners(action.path);
                for (var owner of owners) {
                    if (owner.running) {
                        throw Object.assign(new Error('Another operation is using this storage. Wait for it to finish and try again.'), { code: 'EEXIST' });
                    }
                }
                for (var owner of owners) {
                    await unlink(join(action.path, owner.name)).catch(function (error) {
                        if (error.code !== 'ENOENT') {
                            throw error;
                        }
                    });
                }
                try {
                    await rmdir(action.path);
                } catch (error) {
                    if (!(error instanceof Error && 'code' in error && ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code)))) {
                        throw error;
                    }
                }
            }
        }
        throw Object.assign(new Error('Another operation acquired this storage. Try again.'), { code: 'EEXIST' });
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

async function lockOwners(path: string): Promise<Owner[]> {
    try {
        var directory = await lstat(path);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    if (!directory.isDirectory()) {
        throw new Error('An older or invalid lock file remains. Check that no velora process is running before removing it.');
    }
    var owners: Owner[] = [];
    var MAX_OWNER_BYTES = 1024;
    try {
        var names = await readdir(path);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    for (var name of names) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) {
            throw new Error('Storage lock information is unreadable.');
        }
        try {
            var file = await lstat(join(path, name));
            if (!file.isFile() || file.size > MAX_OWNER_BYTES) {
                throw new Error('Storage lock information is unreadable.');
            }
            var stored: unknown = JSON.parse(await readFile(join(path, name), 'utf8'));
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        if (!stored || typeof stored !== 'object' || !('token' in stored) || typeof stored.token !== 'string' || !/^[a-f0-9-]{36}$/.test(stored.token) ||
            !('pid' in stored) || typeof stored.pid !== 'number' || !Number.isSafeInteger(stored.pid) || stored.pid < 1) {
            throw new Error('Storage lock information is unreadable.');
        }
        var running = true;
        try {
            process.kill(stored.pid, 0);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                throw error;
            }
            running = false;
        }
        owners.push({ name, token: stored.token, running });
    }
    return owners;
}
