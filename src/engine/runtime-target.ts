import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import DownloadError from '../downloads/download-error.js';

export default async function runtimeTarget(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (process.platform === 'win32' && process.arch === 'x64') {
        return 'win-amd64';
    }
    var PROBE_TIMEOUT_MS = 5000;
    var PROBE_OUTPUT_BYTES = 4096;
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        var result = await promisify(execFile)('/usr/bin/sw_vers', ['-productVersion'], {
            signal, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_OUTPUT_BYTES
        });
        var version = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(result.stdout.trim());
        if (version && Number(version[1]) >= 14) {
            return 'macosx-' + version[1] + '.' + version[2] + '-arm64';
        }
    }
    if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
        var result = await promisify(execFile)('getconf', ['GNU_LIBC_VERSION'], {
            signal, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_OUTPUT_BYTES
        });
        var version = /^glibc (\d+)\.(\d+)$/.exec(result.stdout.trim());
        if (version && (Number(version[1]) > 2 || Number(version[1]) === 2 && Number(version[2]) >= 38)) {
            var cpu = 'x86_64';
            if (process.arch === 'arm64') {
                cpu = 'aarch64';
            }
            return 'linux-' + cpu + '-glibc' + version[1] + '.' + version[2];
        }
    }
    throw new DownloadError('The engine requires macOS 14+ on Apple Silicon, Windows x64, or Linux x64/ARM64 with glibc 2.38+.');
}
