import { setTimeout as delay } from 'node:timers/promises';
import DownloadError from './download-error.js';
import { createPublicKey, randomBytes, verify } from 'node:crypto';

export var PACKAGE_PUBLIC_KEY = '8e0879487aca58247073518a7aa2b215eec0779b0bb3274f1a67bf70c519b153';
export var MAX_METADATA_BYTES = 2 * 1024 * 1024;
export type PackageBinding = {
    operation: 'resolve' | 'file';
    license_key: string;
    hw?: string;
    model_id?: string;
    runtime_target: string;
    artifact_kind?: 'engine';
    installed_engine_revision?: string;
    revision?: string;
    name?: string;
    sha256?: string;
    offset?: number;
    length?: number;
};

export default async function packageRequest(binding: PackageBinding, signal: AbortSignal,
    transport = fetch, publicKey = PACKAGE_PUBLIC_KEY, fileSize?: number, endpoint: 'engine' | 'check' = 'engine') {
    var NONCE_BYTES = 24;
    var REQUEST_TIMEOUT_MS = 60000;
    var request = { ...binding, nonce: randomBytes(NONCE_BYTES).toString('base64url') };
    var MAX_RATE_LIMIT_RETRIES = 2;
    var MAX_RETRY_SECONDS = 60;
    for (var attempt = 0; ; attempt++) {
        var response = await transport('https://api.themistic.com/license/' + endpoint, {
            method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
            headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
            body: JSON.stringify(request)
        });
        if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
            break;
        }
        var waitSeconds = Number(response.headers.get('Retry-After') || '5');
        if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_RETRY_SECONDS) {
            break;
        }
        await response.body?.cancel();
        await delay(waitSeconds * 1000, undefined, { signal });
    }
    try {
        if ((response.status === 429 || response.status === 503) && !response.headers.get('X-Signature')) {
            throw new DownloadError('The license server is busy. Wait a moment and try again.', 'temporarily_unavailable');
        }
        var binary = binding.operation === 'file' && response.status === 200;
        var limit = MAX_METADATA_BYTES;
        if (binary) {
            limit = binding.length!;
            if (response.headers.get('Content-Length') !== String(limit) ||
                !['identity', null].includes(response.headers.get('Content-Encoding'))) {
                throw new DownloadError('The download size or encoding does not match the request.');
            }
        }
        if (!response.body) {
            throw new DownloadError('The package server returned an empty response.');
        }
        var reader = response.body.getReader();
        var chunks: Uint8Array[] = [];
        var size = 0;
        try {
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) {
                    break;
                }
                size += chunk.value.length;
                if (size > limit) {
                    await reader.cancel();
                    throw new DownloadError('The package response exceeds its size limit.');
                }
                chunks.push(chunk.value);
            }
        } finally {
            reader.releaseLock();
        }
        var body = Buffer.concat(chunks);
        var raw = body;
        if (binary) {
            var encoded = response.headers.get('X-Package-Response') || '';
            if (encoded.length > MAX_METADATA_BYTES || size !== limit) {
                throw new DownloadError('The downloaded range is incomplete or its metadata is too large.');
            }
            raw = Buffer.from(encoded, 'base64');
        }
        var SPKI_PREFIX = '302a300506032b6570032100';
        var key = createPublicKey({ key: Buffer.concat([Buffer.from(SPKI_PREFIX, 'hex'), Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
        if (!verify(null, raw, key, Buffer.from(response.headers.get('X-Signature') || '', 'base64'))) {
            throw new DownloadError('The package response signature is invalid.');
        }
        var data: unknown = JSON.parse(raw.toString('utf8'));
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            throw new DownloadError('The package response is invalid.');
        }
        var metadata = data as Record<string, unknown>;
        if (metadata.nonce !== request.nonce) {
            throw new DownloadError('The package response does not match this request.');
        }
        if (response.status === 429 || response.status === 503) {
            throw new DownloadError('The package server is busy. Try again shortly.');
        }
        for (var field of Object.keys(request) as (keyof typeof request)[]) {
            if (metadata[field] !== request[field]) {
                throw new DownloadError('The package response does not match this request.');
            }
        }
        if (metadata.valid !== true || !response.ok) {
            if (metadata.reason === 'too_many_devices' || metadata.reason === 'device_limit_reached') {
                throw new DownloadError('No device slot is available. Manage your devices in the Themistic console.');
            }
            var reasons: Record<string, string> = {
                expired: 'This license has expired.', revoked: 'This license has been revoked.',
                unknown_key: 'This license key was not found.',
                engine_unavailable_for_runtime: 'No engine is available for this operating system. Check the supported platforms in the documentation.',
                update_cutoff: 'This release is outside your license update period.'
            };
            if (typeof metadata.reason === 'string' && Object.hasOwn(reasons, metadata.reason)) {
                throw new DownloadError(reasons[metadata.reason]!, metadata.reason);
            }
            throw new DownloadError('Package access was denied. Check your license and model access.');
        }
        if (binary && metadata.size !== fileSize) {
            throw new DownloadError('The file size differs from the signed catalog.');
        }
        return { metadata, body };
    } finally {
        if (response.body && !response.body.locked) {
            try {
                await response.body.cancel();
            } catch {
                // A failed stream must not replace the original download error during cleanup.
            }
        }
    }
}
