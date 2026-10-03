import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export var CONTROL_TOKEN_BYTES = 32;
export var MAX_CONTROL_BYTES = 4096;
export var STOP_TIMEOUT_MS = 35000;
export var CONTROL_TIMEOUT_MS = 5000;
export var LAUNCH_TIMEOUT_MS = 10000;
export var START_TIMEOUT_MS = 120000;

export default function servicePaths(directory: string): { directory: string; lock: string; record: string; runtime: string; endpoint: string } {
    directory = resolve(directory);
    var identity = createHash('sha256').update(directory).digest('hex').slice(0, 24);
    var runtime = join(tmpdir(), 'velora-' + identity);
    var endpoint = join(runtime, 'control.sock');
    if (process.platform === 'win32') {
        endpoint = '\\\\.\\pipe\\velora-' + identity;
    }
    return { directory, lock: join(directory, '.service.lock'), record: join(directory, 'service.json'), runtime, endpoint };
}
