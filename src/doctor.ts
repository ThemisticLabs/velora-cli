import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, release } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import style from './style.js';

type Check = {
    name: string;
    status: 'Info' | 'Waiting' | 'Checking' | 'OK' | 'Action';
    detail: string;
};

export default async function doctor(transport = fetch, dataDirectory?: string): Promise<void> {
    var REQUEST_TIMEOUT_MS = 8000;
    var ENTER_SCREEN = '\u001b[?1049h\u001b[?25l';
    var LEAVE_SCREEN = '\u001b[?25h\u001b[?1049l';
    var interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    var controller = new AbortController();
    var cancel = function () {
        controller.abort();
    };
    var systemCheck: Check = {
        name: 'System', status: 'Info', detail: process.platform + ' ' + release() + ' · ' + process.arch
    };
    var commandCheck: Check = {
        name: 'Global command', status: 'Checking', detail: 'Looking for velora in PATH.'
    };
    var storageCheck: Check = {
        name: 'Storage', status: 'Waiting', detail: 'Checking the default data location next.'
    };
    var serverCheck: Check = {
        name: 'License server', status: 'Waiting', detail: 'No license key will be sent.'
    };
    var checks = [systemCheck, commandCheck, storageCheck, serverCheck];
    process.on('SIGINT', cancel);
    if (interactive) {
        process.stdout.write(ENTER_SCREEN);
    }
    try {
        render(checks, 'progress');
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
        commandCheck.status = 'Action';
        commandCheck.detail = 'Not found in an absolute PATH directory. Add the folder containing velora to PATH. For this source checkout, run bun run build, then bun link.';
        if (commandPath) {
            commandCheck.status = 'OK';
            commandCheck.detail = commandPath;
        }
        if (controller.signal.aborted) {
            return;
        }

        if (dataDirectory === undefined) {
            var userDirectory = homedir();
            switch (process.platform) {
                case 'darwin':
                    dataDirectory = join(userDirectory, 'Library', 'Application Support', 'velora');
                    break;
                case 'win32':
                    var localData = process.env.LOCALAPPDATA;
                    if (!localData || !isAbsolute(localData)) {
                        localData = join(userDirectory, 'AppData', 'Local');
                    }
                    dataDirectory = join(localData, 'velora');
                    break;
                default:
                    var xdgData = process.env.XDG_DATA_HOME;
                    if (!xdgData || !isAbsolute(xdgData)) {
                        xdgData = join(userDirectory, '.local', 'share');
                    }
                    dataDirectory = join(xdgData, 'velora');
            }
        }
        storageCheck.status = 'Checking';
        storageCheck.detail = dataDirectory;
        render(checks, 'progress');
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
                    storageCheck.status = 'Action';
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
            if (storageCheck.status === 'Action') {
                failure += ' ' + storageCheck.detail;
            }
            storageCheck.status = 'Action';
            storageCheck.detail = failure;
        }
        if (controller.signal.aborted) {
            return;
        }

        serverCheck.status = 'Checking';
        serverCheck.detail = 'Connecting to api.themistic.com.';
        render(checks, 'progress');
        try {
            var response = await transport('https://api.themistic.com/v1/license/check', {
                method: 'GET',
                redirect: 'error',
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            });
            await response.body?.cancel();
            serverCheck.status = 'Action';
            serverCheck.detail = 'Server returned HTTP ' + response.status + '. Try velora doctor again shortly.';
            if (response.ok) {
                serverCheck.status = 'OK';
                serverCheck.detail = 'Reachable over HTTPS · HTTP ' + response.status + ' · No license checked';
            }
        } catch {
            serverCheck.status = 'Action';
            serverCheck.detail = 'Connection failed or timed out. Check your connection, then run velora doctor again.';
        }
    } finally {
        process.off('SIGINT', cancel);
        if (interactive) {
            process.stdout.write(LEAVE_SCREEN);
        }
        if (controller.signal.aborted) {
            process.stdout.write('velora  Check cancelled.\n');
        } else {
            render(checks, 'report');
        }
    }
}

function render(checks: Check[], mode: 'progress' | 'report'): void {
    if (mode === 'progress' && (!process.stdout.isTTY || !process.stdin.isTTY)) {
        return;
    }
    var MAX_WIDTH = 76;
    var STATUS_COLUMN_WIDTH = 9;
    var CLEAR_SCREEN = '\u001b[H\u001b[2J';
    var width = Math.max(1, Math.min(MAX_WIDTH, (process.stdout.columns || MAX_WIDTH) - 1));
    var separator = style('─'.repeat(width), 'divider');
    var output = style('velora', 'accent') + '  ' + style('doctor', 'strong') + '  ' + packageInfo.version + '\n';
    output += separator + '\n';
    for (var check of checks) {
        output += '\n' + style(check.status.padEnd(STATUS_COLUMN_WIDTH), 'accent') + style(check.name, 'strong') + '\n';
        output += check.detail.replace(/[\x00-\x1f\x7f-\x9f]/g, '') + '\n';
    }
    output += '\n' + separator + '\n';
    if (mode === 'report') {
        output += 'These checks do not verify engine or model readiness.\n';
    } else {
        output += 'Ctrl+C Cancel\n';
        output = CLEAR_SCREEN + output;
    }
    process.stdout.write(output);
}
