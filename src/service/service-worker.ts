import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import directoryLock from '../system/directory-lock.js';
import syncDirectory from '../system/sync-directory.js';
import servicePaths, { CONTROL_TOKEN_BYTES, CONTROL_TIMEOUT_MS, MAX_CONTROL_BYTES } from './service-paths.js';

export default async function serviceWorker(directory: string): Promise<void> {
    var paths = servicePaths(directory);
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(paths.directory)).isDirectory()) {
        throw new Error('Service storage must be a directory, not a link.');
    }
    var lease = await directoryLock({ operation: 'acquire', path: paths.lock });
    var token = randomBytes(CONTROL_TOKEN_BYTES).toString('base64url');
    var sockets = new Set<Socket>();
    var stopping = false;
    var stopSocket: Socket | undefined;
    var finish: () => void;
    var stopped = new Promise<void>(function (resolve) { finish = resolve; });
    var stop = function () {
        stopping = true;
        finish();
    };
    var server = createServer(function (socket) {
        sockets.add(socket);
        socket.setTimeout(CONTROL_TIMEOUT_MS, function () { socket.destroy(); });
        socket.on('error', function () {});
        socket.once('close', function () { sockets.delete(socket); });
        var received = Buffer.alloc(0);
        var answered = false;
        socket.on('data', function (chunk: Buffer) {
            if (answered) { return; }
            received = Buffer.concat([received, chunk]);
            if (received.length > MAX_CONTROL_BYTES) {
                socket.destroy();
                return;
            }
            var end = received.indexOf('\n');
            if (end === -1) { return; }
            answered = true;
            try {
                var request: unknown = JSON.parse(received.subarray(0, end).toString('utf8'));
                if (!request || typeof request !== 'object' || !('token' in request) || typeof request.token !== 'string' ||
                    request.token.length !== token.length || !timingSafeEqual(Buffer.from(request.token), Buffer.from(token)) ||
                    !('operation' in request) || !['status', 'stop'].includes(String(request.operation)) || stopping) {
                    socket.destroy();
                    return;
                }
                if (request.operation === 'stop') {
                    socket.setTimeout(0);
                    stopSocket = socket;
                    stop();
                    return;
                }
                socket.end(JSON.stringify({ state: 'running', pid: process.pid }) + '\n');
            } catch {
                socket.destroy();
            }
        });
    });
    var published = false;
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
        if (process.platform !== 'win32') {
            await mkdir(paths.runtime, { recursive: true, mode: 0o700 });
            var runtime = await lstat(paths.runtime);
            if (!runtime.isDirectory() || runtime.uid !== process.getuid?.() || (runtime.mode & 0o077) !== 0) {
                throw new Error('The private service socket directory is unavailable.');
            }
            try {
                var previous = await lstat(paths.endpoint);
                if (!previous.isSocket()) {
                    throw new Error('An unrelated file occupies the service socket path.');
                }
                await rm(paths.endpoint);
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; }
            }
        }
        await new Promise<void>(function (resolve, reject) {
            server.once('error', reject);
            server.listen(paths.endpoint, function () {
                server.removeListener('error', reject);
                resolve();
            });
        });
        server.on('error', stop);
        if (process.platform !== 'win32') {
            await chmod(paths.endpoint, 0o600);
        }
        var temporary = await mkdtemp(join(paths.directory, '.service-'));
        try {
            var output = await open(join(temporary, 'record'), 'wx', 0o600);
            try {
                await output.writeFile(JSON.stringify({ pid: process.pid, token }) + '\n');
                await output.sync();
            } finally {
                await output.close();
            }
            await rename(join(temporary, 'record'), paths.record);
            published = true;
            await syncDirectory(paths.directory);
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
        await stopped;
    } finally {
        process.removeListener('SIGTERM', stop);
        process.removeListener('SIGINT', stop);
        var closed = new Promise<void>(function (resolve) {
            server.close(function () { resolve(); });
        });
        for (var socket of sockets) {
            if (socket !== stopSocket) { socket.destroy(); }
        }
        try {
            if (published) {
                await rm(paths.record, { force: true });
                await syncDirectory(paths.directory);
            }
        } finally {
            await directoryLock({ operation: 'release', path: paths.lock, lease });
            stopSocket?.end(JSON.stringify({ state: 'stopped' }) + '\n');
            await closed;
        }
    }
}
