import { lstat, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import servicePaths, { CONTROL_TIMEOUT_MS, MAX_CONTROL_BYTES, STOP_TIMEOUT_MS } from './service-paths.js';

export type ServiceStatus = { state: 'running'; pid: number; model: string; engineVersion: string } |
    { state: 'starting'; pid: number } | { state: 'failed'; pid: number; message: string } | { state: 'stopped' };

export default async function serviceRequest(operation: 'status' | 'stop', directory: string): Promise<ServiceStatus> {
    var paths = servicePaths(directory);
    try {
        var file = await lstat(paths.record);
        if (!file.isFile() || file.size > MAX_CONTROL_BYTES) {
            throw new Error('Invalid service control information.');
        }
        var record: unknown = JSON.parse(await readFile(paths.record, 'utf8'));
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { state: 'stopped' };
        }
        throw new Error('Could not read service control information. Check storage permissions.');
    }
    if (!record || typeof record !== 'object' || !('token' in record) || typeof record.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(record.token) || !('pid' in record) || typeof record.pid !== 'number' ||
        !Number.isSafeInteger(record.pid) || record.pid < 1) {
        throw new Error('Invalid service control information. Keep the service files and inspect them before restarting.');
    }
    var token = record.token;
    var pid = record.pid;
    try {
        return await new Promise<ServiceStatus>(function (resolve, reject) {
            var socket = createConnection(paths.endpoint);
            var received = Buffer.alloc(0);
            var timeout = CONTROL_TIMEOUT_MS;
            if (operation === 'stop') { timeout = STOP_TIMEOUT_MS; }
            var timer = setTimeout(function () {
                socket.destroy(new Error('The velora service did not respond. Try again.'));
            }, timeout);
            socket.on('error', reject);
            socket.once('close', function () {
                clearTimeout(timer);
                reject(new Error('The service connection closed before its response.'));
            });
            socket.once('connect', function () {
                socket.write(JSON.stringify({ operation, token }) + '\n');
            });
            socket.on('data', function (chunk: Buffer) {
                received = Buffer.concat([received, chunk]);
                if (received.length > MAX_CONTROL_BYTES) {
                    socket.destroy(new Error('Invalid service response.'));
                    return;
                }
                var end = received.indexOf('\n');
                if (end === -1) { return; }
                try {
                    var response: unknown = JSON.parse(received.subarray(0, end).toString('utf8'));
                    if (!response || typeof response !== 'object' || !('state' in response)) {
                        throw new Error('Invalid service response.');
                    }
                    if (response.state === 'stopped' && operation === 'stop') {
                        resolve({ state: 'stopped' });
                        return;
                    }
                    if (!('pid' in response) || response.pid !== pid) {
                        throw new Error('The service response does not match the running instance.');
                    }
                    if (response.state === 'starting') {
                        resolve({ state: 'starting', pid });
                        return;
                    }
                    if (response.state === 'failed' && 'message' in response && typeof response.message === 'string' &&
                        response.message.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(response.message)) {
                        resolve({ state: 'failed', pid, message: response.message });
                        return;
                    }
                    if (response.state === 'running' && 'model' in response && typeof response.model === 'string' &&
                        /^[a-z0-9_-]{2,64}$/.test(response.model) && 'engineVersion' in response && typeof response.engineVersion === 'string' &&
                        /^\d+\.\d+\.\d+$/.test(response.engineVersion)) {
                        resolve({ state: 'running', pid, model: response.model, engineVersion: response.engineVersion });
                        return;
                    }
                    throw new Error('Invalid service response.');
                } catch (error) {
                    reject(error);
                } finally {
                    socket.destroy();
                }
            });
        });
    } catch (error) {
        try {
            process.kill(pid, 0);
        } catch (processError) {
            if (processError instanceof Error && 'code' in processError && processError.code === 'ESRCH') {
                return { state: 'stopped' };
            }
        }
        throw new Error('Could not reach the velora service. It may still be running; do not start another instance blindly.');
    }
}
