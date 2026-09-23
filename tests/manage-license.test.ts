import { test, expect } from 'bun:test';
import manageLicense from '../src/license/manage-license.js';
import licenseStore from '../src/license/license-store.js';

var valid = { ok: true as const, expiresAt: '2026-10-23T00:00:00Z', maxDevices: 3, registeredDevices: 2, models: [] };

test.each(['set', 'status', 'invalid', 'rejected', 'offline', 'cancel', 'missing', 'storage failure', 'cancel during write'])('license management: %s', async function (scenario) {
    var saved: string | null = 'OLD-LICENSE-KEY';
    if (scenario === 'missing') {
        saved = null;
    }
    var writes = 0;
    var checks = 0;
    var identities = 0;
    var controller = new AbortController();
    var services: NonNullable<Parameters<typeof manageLicense>[2]> = {
        store: async function (request) {
            if (request.operation === 'read') {
                return saved;
            }
            writes++;
            if (scenario === 'storage failure') {
                var error = new Error('Could not save the license in the system credential store. Unlock it and try again.');
                error.name = 'LicenseStoreError';
                throw error;
            }
            if (scenario === 'cancel during write') {
                controller.abort();
            }
            saved = request.license;
            return null;
        },
        identity: async function () {
            identities++;
            return { hw: 'a'.repeat(64) };
        },
        check: async function (license, _signal, hw) {
            checks++;
            expect(hw).toBe('a'.repeat(64));
            if (scenario === 'status') {
                expect(license).toBe('OLD-LICENSE-KEY');
            } else {
                expect(license).toBe('NEW-LICENSE-KEY');
            }
            if (scenario === 'rejected') {
                return { ok: false as const, message: 'This license has expired.' };
            }
            if (scenario === 'offline') {
                throw new Error('Private diagnostic NEW-LICENSE-KEY');
            }
            if (scenario === 'cancel') {
                controller.abort();
            }
            return valid;
        }
    };
    var action: Parameters<typeof manageLicense>[0] = { operation: 'set', license: ' new-license-key ' };
    if (scenario === 'status' || scenario === 'missing') {
        action = { operation: 'status' };
    }
    if (scenario === 'invalid') {
        action = { operation: 'set', license: 'bad' };
    }
    if (scenario === 'cancel') {
        await expect(manageLicense(action, controller.signal, services)).rejects.toBeInstanceOf(Error);
    } else {
        var result = await manageLicense(action, controller.signal, services);
        expect(result.ok).toBe(['set', 'status', 'cancel during write'].includes(scenario));
        if (result.ok) {
            expect(result.saved).toBe(scenario === 'set' || scenario === 'cancel during write');
        }
        if (!result.ok) {
            expect(result.message).not.toContain('NEW-LICENSE-KEY');
            expect(result.message).not.toContain('OLD-LICENSE-KEY');
        }
    }
    if (scenario === 'set' || scenario === 'cancel during write') {
        expect(saved).toBe('NEW-LICENSE-KEY');
        expect(writes).toBe(1);
    } else if (scenario === 'missing') {
        expect(saved).toBeNull();
    } else {
        expect(saved).toBe('OLD-LICENSE-KEY');
    }
    if (scenario === 'missing' || scenario === 'invalid') {
        expect(identities).toBe(0);
        expect(checks).toBe(0);
    }
    if (!['set', 'storage failure', 'cancel during write'].includes(scenario)) {
        expect(writes).toBe(0);
    }
});

test('credential storage uses fixed identifiers and restricted OS access', async function () {
    var reads = 0;
    var writes = 0;
    var storage = {
        get: async function (options: { service: string; name: string }) {
            expect(options).toEqual({ service: 'com.themistic.velora', name: 'license' });
            reads++;
            return 'TEST-LICENSE-KEY';
        },
        set: async function (options: { service: string; name: string; value: string; allowUnrestrictedAccess?: boolean }) {
            expect(options).toEqual({ service: 'com.themistic.velora', name: 'license', value: 'TEST-LICENSE-KEY', allowUnrestrictedAccess: false });
            writes++;
        }
    };
    expect(await licenseStore({ operation: 'read' }, storage)).toBe('TEST-LICENSE-KEY');
    await licenseStore({ operation: 'write', license: 'TEST-LICENSE-KEY' }, storage);
    await expect(licenseStore({ operation: 'write', license: '' }, storage)).rejects.toThrow('format');
    expect(reads).toBe(1);
    expect(writes).toBe(1);
});

test('native storage failures never expose underlying errors', async function () {
    var storage = {
        get: async function (): Promise<string | null> { throw new Error('SECRET-IN-DIAGNOSTIC'); },
        set: async function (): Promise<void> { throw new Error('SECRET-IN-DIAGNOSTIC'); }
    };
    await expect(licenseStore({ operation: 'read' }, storage)).rejects.toThrow('Could not read the system credential store. Unlock it and try again.');
    await expect(licenseStore({ operation: 'write', license: 'TEST-LICENSE-KEY' }, storage)).rejects.toThrow('Could not save the license in the system credential store. Unlock it and try again.');
});
