import { test, expect } from 'bun:test';
import licenseAccess from '../src/license/license-access.js';
import type engineSession from '../src/engine/engine-session.js';

test.each(['valid', 'invalid expiry', 'invalid device limit', 'invalid model', 'unsafe description', 'cancel'])('engine model listing: %s', async function (scenario) {
    var access = { status: 'ok', expires_at: '2026-10-18T10:00:00Z', max_devices: 50, registered_devices: 0,
        models: [{ model_id: 'skira7alpha', entitled: true, can_download: true, description: 'Local text processing.' }] };
    if (scenario === 'invalid expiry') { access.expires_at = 'invalid'; }
    if (scenario === 'invalid device limit') { access.max_devices = -1; }
    if (scenario === 'invalid model') { access.models[0]!.model_id = '../outside'; }
    if (scenario === 'unsafe description') { access.models[0]!.description = '\u001b[2J'; }
    var closed = false;
    var controller = new AbortController();
    var connect = async function () {
        return {
            request: async function (operation: string, fields: Record<string, unknown>) {
                expect(operation).toBe('models');
                expect(fields).toEqual({ license_key: 'FIXTURE-LICENSE' });
                if (scenario === 'cancel') {
                    controller.abort();
                    throw controller.signal.reason;
                }
                return access;
            },
            close: async function () { closed = true; }
        };
    } as unknown as typeof engineSession;
    var task = licenseAccess('FIXTURE-LICENSE', controller.signal, connect);
    if (scenario === 'cancel') {
        await expect(task).rejects.toBeInstanceOf(Error);
    } else {
        var result = await task;
        expect(result.ok).toBe(scenario === 'valid');
        if (result.ok) {
            expect(result.models[0]?.canDownload).toBe(true);
            expect(result.registeredDevices).toBe(0);
        }
    }
    expect(closed).toBe(true);
});

test('invalid license never downloads or starts an engine', async function () {
    var result = await licenseAccess('bad', new AbortController().signal, async function () {
        throw new Error('Must not run');
    });
    expect(result).toEqual({ ok: false, message: 'Check the license key and try again.' });
});

test.each(['expired', 'revoked', 'unknown_key', 'offline'])('signed license denial: %s', async function (reason) {
    var DownloadError = (await import('../src/downloads/download-error.js')).default;
    var closed = false;
    var connect = async function () {
        return {
            installation: { target: 'macosx-14.0-arm64' },
            request: async function () { throw new DownloadError('License denied.', 'license_denied'); },
            close: async function () { closed = true; }
        };
    } as unknown as typeof engineSession;
    var result = await licenseAccess('FIXTURE-LICENSE', new AbortController().signal, connect, undefined, async function (binding) {
        expect(binding).toEqual({ operation: 'resolve', license_key: 'FIXTURE-LICENSE', runtime_target: 'macosx-14.0-arm64' });
        if (reason === 'offline') { throw new TypeError('Network unreachable'); }
        throw new DownloadError('License rejected.', reason);
    });
    expect(result.ok).toBe(false);
    if (!result.ok && 'reason' in result) { expect(result.reason).toBe(reason); }
    if (reason === 'offline') { expect(result).not.toHaveProperty('reason'); }
    expect(closed).toBe(true);
});
