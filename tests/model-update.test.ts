import { test, expect } from 'bun:test';
import modelUpdate from '../src/updates/model-update.js';

test.each(['newer', 'current', 'older', 'missing', 'ambiguous', 'invalid', 'no license'])('manual model update: %s', async function (scenario) {
    var release = { model_id: 'skira7alpha', revision: 'r2', version: '2', engine_version: '0.2.0', sequence: 2, enabled: true,
        files: { 'manifest.json': { size: 1, sha256: 'a'.repeat(64) }, 'manifest.sig': { size: 64, sha256: 'b'.repeat(64) }, 'predict.py': { size: 1, sha256: 'c'.repeat(64) } } };
    var releases: unknown[] = [release];
    if (scenario === 'current') {
        release.sequence = 1;
    }
    if (scenario === 'missing') {
        releases = [];
    }
    if (scenario === 'ambiguous') {
        releases.push(release);
    }
    if (scenario === 'invalid') {
        releases = [{}];
    }
    var model = { id: 'skira7alpha', name: 'Skira 7 Alpha', version: '1', revision: 'r1', sequence: 1, engineVersion: '0.1.1', selected: true };
    if (scenario === 'older') {
        model.sequence = 3;
    }
    var requests = 0;
    var services: NonNullable<Parameters<typeof modelUpdate>[2]> = {
        store: async function () {
            if (scenario === 'no license') {
                return null;
            }
            return 'FIXTURE-LICENSE';
        },
        identity: async function () { return { hw: 'a'.repeat(64) }; },
        request: async function (binding) {
            requests++;
            expect(binding.operation).toBe('catalog');
            return { metadata: { releases }, body: Buffer.alloc(0) };
        }
    };
    var result = modelUpdate(model, new AbortController().signal, services);
    if (scenario === 'invalid') {
        await expect(result).rejects.toThrow();
        return;
    }
    var report = await result;
    var message = report.message;
    expect(message).not.toContain('FIXTURE-LICENSE');
    if (scenario === 'newer') {
        expect(report.available).toEqual({ version: '2', engineVersion: '0.2.0' });
        expect(message).toContain('not available yet');
    }
    if (scenario === 'current' || scenario === 'older') {
        expect(message).toBe('No newer model package is available.');
    }
    if (scenario === 'no license') {
        expect(requests).toBe(0);
    }
});
