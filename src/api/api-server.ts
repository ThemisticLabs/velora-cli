import apiSettings from './api-settings.js';
import apiKeys from './api-keys.js';
import anonymizeResponse from './anonymize-response.js';
import DownloadError from '../downloads/download-error.js';
import type { ServiceEngine } from '../service/service-engine.js';

export var MAX_API_BODY_BYTES = Math.floor(1.6 * 1024 ** 2);
var RESPONSE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export default async function apiServer(directory: string, getEngine: () => ServiceEngine | undefined, port?: number) {
    if (port === undefined) { port = (await apiSettings(undefined, directory)).port; }
    var closing = false;
    var active: Promise<void> | undefined;
    var BODY_TIMEOUT_SECONDS = 15;
    var RETRY_AFTER_SECONDS = 1;
    try {
        var server = Bun.serve({
            hostname: '127.0.0.1', port, development: false, idleTimeout: BODY_TIMEOUT_SECONDS,
            // The streamed reader owns the limit so every oversized request gets the same JSON error.
            maxRequestBodySize: Number.MAX_SAFE_INTEGER,
            fetch: async function (request, listener) {
                var finishProcessing: (() => void) | undefined;
                try {
                    if (request.headers.get('host') !== '127.0.0.1:' + listener.port) {
                        return sendError(403, 'local_access_only', 'Use the local API address shown by velora.');
                    }
                    if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
                        return sendError(403, 'browser_access_denied', 'Browser access is not enabled. Use a local application.');
                    }
                    var url = new URL(request.url);
                    if (url.pathname !== '/anonymize' || url.search !== '') {
                        return sendError(404, 'route_not_found', 'Use POST /anonymize.');
                    }
                    if (request.method !== 'POST') {
                        return sendError(405, 'method_not_allowed', 'Use POST /anonymize.', { Allow: 'POST' });
                    }
                    var authorization = request.headers.get('authorization');
                    if (!authorization || !/^Bearer velora_[A-Za-z0-9_-]{43}$/.test(authorization)) {
                        return sendError(401, 'invalid_api_key', 'Provide a valid application API key.', { 'WWW-Authenticate': 'Bearer' });
                    }
                    var verified;
                    try { verified = await apiKeys({ operation: 'verify', key: authorization.slice('Bearer '.length) }, directory); }
                    catch { return sendError(503, 'key_store_unavailable', 'Could not read API keys. Check key storage in velora.'); }
                    if (!verified.authorized) {
                        return sendError(401, 'invalid_api_key', 'Provide a valid application API key.', { 'WWW-Authenticate': 'Bearer' });
                    }
                    var contentType = request.headers.get('content-type');
                    if (!contentType || !/^application\/json(?:\s*;\s*charset=(?:"utf-8"|utf-8))?\s*$/i.test(contentType)) {
                        return sendError(415, 'unsupported_content_type', 'Send UTF-8 JSON with Content-Type application/json.');
                    }
                    var encoding = request.headers.get('content-encoding');
                    if (encoding !== null && encoding !== 'identity') {
                        return sendError(415, 'unsupported_content_encoding', 'Send an uncompressed JSON body.');
                    }
                    if (closing || !getEngine()) {
                        return sendError(503, 'service_unavailable', 'The service is not ready. Check velora service status.');
                    }
                    if (active) {
                        return sendError(429, 'engine_busy', 'Another request is being processed. Try again shortly.', { 'Retry-After': String(RETRY_AFTER_SECONDS) });
                    }
                    if (Number(request.headers.get('content-length')) > MAX_API_BODY_BYTES) {
                        return sendError(413, 'request_too_large', 'Keep the JSON body within 1.6 MiB.');
                    }
                    active = new Promise<void>(function (resolve) { finishProcessing = resolve; });
                    listener.timeout(request, 0);
                    var chunks: Uint8Array[] = [];
                    var bytes = 0;
                    var reader = request.body?.getReader();
                    if (reader) {
                        var bodyReader = reader;
                        var bodyTimedOut = false;
                        var bodyTimer = setTimeout(function () {
                            bodyTimedOut = true;
                            void bodyReader.cancel().catch(function () {});
                        }, BODY_TIMEOUT_SECONDS * 1000);
                        try {
                            while (true) {
                                var part = await reader.read();
                                if (part.done) { break; }
                                bytes += part.value.length;
                                if (bytes > MAX_API_BODY_BYTES) {
                                    return sendError(413, 'request_too_large', 'Keep the JSON body within 1.6 MiB.');
                                }
                                chunks.push(part.value);
                            }
                        } catch (error) {
                            if (bodyTimedOut) { return sendError(408, 'body_timeout', 'Send the complete JSON body within ' + BODY_TIMEOUT_SECONDS + ' seconds.'); }
                            throw error;
                        } finally {
                            clearTimeout(bodyTimer);
                            reader.releaseLock();
                        }
                        if (bodyTimedOut) { return sendError(408, 'body_timeout', 'Send the complete JSON body within ' + BODY_TIMEOUT_SECONDS + ' seconds.'); }
                    }
                    var body: unknown;
                    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
                    catch { return sendError(400, 'invalid_json', 'Send a valid UTF-8 JSON object.'); }
                    if (!body || typeof body !== 'object' || Array.isArray(body) || !('text' in body) || typeof body.text !== 'string' ||
                        /[\uD800-\uDFFF]/u.test(body.text) || 'include_mapping' in body && typeof body.include_mapping !== 'boolean') {
                        return sendError(400, 'invalid_request', 'Provide text as a Unicode string and include_mapping as an optional boolean.');
                    }
                    for (var field of Object.keys(body)) {
                        if (field !== 'text' && field !== 'include_mapping') {
                            return sendError(400, 'invalid_request', 'Only text and include_mapping are supported.');
                        }
                    }
                    var engine = getEngine();
                    if (closing || !engine) {
                        return sendError(503, 'service_unavailable', 'The service is not ready. Check velora service status.');
                    }
                    if (request.signal.aborted) { return sendError(400, 'request_interrupted', 'The client disconnected.'); }
                    try {
                        var result = await engine.request('predict', { text: body.text });
                        var output = anonymizeResponse(body.text, result, 'include_mapping' in body && body.include_mapping === true);
                        return Response.json(output, { headers: RESPONSE_HEADERS });
                    } catch (error) {
                        if (error instanceof DownloadError && error.code === 'request_too_large') {
                            return sendError(413, 'request_too_large', 'The encoded text exceeds the engine message limit. Use a smaller request.');
                        }
                        if (error instanceof DownloadError && error.code === 'engine_timeout') {
                            return sendError(504, 'processing_timeout', 'The engine took too long to respond. Restart the service, then try a smaller request.');
                        }
                        if (error instanceof DownloadError && error.code === 'license_denied') {
                            return sendError(503, 'license_unavailable', 'The engine could not authorize this license. Check it in velora.');
                        }
                        return sendError(503, 'engine_unavailable', 'The engine could not process the request. Check velora service status and restart if needed.');
                    }
                } catch {
                    return sendError(400, 'request_interrupted', 'The request could not be read. Send the complete JSON body again.');
                } finally {
                    if (finishProcessing) { finishProcessing(); active = undefined; }
                }
            },
            error: function () { return sendError(503, 'service_unavailable', 'The local API could not complete this request. Check velora service status.'); }
        });
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
            throw new DownloadError('The local API could not start because port ' + port + ' is already in use. Choose another port in Settings, then try again.');
        }
        throw new DownloadError('The local API could not bind port ' + port + '. Check the port and system permissions, then try again.');
    }
    return {
        port: server.port!,
        close: async function () {
            closing = true;
            var stopped = server.stop(false);
            await active;
            await stopped;
        }
    };
}

function sendError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
    return Response.json({ error: { code, message } }, { status, headers: { ...RESPONSE_HEADERS, Connection: 'close', ...headers } });
}
