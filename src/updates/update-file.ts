import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { MAX_BINARY_BYTES } from './update-contract.js';

export default async function updateFile(source: string, destination?: string, mode?: number): Promise<string> {
    var file = await lstat(source);
    if (!file.isFile() || file.size < 1 || file.size > MAX_BINARY_BYTES) { throw new Error('Invalid update executable.'); }
    var hash = createHash('sha256');
    var output;
    var permissions = mode ?? (file.mode & 0o777);
    if (destination) {
        output = await open(destination, 'wx', permissions);
    }
    try {
        for await (var bytes of createReadStream(source)) {
            hash.update(bytes);
            if (output) {
                await output.writeFile(bytes);
            }
        }
        if (output) {
            await output.chmod(permissions);
            await output.sync();
        }
    } finally {
        await output?.close();
    }
    return hash.digest('hex');
}
