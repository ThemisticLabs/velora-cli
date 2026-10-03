import { open } from 'node:fs/promises';

export default async function syncDirectory(path: string): Promise<void> {
    if (process.platform === 'win32') { return; }
    var directory = await open(path, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
}
