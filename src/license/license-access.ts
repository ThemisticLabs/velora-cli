import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { PACKAGE_PUBLIC_KEY } from '../downloads/package-request.js';

export type LicenseModel = {
    id: string;
    name: string;
    description: string;
    strengths: string;
    limitations: string;
    downloadReason: string | null;
    canDownload: boolean;
};

export default async function licenseAccess(license: string, signal: AbortSignal, deviceHw: string, transport = fetch,
    publicKey = PACKAGE_PUBLIC_KEY) {
    if (!/^[A-Z0-9-]{8,64}$/.test(license)) {
        return { ok: false as const, message: 'Check the license key and try again.' };
    }

    if (!/^[a-f0-9]{16,64}$/.test(deviceHw)) {
        return { ok: false as const, message: 'The device identity is invalid.' };
    }
    var NONCE_BYTES = 24;
    var MAX_MODEL_TEXT_LENGTH = 2000;
    var request = {
        operation: 'access', license_key: license, model_id: null,
        hw: deviceHw, nonce: randomBytes(NONCE_BYTES).toString('base64url')
    };
    var MAX_RESPONSE_BYTES = 262144;
    var REQUEST_TIMEOUT_MS = 15000;
    var requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
        var response = await transport('https://api.themistic.com/v1/license/check', {
            method: 'POST', redirect: 'error', signal: requestSignal,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.body) {
            return { ok: false as const, message: 'The license server returned an empty response.' };
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
                if (size > MAX_RESPONSE_BYTES) {
                    await reader.cancel();
                    return { ok: false as const, message: 'The license server response is too large.' };
                }
                chunks.push(chunk.value);
            }
        } finally {
            reader.releaseLock();
        }
        var raw = Buffer.concat(chunks);
        var signature = response.headers.get('X-Signature') || '';
        var ED25519_SPKI_PREFIX = '302a300506032b6570032100';
        var key = createPublicKey({ key: Buffer.concat([
            Buffer.from(ED25519_SPKI_PREFIX, 'hex'), Buffer.from(publicKey, 'hex')
        ]), format: 'der', type: 'spki' });
        if (!verify(null, raw, key, Buffer.from(signature, 'base64'))) {
            return { ok: false as const, message: 'The server response could not be verified.' };
        }
        var data: unknown = JSON.parse(raw.toString('utf8'));
        if (!isRecord(data) || data.nonce !== request.nonce) {
            return { ok: false as const, message: 'The server response does not match this request.' };
        }
        // Busy responses bind only the nonce, as defined by the server contract.
        if (response.status === 429 || response.status === 503) {
            return { ok: false as const, message: 'The license server is busy. Try again shortly.' };
        }
        if (data.license_key !== license || data.hw !== request.hw || data.model_id !== null || data.operation !== 'access') {
            return { ok: false as const, message: 'The server response does not match this request.' };
        }
        if (data.valid === false) {
            var reasons: Record<string, string> = {
                unknown_key: 'This license key was not found.', expired: 'This license has expired.',
                revoked: 'This license has been revoked.', not_yet_valid: 'This license is not valid yet.'
            };
            var message = 'This license could not be verified.';
            if (typeof data.reason === 'string' && Object.hasOwn(reasons, data.reason)) {
                message = reasons[data.reason]!;
            }
            return { ok: false as const, message };
        }
        var access = data.access;
        if (!response.ok || data.valid !== true || !isRecord(access) || access.status !== 'ok') {
            return { ok: false as const, message: 'The server returned incomplete license details.' };
        }
        var expiresAt = access.expires_at;
        var maxDevices = access.max_devices;
        var registeredDevices = access.registered_devices;
        if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) {
            return { ok: false as const, message: 'The server returned an invalid license expiry.' };
        }
        if (typeof maxDevices !== 'number' || !Number.isSafeInteger(maxDevices) || maxDevices < 1) {
            return { ok: false as const, message: 'The server returned an invalid device limit.' };
        }
        if (typeof registeredDevices !== 'number' || !Number.isSafeInteger(registeredDevices) || registeredDevices < 0) {
            return { ok: false as const, message: 'The server returned an invalid device count.' };
        }
        if (!Array.isArray(access.models)) {
            return { ok: false as const, message: 'The server returned an invalid model list.' };
        }
        var models: LicenseModel[] = [];
        var receivedModels: unknown[] = access.models;
        for (var model of receivedModels) {
            if (!isRecord(model) || typeof model.model_id !== 'string' || !/^[a-z0-9_-]{2,64}$/.test(model.model_id) || model.entitled !== true) {
                return { ok: false as const, message: 'The server returned invalid model details.' };
            }
            var metadata = {
                display_name: model.model_id,
                description: 'No description published yet.',
                strengths: 'Not documented yet.',
                limitations: 'Not documented yet.'
            };
            var textFields: (keyof typeof metadata)[] = ['display_name', 'description', 'strengths', 'limitations'];
            for (var field of textFields) {
                var text = model[field];
                if (text === undefined) {
                    continue;
                }
                if (typeof text !== 'string' || text.length > MAX_MODEL_TEXT_LENGTH || /[\x00-\x1f\x7f-\x9f]/.test(text)) {
                    return { ok: false as const, message: 'The server returned invalid model details.' };
                }
                if (text) {
                    metadata[field] = text;
                }
            }
            var licenseModel: LicenseModel = {
                id: model.model_id,
                name: metadata.display_name,
                description: metadata.description,
                strengths: metadata.strengths,
                limitations: metadata.limitations,
                canDownload: model.can_download === true,
                downloadReason: null
            };
            if (typeof model.download_reason === 'string' && /^[a-z_]{1,64}$/.test(model.download_reason)) {
                licenseModel.downloadReason = model.download_reason;
            }
            models.push(licenseModel);
        }
        return { ok: true as const, expiresAt, maxDevices, registeredDevices, models };
    } catch {
        if (signal.aborted) {
            throw signal.reason;
        }
        if (requestSignal.aborted) {
            return { ok: false as const, message: 'The license server took too long to respond.' };
        }
        return { ok: false as const, message: 'Could not read a verified server response. Try again.' };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
