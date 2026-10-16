import { lstat, readFile } from 'node:fs/promises';
import { MAX_API_BODY_BYTES } from './api-server.js';
import type { AnonymizeResponse } from './anonymize-response.js';
import serviceRequest from '../service/service-request.js';
import servicePaths, { MAX_CONTROL_BYTES } from '../service/service-paths.js';
import dataDirectory from '../system/data-directory.js';

export default async function anonymizeText(text: string, includeMapping: boolean, signal: AbortSignal,
    directory = dataDirectory()): Promise<AnonymizeResponse> {
    try {
        signal.throwIfAborted();
        var body = JSON.stringify({ text, include_mapping: includeMapping });
        if (Buffer.byteLength(body) > MAX_API_BODY_BYTES) {
            throw new AnonymizeError('Keep the encoded JSON request within 1.6 MiB. Use a smaller input.');
        }
        var status = await serviceRequest('status', directory, signal);
        if (status.state === 'failed') {
            throw new AnonymizeError('The service failed. Check velora serve status, then run velora serve stop and velora serve start --headless.');
        }
        if (status.state === 'starting') {
            throw new AnonymizeError('The service is loading the selected model. Wait for velora serve status to report running, then try again.');
        }
        if (status.state === 'stopping') {
            throw new AnonymizeError('The service is stopping. Wait for it to stop, then run velora serve start --headless and try again.');
        }
        if (status.state !== 'running') {
            throw new AnonymizeError('The service is not ready. Run velora serve start --headless, then try again.');
        }
        var path = servicePaths(directory).record;
        var info = await lstat(path);
        if (!info.isFile() || info.size > MAX_CONTROL_BYTES) {
            throw new AnonymizeError('Could not read service credentials. Stop and restart the velora service.');
        }
        var record: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!record || typeof record !== 'object' || !('pid' in record) || record.pid !== status.pid ||
            !('token' in record) || typeof record.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.token)) {
            throw new AnonymizeError('The service changed. Check velora serve status and try again.');
        }
        var response = await fetch('http://127.0.0.1:' + status.port + '/anonymize', {
            method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
            headers: { 'Content-Type': 'application/json', 'x-velora-control-token': record.token }, body
        });
        var reader = response.body?.getReader();
        var chunks: Uint8Array[] = [];
        var bytes = 0;
        var MAX_RESPONSE_BYTES = 16 * 1024 ** 2;
        if (reader) {
            try {
                while (true) {
                    var chunk = await reader.read();
                    if (chunk.done) { break; }
                    bytes += chunk.value.byteLength;
                    if (bytes > MAX_RESPONSE_BYTES) {
                        throw new AnonymizeError('The response is too large. Try a smaller input.');
                    }
                    chunks.push(chunk.value);
                }
            } finally {
                await reader.cancel().catch(function () {});
            }
        }
        if (!response.ok) {
            var messages: Record<number, string> = {
                400: 'The input is not valid UTF-8 text.',
                401: 'Service authentication failed. Stop and restart the velora service.',
                413: 'The input is too large. Try a smaller input.',
                429: 'The engine is busy. Wait for the active request to finish and try again.',
                503: 'The service could not process the text. Check velora serve status and your license.',
                504: 'Processing timed out. Restart the service and try a smaller input.'
            };
            throw new AnonymizeError(messages[response.status] || 'The service rejected the request. Check velora serve status.');
        }
        var result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string' ||
            includeMapping && (!('mapping' in result) || !result.mapping || typeof result.mapping !== 'object' || Array.isArray(result.mapping))) {
            throw new AnonymizeError('The service returned an invalid result. Restart it and try again.');
        }
        return result as AnonymizeResponse;
    } catch (error) {
        signal.throwIfAborted();
        if (error instanceof AnonymizeError) { throw error; }
        throw new AnonymizeError('Could not reach the velora service. Check velora serve status and try again.');
    }
}

class AnonymizeError extends Error {
    override name = 'AnonymizeError';
}
