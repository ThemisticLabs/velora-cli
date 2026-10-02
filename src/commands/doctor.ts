import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { release } from 'node:os';
import { createServer } from 'node:net';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { availableVersion } from '../updates/cli-update.js';
import defaultDataDirectory from '../system/data-directory.js';
import packageInfo from '../../package.json' with { type: 'json' };
import style from '../terminal/style.js';
import licenseStore from '../license/license-store.js';
import licenseAccess from '../license/license-access.js';
import engineSession from '../engine/engine-session.js';
import doctorEngine from './doctor-engine.js';
import installedModels from '../models/installed-models.js';
import apiSettings from '../api/api-settings.js';

export type DoctorCheck = {
    name: string;
    status: 'Info' | 'Waiting' | 'Checking' | 'OK' | 'Warning' | 'Error';
    detail: string;
};

export default async function doctor(transport = fetch, dataDirectory?: string, options: { signal?: AbortSignal; onProgress?: (checks: DoctorCheck[]) => void; store?: typeof licenseStore; checkLicense?: typeof licenseAccess; connect?: typeof engineSession; models?: typeof installedModels } = {}): Promise<void> {
    var REQUEST_TIMEOUT_MS = 8000;
    var ENTER_SCREEN = '\u001b[?1049h\u001b[?25l';
    var LEAVE_SCREEN = '\u001b[?25h\u001b[?1049l';
    var interactive = Boolean(!options.onProgress && process.stdout.isTTY && process.stdin.isTTY);
    var controller = new AbortController();
    var signal = controller.signal;
    if (options.signal) {
        signal = AbortSignal.any([signal, options.signal]);
    }
    var cancel = function () {
        controller.abort();
    };
    var systemCheck: DoctorCheck = {
        name: 'System', status: 'Info', detail: process.platform + ' ' + release() + ' · ' + process.arch
    };
    var commandCheck: DoctorCheck = {
        name: 'Global command', status: 'Checking', detail: 'Looking for velora in PATH.'
    };
    var storageCheck: DoctorCheck = {
        name: 'Storage', status: 'Waiting', detail: 'Checking the default data location next.'
    };
    var serverCheck: DoctorCheck = {
        name: 'License server', status: 'Waiting', detail: 'No license key will be sent.'
    };
    var portCheck: DoctorCheck = {
        name: 'Local API port', status: 'Waiting', detail: 'Checking the saved port next.'
    };
    var runtimeChecks: Parameters<typeof doctorEngine>[2] = {
        engine: { name: 'Engine', status: 'Waiting', detail: 'Verifying the installed engine next.' },
        license: { name: 'License', status: 'Waiting', detail: 'Checking the saved license next.' },
        model: { name: 'Selected model', status: 'Waiting', detail: 'Checking the selected model next.' },
        inference: { name: 'Inference', status: 'Waiting', detail: 'Testing local inference next.' }
    };
    var checks = [systemCheck, commandCheck, storageCheck, portCheck, serverCheck,
        runtimeChecks.engine, runtimeChecks.license, runtimeChecks.model, runtimeChecks.inference];
    process.on('SIGINT', cancel);
    if (interactive) {
        process.stdout.write(ENTER_SCREEN);
    }
    try {
        render(checks, 'progress', options.onProgress);
        var commandNames = ['velora'];
        if (process.platform === 'win32') {
            commandNames = ['velora.exe', 'velora.cmd', 'velora.bat', 'velora.com'];
        }
        var commandPath = '';
        for (var directory of (process.env.PATH || '').split(delimiter)) {
            if (!directory || !isAbsolute(directory)) {
                continue;
            }
            for (var name of commandNames) {
                var candidate = join(directory, name);
                try {
                    if (!(await stat(candidate)).isFile()) {
                        continue;
                    }
                    await access(candidate, constants.X_OK);
                    commandPath = candidate;
                    break;
                } catch {
                    continue;
                }
            }
            if (commandPath) {
                break;
            }
        }
        commandCheck.status = 'Warning';
        commandCheck.detail = 'Not found in an absolute PATH directory. Add the folder containing velora to PATH. For this source checkout, run bun run build, then bun link.';
        if (commandPath) {
            commandCheck.status = 'OK';
            commandCheck.detail = commandPath;
        }
        if (signal.aborted) {
            return;
        }

        if (dataDirectory === undefined) {
            dataDirectory = defaultDataDirectory();
        }
        storageCheck.status = 'Checking';
        storageCheck.detail = dataDirectory;
        render(checks, 'progress', options.onProgress);
        var storageOperation = 'inspect the storage path';
        try {
            var existingDirectory = dataDirectory;
            while (true) {
                try {
                    if (!(await stat(existingDirectory)).isDirectory()) {
                        throw Object.assign(new Error('Storage path is not a directory'), { code: 'ENOTDIR' });
                    }
                    break;
                } catch (error) {
                    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                        throw error;
                    }
                    existingDirectory = dirname(existingDirectory);
                }
            }
            storageOperation = 'create a test directory';
            var probeDirectory = await mkdtemp(join(existingDirectory, '.velora-doctor-'));
            try {
                storageOperation = 'write a test file';
                await writeFile(join(probeDirectory, 'write-check'), 'velora', { mode: 0o600, flag: 'wx' });
                storageCheck.status = 'OK';
                storageCheck.detail = dataDirectory + ' · Writable';
                if (existingDirectory !== dataDirectory) {
                    storageCheck.detail = dataDirectory + ' · Not created yet; parent is writable';
                }
            } finally {
                try {
                    await rm(probeDirectory, { recursive: true });
                } catch {
                    storageCheck.status = 'Error';
                    storageCheck.detail = 'Could not remove the test directory: ' + probeDirectory + '. Check its permissions and remove it manually.';
                }
            }
        } catch (error) {
            var errorCode = 'UNKNOWN';
            if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
                errorCode = error.code;
            }
            var hints: Record<string, string> = {
                ENOTDIR: 'A file occupies part of the storage path. Choose a directory or move the conflicting file.',
                EACCES: 'Check your write and search permissions for the storage directory and its parents.',
                EPERM: 'Check folder permissions and system access restrictions.',
                EROFS: 'The filesystem is read-only. Use a writable location.',
                ENOSPC: 'Free disk space, then run velora doctor again.'
            };
            var hint = 'Check the storage path and try again.';
            if (Object.hasOwn(hints, errorCode)) {
                hint = hints[errorCode]!;
            }
            var failure = 'Could not ' + storageOperation + ' for ' + dataDirectory + ' (' + errorCode + '). ' + hint;
            if (storageCheck.status === 'Error') {
                failure += ' ' + storageCheck.detail;
            }
            storageCheck.status = 'Error';
            storageCheck.detail = failure;
        }
        if (signal.aborted) {
            return;
        }

        portCheck.status = 'Checking';
        render(checks, 'progress', options.onProgress);
        var portFailure = 'Could not read API settings. Check api.json and storage access.';
        try {
            var settings = await apiSettings(undefined, dataDirectory);
            var address = 'http://127.0.0.1:' + settings.port;
            portCheck.detail = address;
            portFailure = 'Could not bind ' + address + '. Check system network permissions.';
            var probe = createServer(function (connection) { connection.destroy(); });
            try {
                await new Promise<void>(function (resolve, reject) {
                    probe.once('error', reject);
                    probe.listen({ host: '127.0.0.1', port: settings.port, exclusive: true }, resolve);
                });
                portCheck.status = 'OK';
                portCheck.detail = address + ' · Available now';
            } finally {
                if (probe.listening) {
                    await new Promise<void>(function (resolve, reject) {
                        probe.close(function (error) {
                            if (error) { reject(error); return; }
                            resolve();
                        });
                    });
                }
            }
        } catch (error) {
            portCheck.status = 'Error';
            if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
                portCheck.status = 'Warning';
                portCheck.detail += ' · Port is already in use. Choose another port in Settings.';
            } else {
                portCheck.detail = portFailure;
            }
        }
        if (signal.aborted) {
            return;
        }

        serverCheck.status = 'Checking';
        serverCheck.detail = 'Connecting to api.themistic.com.';
        render(checks, 'progress', options.onProgress);
        try {
            var response = await transport('https://api.themistic.com/license/health', {
                method: 'GET',
                redirect: 'error',
                signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            });
            await response.body?.cancel();
            serverCheck.status = 'Error';
            serverCheck.detail = 'Server returned HTTP ' + response.status + '. Try velora doctor again shortly.';
            if (response.ok) {
                serverCheck.status = 'OK';
                serverCheck.detail = 'Reachable over HTTPS · HTTP ' + response.status;
            }
        } catch {
            serverCheck.status = 'Error';
            serverCheck.detail = 'Connection failed or timed out. Check your connection, then run velora doctor again.';
        }
        if (signal.aborted) { return; }

        await doctorEngine(dataDirectory, signal, runtimeChecks, function () {
            render(checks, 'progress', options.onProgress);
        }, { store: options.store || licenseStore, checkLicense: options.checkLicense || licenseAccess,
            connect: options.connect || engineSession, models: options.models || installedModels });
    } finally {
        process.off('SIGINT', cancel);
        if (interactive) {
            process.stdout.write(LEAVE_SCREEN);
        }
        if (signal.aborted) {
            if (!options.onProgress) {
                process.stdout.write('velora  Check cancelled.\n');
            }
        } else {
            render(checks, 'report', options.onProgress);
        }
    }
}

