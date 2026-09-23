import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, mkdtemp, writeFile, link, rm } from 'node:fs/promises';

export default async function deviceFingerprint() {
    var HARDWARE_TIMEOUT_MS = 5000;
    var RANDOM_ID_BYTES = 32;
    try {
        if (process.platform === 'darwin') {
            var result = await promisify(execFile)('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: HARDWARE_TIMEOUT_MS });
            var match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(result.stdout);
            if (match) {
                return { hw: createHash('sha256').update(match[1]!).digest('hex') };
            }
        } else {
            var machineId = (await readFile('/etc/machine-id', 'utf8')).trim();
            if (machineId) {
                return { hw: createHash('sha256').update(machineId).digest('hex') };
            }
        }
    } catch {
        // Match the engine's persisted fallback when hardware identification is unavailable.
    }
    var directory = join(homedir(), '.config', 'lizenz-client');
    var path = join(directory, 'geräte_id');
    try {
        var saved = (await readFile(path, 'utf8')).trim();
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
        }
        await mkdir(directory, { recursive: true, mode: 0o700 });
        var temporary = await mkdtemp(join(directory, '.velora-id-'));
        try {
            var candidate = join(temporary, 'id');
            await writeFile(candidate, randomBytes(RANDOM_ID_BYTES).toString('hex'), { mode: 0o600 });
            try {
                await link(candidate, path);
            } catch (error) {
                if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
                    throw error;
                }
            }
            saved = (await readFile(path, 'utf8')).trim();
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    }
    if (!saved) {
        throw new Error('The saved device ID is empty. Restore it before downloading.');
    }
    return { hw: createHash('sha256').update(saved).digest('hex') };
}
