import { test, expect } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import licenseAccess from '../src/license-access.js';

var keys = generateKeyPairSync('ed25519');
var publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

test.each(['valid', 'invalid signature', 'wrong nonce', 'wrong device', 'expired', 'busy', 'invalid schema'])('license access: %s', async function (scenario) {
    var transport = async function (_url: unknown, options: RequestInit | undefined) {
        var request = JSON.parse(options?.body as string);
        expect(request.operation).toBe('access');
        expect(request.model_id).toBeNull();
        expect(options?.redirect).toBe('error');
        var data = { ...request, valid: true, reason: 'ok', access: {
            status: 'ok', expires_at: '2026-10-18T10:00:00Z', max_devices: 50, registered_devices: 0,
            models: [{ model_id: 'skira7alpha', entitled: true }]
        } };
        var status = 200;
        if (scenario === 'wrong nonce') {
            data.nonce = 'another-request';
        }
        if (scenario === 'wrong device') {
            data.hw = 'another-device';
        }
        if (scenario === 'expired') {
            data.valid = false;
            data.reason = 'expired';
            status = 403;
        }
        if (scenario === 'busy') {
            status = 503;
        }
        if (scenario === 'invalid schema') {
            data.access.max_devices = -1;
        }
        var raw = Buffer.from(JSON.stringify(data));
        var signature = sign(null, raw, keys.privateKey).toString('base64');
        if (scenario === 'invalid signature') {
            raw = Buffer.from(JSON.stringify({ ...data, reason: 'tampered' }));
        }
        return new Response(raw, { status, headers: { 'X-Signature': signature } });
    };
    var result = await licenseAccess('TEST-ONLY-KEY', new AbortController().signal, transport as typeof fetch, publicKey);
    expect(result.ok).toBe(scenario === 'valid');
    if (result.ok) {
        expect(result.models[0]?.id).toBe('skira7alpha');
        expect(result.models[0]?.description).toBe('No description published yet.');
        expect(result.maxDevices).toBe(50);
    }
});

test('invalid key never reaches the network', async function () {
    var result = await licenseAccess('bad', new AbortController().signal, function () {
        throw new Error('Unexpected request');
    } as typeof fetch);
    expect(result).toEqual({ ok: false, message: 'Check the license key and try again.' });
});

test.each([false, true])('signed model descriptions reject terminal controls: %s', async function (unsafe) {
    var transport = async function (_url: unknown, options: RequestInit | undefined) {
        var request = JSON.parse(options?.body as string);
        var description = 'Typed anonymization with time and ID rules.';
        if (unsafe) {
            description += '\u001b[2J';
        }
        var raw = Buffer.from(JSON.stringify({ ...request, valid: true, access: {
            status: 'ok', expires_at: '2026-10-18T10:00:00Z', max_devices: 50, registered_devices: 0,
            models: [{ model_id: 'skira7alpha', entitled: true, display_name: 'Skira 7 Alpha', description,
                strengths: 'Shared placeholder IDs.', limitations: 'Weekdays may be missed.', download_reason: null }]
        } }));
        return new Response(raw, { headers: { 'X-Signature': sign(null, raw, keys.privateKey).toString('base64') } });
    };
    var result = await licenseAccess('TEST-ONLY-KEY', new AbortController().signal, transport as typeof fetch, publicKey);
    expect(result.ok).toBe(!unsafe);
    if (result.ok) {
        expect(result.models[0]?.name).toBe('Skira 7 Alpha');
        expect(result.models[0]?.strengths).toBe('Shared placeholder IDs.');
        expect(result.models[0]?.limitations).toBe('Weekdays may be missed.');
    }
});
