export type LicenseModel = {
    id: string;
    name: string;
    description: string;
    strengths: string;
    limitations: string;
    downloadReason: string | null;
};

import { createPublicKey, randomBytes, verify } from 'node:crypto';

export default async function licenseAccess(license: string, signal: AbortSignal, transport = fetch,
    publicKey = '8e0879487aca58247073518a7aa2b215eec0779b0bb3274f1a67bf70c519b153') {
    if (!/^[A-Z0-9-]{8,64}$/.test(license)) {
        return { ok: false as const, message: 'Check the license key and try again.' };
    }

    var request = {
        operation: 'access', license_key: license, model_id: null,
        // This read-only probe does not claim an existing device identity.
        hw: randomBytes(32).toString('hex'), nonce: randomBytes(24).toString('base64url')
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
        var data = JSON.parse(raw.toString('utf8'));
        if (!data || typeof data !== 'object' || data.nonce !== request.nonce) {
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
            return { ok: false as const, message: reasons[data.reason] || 'This license could not be verified.' };
        }
        var access = data.access;
        if (!response.ok || data.valid !== true || !access || access.status !== 'ok' ||
            typeof access.expires_at !== 'string' || !Number.isFinite(Date.parse(access.expires_at)) ||
            !Number.isSafeInteger(access.max_devices) || access.max_devices < 1 ||
            !Number.isSafeInteger(access.registered_devices) || access.registered_devices < 0 || !Array.isArray(access.models)) {
            return { ok: false as const, message: 'The server returned incomplete license details.' };
        }
        var models: LicenseModel[] = [];
        for (var model of access.models) {
            if (!model || typeof model.model_id !== 'string' || !/^[a-z0-9_-]{2,64}$/.test(model.model_id) || model.entitled !== true) {
                return { ok: false as const, message: 'The server returned invalid model details.' };
            }
            for (var field of ['display_name', 'description', 'strengths', 'limitations']) {
                if (model[field] !== undefined && (typeof model[field] !== 'string' || model[field].length > 2000 || /[\x00-\x1f\x7f-\x9f]/.test(model[field]))) {
                    return { ok: false as const, message: 'The server returned invalid model details.' };
                }
            }
            models.push({ id: model.model_id, name: model.display_name || model.model_id,
                description: model.description || 'No description published yet.',
                strengths: model.strengths || 'Not documented yet.', limitations: model.limitations || 'Not documented yet.',
                downloadReason: null });
            if (typeof model.download_reason === 'string' && /^[a-z_]{1,64}$/.test(model.download_reason)) {
                models[models.length - 1]!.downloadReason = model.download_reason;
            }
        }
        return { ok: true as const, expiresAt: access.expires_at as string,
            maxDevices: access.max_devices as number, registeredDevices: access.registered_devices as number, models };
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