function render(checks: DoctorCheck[], mode: 'progress' | 'report', onProgress?: (checks: DoctorCheck[]) => void): void {
    if (onProgress) {
        onProgress(checks);
        return;
    }
    if (mode === 'progress' && (!process.stdout.isTTY || !process.stdin.isTTY)) {
        return;
    }
    var MAX_WIDTH = 76;
    var STATUS_COLUMN_WIDTH = 9;
    var CLEAR_SCREEN = '\u001b[H\u001b[2J';
    var width = Math.max(1, Math.min(MAX_WIDTH, (process.stdout.columns || MAX_WIDTH) - 1));
    var separator = style('─'.repeat(width), 'divider');
    var output = style('velora', 'accent') + '  ' + style('doctor', 'strong') + '  ' + packageInfo.version + '\n';
    if (availableVersion) {
        output += style(('Update available: velora ' + availableVersion).slice(0, width), 'accent') + '\n';
    }
    output += separator + '\n';
    for (var check of checks) {
        output += '\n' + style(check.status.padEnd(STATUS_COLUMN_WIDTH), check.status) + style(check.name, 'strong') + '\n';
        output += check.detail.replace(/[\x00-\x1f\x7f-\x9f]/g, '') + '\n';
    }
    output += '\n' + separator + '\n';
    if (mode === 'progress') {
        output += 'Ctrl+C Cancel\n';
        output = CLEAR_SCREEN + output;
    }
    process.stdout.write(output);
}
