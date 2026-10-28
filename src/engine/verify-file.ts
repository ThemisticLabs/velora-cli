import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import DownloadError from '../downloads/download-error.js';

export default async function verifyFile(path: string, expected: { size: number; sha256: string }, signal: AbortSignal,
    onProgress?: (bytes: number) => void): Promise<void> {
    signal.throwIfAborted();
    var file = await lstat(path);
    if (!file.isFile() || file.size !== expected.size) {
        throw new DownloadError('A package file is missing, linked or has changed. Download the engine again.');
    }
    var hash = createHash('sha256');
    var size = 0;
    var HASH_BUFFER_BYTES = 1024 ** 2;
    for await (var chunk of createReadStream(path, { signal, highWaterMark: HASH_BUFFER_BYTES })) {
        size += chunk.length;
        if (size > expected.size) {
            throw new DownloadError('A package file exceeds its expected size.');
        }
        hash.update(chunk);
        onProgress?.(size);
    }
    signal.throwIfAborted();
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) {
        throw new DownloadError('A package checksum does not match. Download the engine again.');
    }
}
