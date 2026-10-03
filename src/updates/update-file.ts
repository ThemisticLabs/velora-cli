import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export default async function updateFile(source: string, destination?: string): Promise<string> {
    var file = await lstat(source);
    var MAX_BINARY_BYTES = 256 * 1024 ** 2;
    if (!file.isFile() || file.size < 1 || file.size > MAX_BINARY_BYTES) { throw new Error('Invalid update executable.'); }
    var hash = createHash('sha256');
    var output;
    if (destination) { output = await open(destination, 'wx', file.mode & 0o777 | 0o700); }
    try {
        for await (var bytes of createReadStream(source)) {
            hash.update(bytes);
            if (output) { await output.writeFile(bytes); }
        }
        if (output) { await output.sync(); }
    } finally { await output?.close(); }
    return hash.digest('hex');
}
