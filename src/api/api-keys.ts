import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import syncDirectory from '../system/sync-directory.js';
import dataDirectory from '../system/data-directory.js';
import directoryLock, { type DirectoryLease } from '../system/directory-lock.js';

export var MAX_KEY_NAME_LENGTH = 64;
export var MAX_KEY_NOTE_LENGTH = 256;
export type ApiKey = { id: string; name: string; note: string; createdAt: string };
type KeyRecord = ApiKey & { digest: string };
type Action = { operation: 'list' } | { operation: 'create'; name: string; note: string } |
    { operation: 'revoke'; id: string } | { operation: 'verify'; key: string };

export default async function apiKeys(action: Action, directory = dataDirectory()): Promise<{ keys: ApiKey[]; key?: string; authorized?: boolean }> {
    var mutating = action.operation === 'create' || action.operation === 'revoke';
    var MAX_STORE_BYTES = 1024 ** 2;
    if (action.operation === 'verify' && !/^velora_[A-Za-z0-9_-]{43}$/.test(action.key)) {
        return { keys: [], authorized: false };
    }
    if (action.operation === 'create' && (!action.name.trim() || action.name.trim().length > MAX_KEY_NAME_LENGTH || action.note.length > MAX_KEY_NOTE_LENGTH ||
        /[\x00-\x1f\x7f-\x9f]/.test(action.name + action.note))) {
        throw new Error('Use a name up to 64 characters and a note up to 256 characters.');
    }
    if (mutating) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    try {
        if (!(await lstat(directory)).isDirectory()) {
            throw new Error('API key storage must be a directory, not a link.');
        }
    } catch (error) {
        if (!mutating && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { keys: [], authorized: false };
        }
        throw error;
    }
    var path = join(directory, 'api-keys.json');
    var lockPath = join(directory, '.api-keys.lock');
    var lock: DirectoryLease | undefined;
    var committed = false;
    if (mutating) {
        lock = await directoryLock({ operation: 'acquire', path: lockPath });
    }
    try {
        var records: KeyRecord[] = [];
        var revision = -1;
        var unreadable = false;
        for (var candidate of [path, path + '.backup']) {
            try {
                var info = await lstat(candidate);
                if (!info.isFile() || info.size > MAX_STORE_BYTES) {
                    throw new Error('Invalid API key storage.');
                }
                var stored: unknown = JSON.parse(await readFile(candidate, 'utf8'));
                var candidateRevision = 0;
                if (stored && typeof stored === 'object' && !Array.isArray(stored) && 'schemaVersion' in stored && stored.schemaVersion === 1 &&
                    'revision' in stored && typeof stored.revision === 'number' && Number.isSafeInteger(stored.revision) && stored.revision >= 1 && 'keys' in stored) {
                    var checksum = createHash('sha256').update(JSON.stringify({ revision: stored.revision, keys: stored.keys })).digest('hex');
                    if (!('checksum' in stored) || stored.checksum !== checksum) {
                        throw new Error('API key storage checksum mismatch.');
                    }
                    candidateRevision = stored.revision;
                    stored = stored.keys;
                }
                if (!Array.isArray(stored)) {
                    throw new Error('Invalid API key storage.');
                }
                var candidateRecords: KeyRecord[] = [];
                var ids = new Set<string>();
                for (var storedRecord of stored) {
                    if (!storedRecord || typeof storedRecord !== 'object' || typeof storedRecord.id !== 'string' ||
                        !/^[a-f0-9-]{36}$/.test(storedRecord.id) || ids.has(storedRecord.id) ||
                        typeof storedRecord.name !== 'string' || !storedRecord.name.trim() || storedRecord.name.length > MAX_KEY_NAME_LENGTH ||
                        typeof storedRecord.note !== 'string' || storedRecord.note.length > MAX_KEY_NOTE_LENGTH ||
                        /[\x00-\x1f\x7f-\x9f]/.test(storedRecord.name + storedRecord.note) ||
                        typeof storedRecord.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(storedRecord.createdAt) ||
                        !Number.isFinite(Date.parse(storedRecord.createdAt)) ||
                        typeof storedRecord.digest !== 'string' || !/^[a-f0-9]{64}$/.test(storedRecord.digest)) {
                        throw new Error('Invalid API key storage.');
                    }
                    ids.add(storedRecord.id);
                    candidateRecords.push({ id: storedRecord.id, name: storedRecord.name, note: storedRecord.note,
                        createdAt: storedRecord.createdAt, digest: storedRecord.digest });
                }
                if (candidateRevision > revision) {
                    revision = candidateRevision;
                    records = candidateRecords;
                }
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                    unreadable = true;
                }
            }
        }
        if (revision === -1 && unreadable) {
            throw new Error('Could not read API keys or their backup. Restore a valid copy before changing keys.');
        }
        var result: { keys: ApiKey[]; key?: string; authorized?: boolean } = { keys: [] };
        if (action.operation === 'create') {
            var KEY_BYTES = 32;
            result.key = 'velora_' + randomBytes(KEY_BYTES).toString('base64url');
            records.push({ id: randomUUID(), name: action.name.trim(), note: action.note.trim(),
                createdAt: new Date().toISOString(), digest: createHash('sha256').update(result.key).digest('hex') });
        }
        if (action.operation === 'revoke') {
            var remaining: KeyRecord[] = [];
            var found = false;
            for (var record of records) {
                if (record.id === action.id) {
                    found = true;
                    continue;
                }
                remaining.push(record);
            }
            if (!found) {
                throw new Error('This API key no longer exists.');
            }
            records = remaining;
        }
        if (mutating) {
            var temporary = await mkdtemp(join(directory, '.api-keys-'));
            try {
                if (revision === Number.MAX_SAFE_INTEGER) {
                    throw new Error('API key storage revision cannot advance. Restore an earlier backup.');
                }
                var nextRevision = Math.max(0, revision) + 1;
                var checksum = createHash('sha256').update(JSON.stringify({ revision: nextRevision, keys: records })).digest('hex');
                var content = JSON.stringify({ schemaVersion: 1, revision: nextRevision, checksum, keys: records }) + '\n';
                if (Buffer.byteLength(content) > MAX_STORE_BYTES) {
                    throw new Error('API key storage is full. Revoke unused keys before adding another.');
                }
                for (var name of ['backup', 'primary']) {
                    var file = await open(join(temporary, name), 'wx', 0o600);
                    try {
                        await file.writeFile(content);
                        await file.sync();
                    } finally {
                        await file.close();
                    }
                }
                await rename(join(temporary, 'backup'), path + '.backup');
                await syncDirectory(directory);
                committed = true;
                // The synced backup commits the revision. Readers also accept it if the primary replacement fails.
                try {
                    await rename(join(temporary, 'primary'), path);
                    await syncDirectory(directory);
                } catch {}
            } finally {
                try {
                    await rm(temporary, { recursive: true, force: true });
                } catch (error) {
                    if (!committed) {
                        throw error;
                    }
                }
            }
        }
        if (action.operation === 'verify') {
            result.authorized = false;
            var digest = createHash('sha256').update(action.key).digest();
            for (var record of records) {
                if (timingSafeEqual(digest, Buffer.from(record.digest, 'hex'))) {
                    result.authorized = true;
                }
            }
        }
        for (var record of records) {
            result.keys.push({ id: record.id, name: record.name, note: record.note, createdAt: record.createdAt });
        }
        return result;
    } finally {
        if (lock) {
            try {
                await directoryLock({ operation: 'release', path: lockPath, lease: lock });
            } catch (error) {
                if (!committed) {
                    throw error;
                }
            }
        }
    }
}
