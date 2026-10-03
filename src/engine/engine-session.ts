import { semver } from 'bun';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import bootstrapEngine from './bootstrap-engine.js';
import type { EngineProgress } from './bootstrap-engine.js';
import DownloadError from '../downloads/download-error.js';

export default async function engineSession(license: string, signal: AbortSignal,
    onProgress?: (progress: EngineProgress) => void, bootstrap = bootstrapEngine) {
    var installation = await bootstrap(license, signal, onProgress);
    signal.throwIfAborted();
    var child = spawn(installation.executable, ['--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    var exited = new Promise<void>(function (resolve) { child.once('close', function () { resolve(); }); });
    var MAX_RESPONSE_BYTES = 2 * 1024 ** 2;
    var REQUEST_TIMEOUT_MS = 30000;
    var LOAD_TIMEOUT_MS = 120000;
    var INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
    var KILL_DELAY_MS = 1000;
    var buffer = Buffer.alloc(0);
    var nextId = 0;
    var failure: Error | undefined;
    var pending: { id: number; operation: string; downloaded: number; total?: number; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void } | undefined;
    var capabilities: unknown;
    var forceKill: ReturnType<typeof setTimeout> | undefined;
    var stop = function (error: Error) {
        failure = error;
        pending?.reject(error);
        pending = undefined;
        child.kill();
        if (!forceKill) {
            forceKill = setTimeout(function () { child.kill('SIGKILL'); }, KILL_DELAY_MS);
            forceKill.unref();
        }
    };
    var abort = function () { stop(new DownloadError('Engine operation cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', function () { stop(new DownloadError('The engine could not start. Check its installation and system permissions.')); });
    child.stdin.on('error', function () { stop(new DownloadError('The connection to the engine closed. Try again.')); });
    child.on('close', function () {
        if (forceKill) {
            clearTimeout(forceKill);
        }
        signal.removeEventListener('abort', abort);
        failure ||= new DownloadError('The engine stopped before completing the request. Try again.');
        pending?.reject(failure);
        pending = undefined;
    });
    child.stdout.on('data', function (chunk: Buffer) {
        if (failure) {
            return;
        }
        if (buffer.length + chunk.length > MAX_RESPONSE_BYTES) {
            stop(new DownloadError('The engine response exceeds its size limit.'));
            return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
            var end = buffer.indexOf(10);
            if (end < 0) {
                return;
            }
            try {
                var response: unknown = JSON.parse(buffer.subarray(0, end).toString('utf8'));
                buffer = buffer.subarray(end + 1);
                if (!pending || typeof response !== 'object' || response === null ||
                    !('id' in response) || response.id !== pending.id) {
                    throw new Error('Invalid response');
                }
                if ('event' in response && response.event === 'progress') {
                    var progress = response as Record<string, unknown>;
                    var phases: Record<string, string> = {
                        download: 'Downloading model files.', verify: 'Verifying model files.',
                        extract: 'Preparing the runtime.', confirm: 'Confirming the installation.'
                    };
                    if (pending.operation !== 'install_model') { throw new Error('Unexpected progress'); }
                    if (typeof progress.phase !== 'string' || !Object.hasOwn(phases, progress.phase)) {
                        throw new Error('Invalid progress phase');
                    }
                    var downloaded = 0;
                    var total = 0;
                    if (progress.phase === 'download') {
                        if (typeof progress.downloaded_bytes !== 'number' || !Number.isSafeInteger(progress.downloaded_bytes) ||
                            typeof progress.total_bytes !== 'number' || !Number.isSafeInteger(progress.total_bytes) ||
                            progress.downloaded_bytes < pending.downloaded || progress.total_bytes < progress.downloaded_bytes ||
                            pending.total !== undefined && pending.total !== progress.total_bytes) {
                            throw new Error('Invalid progress size');
                        }
                        downloaded = progress.downloaded_bytes;
                        total = progress.total_bytes;
                        pending.downloaded = downloaded;
                        pending.total = total;
                    }
                    var progressMessage = phases[progress.phase]!;
                    if (progress.phase === 'download' && typeof progress.file === 'string' &&
                        /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(progress.file)) {
                        progressMessage = 'Downloading ' + progress.file;
                    }
                    onProgress?.({ downloaded, total, message: progressMessage, engineVersion: installation.release.version });
                    continue;
                }
                if (!('ok' in response)) {
                    throw new Error('Missing result');
                }
                if (response.ok === false) {
                    var messages: Record<string, string> = {
                        license_denied: 'The engine could not authorize this license. Check the key and device allowance.',
                        engine_update_required: 'Update the engine in Settings, then try installing this model again.',
                        download_or_verification_failed: 'The engine could not finish the verified installation. Check your connection and license, then retry.',
                        invalid_request_or_package: 'The engine rejected the request or package. Check for an engine update.',
                        engine_failure: 'The engine could not complete this operation. Try again.'
                    };
                    var code = '';
                    if ('error' in response && typeof response.error === 'string') {
                        code = response.error;
                    }
                    var message = 'The engine returned an unsuccessful response. Try again.';
                    if (Object.hasOwn(messages, code)) {
                        message = messages[code]!;
                    }
                    pending.reject(new DownloadError(message, code));
                    pending = undefined;
                    return;
                }
                if (response.ok !== true || !('result' in response) || typeof response.result !== 'object' ||
                    response.result === null || Array.isArray(response.result)) {
                    throw new Error('Invalid result');
                }
                pending.resolve(response.result as Record<string, unknown>);
                pending = undefined;
            } catch {
                stop(new DownloadError('The engine returned an invalid response. Check for an engine update.'));
                return;
            }
        }
    });
    var request = async function (operation: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        signal.throwIfAborted();
        if (failure) {
            throw failure;
        }
        if (pending) {
            throw new DownloadError('Wait for the current engine operation to finish.');
        }
        if (operation === 'install_model' && (!Array.isArray(capabilities) || !capabilities.includes('install_model'))) {
            throw new DownloadError('Update the engine in Settings before installing a model.');
        }
        var id = ++nextId;
        var timeout = REQUEST_TIMEOUT_MS;
        if (operation === 'load') {
            timeout = LOAD_TIMEOUT_MS;
        }
        if (operation === 'install_model') {
            timeout = INSTALL_TIMEOUT_MS;
        }
        var raw = JSON.stringify({ ...fields, id, operation }) + '\n';
        if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
            throw new DownloadError('The engine request exceeds its size limit.', 'request_too_large');
        }
        var timer = setTimeout(function () { stop(new DownloadError('The engine took too long to respond. Try again.', 'engine_timeout')); }, timeout);
        try {
            return await new Promise<Record<string, unknown>>(function (resolve, reject) {
                pending = { id, operation, downloaded: 0, resolve, reject };
                child.stdin.write(raw);
            });
        } finally {
            clearTimeout(timer);
        }
    };
    var close = async function () {
        child.stdin.end();
        await Promise.race([exited, delay(KILL_DELAY_MS)]);
        if (child.exitCode === null && child.signalCode === null) {
            stop(new DownloadError('Engine session closed.'));
        }
        await exited;
    };
    try {
        var version = await request('version');
        capabilities = version.capabilities;
        var MIN_ENGINE_VERSION = '0.4.1';
        if (version.version !== installation.release.version || version.engine_api !== 1 || version.protocol !== 'json-lines-v1' ||
            typeof version.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version.version) ||
            semver.order(version.version, MIN_ENGINE_VERSION) < 0) {
            throw new DownloadError('This engine is not compatible with velora. Check for an engine update in Settings.');
        }
        return { request, close, installation, exited };
    } catch (error) {
        await close();
        throw error;
    }
}
