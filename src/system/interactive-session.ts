import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import dataDirectory from './data-directory.js';
import directoryLock from './directory-lock.js';
import navigation from '../terminal/interactive-navigation.js';

export type InteractiveTarget = { application: 'Ghostty' | 'Terminal'; id: string };

export default async function interactiveSession(operation: 'register' | 'open' | 'settings' | 'quit', directory = dataDirectory()): Promise<{ close: () => Promise<void> } | InteractiveTarget | null> {
    if (process.platform !== 'darwin') { return null; }
    var directoryId = createHash('sha256').update(directory).digest('hex').slice(0, 16);
    var endpoint = '/tmp/velora-interactive-' + process.getuid!() + '-' + directoryId + '.sock';
    var recordPath = join(directory, 'interactive-session.json');
    var SESSION_TIMEOUT_MS = 2000;
    if (operation !== 'register') {
        try {
            var record = JSON.parse(await readFile(recordPath, 'utf8'));
            if (typeof record.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.token)) { throw new Error('Invalid interactive session information.'); }
            var response = await fetch('http://localhost/' + operation, { unix: endpoint,
                headers: { authorization: 'Bearer ' + record.token }, signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) });
            if (!response.ok) { throw new Error('The existing session rejected the request.'); }
            var target = await response.json() as InteractiveTarget;
            if (!['Ghostty', 'Terminal'].includes(target.application) || typeof target.id !== 'string' || !target.id) { throw new Error('Invalid interactive terminal target.'); }
            return target;
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'FailedToOpenSocket') {
                // Bun hides the Unix socket error; recover it before treating a session as stale.
                try {
                    await new Promise<void>(function (resolve, reject) {
                        var socket = createConnection(endpoint);
                        socket.setTimeout(SESSION_TIMEOUT_MS, function () { socket.destroy(new Error('The interactive session did not respond.')); });
                        socket.once('error', reject);
                        socket.once('connect', function () { socket.destroy(); resolve(); });
                    });
                } catch (connectionError) {
                    error = connectionError;
                }
            }
            if (error instanceof Error && 'code' in error && ['ENOENT', 'ECONNREFUSED'].includes(String(error.code))) { return null; }
            if (error instanceof Error && 'code' in error && error.code === 'ENOTDIR') { return null; }
            throw new Error('The existing velora session did not respond. Check its terminal before opening another session.');
        }
    }
    if (!['ghostty', 'Apple_Terminal'].includes(process.env.TERM_PROGRAM || '')) { return null; }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    var lockPath = join(directory, '.interactive.lock');
    try { var lease = await directoryLock({ operation: 'acquire', path: lockPath }); }
    catch { return null; }
    var marker = 'velora-' + randomBytes(12).toString('hex');
    var application = 'Ghostty';
    var script = `function run(){var app=Application('Ghostty'); for(var terminal of app.terminals()){if(terminal.name()===${JSON.stringify(marker)}){return terminal.id();}} return '';}`;
    if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
        application = 'Terminal';
        script = `function run(){var app=Application('Terminal'); for(var window of app.windows()){for(var tab of window.tabs()){if(tab.name().includes(${JSON.stringify(marker)})){return tab.tty();}}}return '';}`;
    }
    process.stdout.write('\u001b]0;' + marker + '\u0007');
    try {
        var CAPTURE_DELAY_MS = 150;
        await Bun.sleep(CAPTURE_DELAY_MS);
        var capture = Bun.spawn(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], { stdout: 'pipe', stderr: 'ignore' });
        var id = (await new Response(capture.stdout).text()).trim();
        await capture.exited;
    } catch (error) {
        await directoryLock({ operation: 'release', path: lockPath, lease });
        throw error;
    } finally {
        process.stdout.write('\u001b]0;velora\u0007');
    }
    if (!id) {
        await directoryLock({ operation: 'release', path: lockPath, lease });
        return null;
    }
    var token = randomBytes(32).toString('base64url');
    try {
        await unlink(endpoint).catch(function (error) { if (error.code !== 'ENOENT') { throw error; } });
        var server = Bun.serve({ unix: endpoint, fetch: function (request) {
            if (request.headers.get('authorization') !== 'Bearer ' + token) { return new Response(null, { status: 403 }); }
            var path = new URL(request.url).pathname;
            if (!['/open', '/settings', '/quit'].includes(path)) { return new Response(null, { status: 404 }); }
            if (path === '/quit') {
                navigation.quit = true;
                navigation.controller.abort();
            }
            if (path === '/settings') {
                navigation.settings = true;
                navigation.controller.abort();
            }
            return Response.json({ application, id });
        } });
    } catch (error) {
        await directoryLock({ operation: 'release', path: lockPath, lease });
        throw error;
    }
    var temporary = recordPath + '.' + token + '.tmp';
    try {
        await chmod(endpoint, 0o600);
        await writeFile(temporary, JSON.stringify({ token }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, recordPath);
    } catch (error) {
        await server.stop(true);
        await unlink(temporary).catch(function () {});
        await directoryLock({ operation: 'release', path: lockPath, lease });
        throw error;
    }
    return { close: async function () {
        await server.stop(true);
        await unlink(recordPath).catch(function () {});
        await directoryLock({ operation: 'release', path: lockPath, lease });
    } };
}
