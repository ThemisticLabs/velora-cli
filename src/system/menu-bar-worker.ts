import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import directoryLock from './directory-lock.js';
import serviceControl from '../service/service-control.js';
import openInteractive from './open-interactive.js';
import interactiveSession from './interactive-session.js';
import logoPath from '../assets/logo.svg' with { type: 'file' };
import htmlPath from '../assets/menu-bar.markup' with { type: 'file' };
import nativePath from '../assets/menu-bar.jxa' with { type: 'file' };

export default async function menuBarWorker(directory: string, launch = spawn): Promise<void> {
    if (process.platform !== 'darwin') { return; }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    var lockPath = join(directory, '.menubar.lock');
    try {
        var lease = await directoryLock({ operation: 'acquire', path: lockPath });
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') { return; }
        throw error;
    }
    var readyPath = join(directory, 'menubar-ready.json');
    var statusPath = join(directory, 'menubar-status.json');
    var stop = new AbortController();
    var quit = function () { stop.abort(); };
    process.once('SIGTERM', quit);
    process.once('SIGINT', quit);
    var assets = await mkdtemp(join(directory, '.menubar-assets-'));
    try {
        await writeFile(join(assets, 'menu-bar.jxa'), await Bun.file(nativePath).text(), { mode: 0o600, flag: 'wx' });
        await writeFile(join(assets, 'menu-bar.html'), await Bun.file(htmlPath).text(), { mode: 0o600, flag: 'wx' });
        await writeFile(join(assets, 'logo.svg'), await Bun.file(logoPath).text(), { mode: 0o600, flag: 'wx' });
    } catch (error) {
        await rm(assets, { recursive: true, force: true });
        await directoryLock({ operation: 'release', path: lockPath, lease });
        throw error;
    }
    var child = launch('/usr/bin/osascript', ['-l', 'JavaScript', join(assets, 'menu-bar.jxa'), String(process.pid), statusPath, join(assets, 'menu-bar.html'), join(assets, 'logo.svg')], { stdio: ['ignore', 'pipe', 'pipe'] });
    var busy = false;
    var message = '';
    var action: Promise<void> | undefined;
    var nativeError = '';
    var MAX_NATIVE_ERROR_BYTES = 16384;
    child.stderr.on('data', function (chunk) { nativeError = (nativeError + chunk.toString()).slice(-MAX_NATIVE_ERROR_BYTES); });
    child.once('error', quit);
    child.once('close', quit);
    var lines = createInterface({ input: child.stdout });
    lines.on('line', function (command) {
        if (command === 'ready') {
            action = (async function () {
                await writeFile(join(assets, 'ready.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' });
                await rename(join(assets, 'ready.json'), readyPath);
            })();
            return;
        }
        if (!['service', 'open', 'settings', 'website', 'quit'].includes(command) || busy) { return; }
        busy = true;
        message = '';
        action = (async function () {
            try {
                if (command === 'quit') {
                    await serviceControl('stop', directory);
                    await interactiveSession('quit', directory);
                    stop.abort();
                    return;
                }
                if (command === 'website') {
                    var website = Bun.spawn(['/usr/bin/open', 'https://themistic.com'], { stdout: 'ignore', stderr: 'ignore' });
                    if (await website.exited !== 0) { throw new Error('Could not open Themistic in your browser.'); }
                    return;
                }
                if (command === 'open' || command === 'settings') {
                    await openInteractive(command, directory);
                    return;
                }
                var status = await serviceControl('status', directory);
                if (status.state === 'stopping') { return; }
                if (status.state === 'stopped') {
                    await serviceControl('start', directory);
                    return;
                }
                await serviceControl('stop', directory);
            } catch (error) {
                message = 'Could not complete this action. Open velora to check it.';
                if (error instanceof Error) { message = error.message; }
            } finally {
                busy = false;
            }
        })();
    });
    try {
        var STATUS_INTERVAL_MS = 500;
        while (!stop.signal.aborted) {
            var status: { state: string; message?: string; busy?: boolean };
            try { status = await serviceControl('status', directory, undefined, stop.signal); }
            catch { status = { state: 'failed', message: 'Could not read service status. Open velora to check it.' }; }
            if (message) { status.message = message; }
            status.busy = busy;
            await writeFile(join(assets, 'status.json'), JSON.stringify(status), { mode: 0o600, flag: 'wx' });
            await rename(join(assets, 'status.json'), statusPath);
            await Bun.sleep(STATUS_INTERVAL_MS);
        }
    } finally {
        child.kill();
        lines.close();
        await action;
        process.removeListener('SIGTERM', quit);
        process.removeListener('SIGINT', quit);
        await unlink(readyPath).catch(function () {});
        await unlink(statusPath).catch(function () {});
        await rm(assets, { recursive: true, force: true });
        await directoryLock({ operation: 'release', path: lockPath, lease });
    }
    if (nativeError) { throw new Error(nativeError); }
}
