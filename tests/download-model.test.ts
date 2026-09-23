import { test, expect, spyOn } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import downloadModel from '../src/downloads/download-model.js';

var keys = generateKeyPairSync('ed25519');
var publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

test.each(['valid', 'legacy version', 'invalid signature', 'wrong nonce', 'wrong range', 'truncated', 'oversized',
    'wrong hash', 'invalid manifest', 'wrong config', 'withdrawn', 'unsafe name', 'duplicate case', 'invalid version',
    'cleanup failure', 'failed download cleanup', 'cancel', 'cancel while paused', 'existing installation', 'locked'])('model download: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-download-'));
    var controller = new AbortController();
    var originalRemove = filesystem.rm;
    var removal = spyOn(filesystem, 'rm').mockImplementation(async function (path, options) {
        if (['cleanup failure', 'failed download cleanup'].includes(scenario) && typeof path === 'string' &&
            (path.startsWith(join(root, '.install-')) || path === join(root, '.update.lock'))) {
            throw new Error('Synthetic cleanup failure');
        }
        return originalRemove(path, options);
    });
    var files: Record<string, Buffer> = {
        'predict.py': Buffer.from('# synthetic fixture, never executed\n'),
        'weights.enc': Buffer.alloc(1024 * 1024 + 7, 42),
        'license_config.json': Buffer.from(JSON.stringify({ model_id: 'skira7alpha', version: 'model-v1', public_key_hex: publicKey }))
    };
    if (scenario === 'wrong config') {
        files['license_config.json'] = Buffer.from('{}');
    }
    var hashes: Record<string, string> = {};
    for (var [name, bytes] of Object.entries(files)) {
        hashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    var engineVersion: string | undefined = '0.1.0';
    if (scenario === 'legacy version') {
        engineVersion = undefined;
    }
    var manifest = Buffer.from(JSON.stringify({ model_id: 'skira7alpha', version: 'model-v1', package_revision: 'r1', engine_version: engineVersion, files: hashes }));
    files['manifest.json'] = manifest;
    files['manifest.sig'] = sign(null, manifest, keys.privateKey);
    if (scenario === 'invalid manifest') {
        files['manifest.sig'] = Buffer.alloc(64);
    }
    var descriptors: Record<string, { size: number; sha256: string }> = {};
    for (var [name, bytes] of Object.entries(files)) {
        descriptors[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    if (scenario === 'unsafe name') {
        descriptors['../outside'] = descriptors['predict.py']!;
    }
    if (scenario === 'duplicate case') {
        descriptors['PREDICT.py'] = descriptors['predict.py']!;
    }
    if (scenario === 'invalid version') {
        engineVersion = '\u001b[2J';
    }
    var release = { model_id: 'skira7alpha', version: 'model-v1', revision: 'r1', sequence: 1, engine_version: engineVersion, enabled: true, files: descriptors };
    var requests = 0;
    var catalogs = 0;
    var transferred = 0;
    var progress = 0;
    var transport = async function (_url: unknown, options?: RequestInit) {
        requests++;
        expect(options?.redirect).toBe('error');
        var request = JSON.parse(options?.body as string);
        var metadata = { ...request, valid: true };
        if (request.operation === 'catalog') {
            catalogs++;
            metadata.releases = [release];
            if (scenario === 'withdrawn' && catalogs > 1) {
                metadata.releases = [];
            }
        } else {
            expect(request.length).toBeLessThanOrEqual(1024 * 1024);
            metadata.size = files[request.name]!.length;
            if (scenario === 'wrong range') {
                metadata.offset++;
            }
        }
        if (scenario === 'wrong nonce') {
            metadata.nonce = 'wrong';
        }
        var raw = Buffer.from(JSON.stringify(metadata));
        var signature = sign(null, raw, keys.privateKey).toString('base64');
        if (scenario === 'invalid signature') {
            signature = Buffer.alloc(64).toString('base64');
        }
        if (request.operation === 'catalog') {
            return new Response(raw, { headers: { 'X-Signature': signature } });
        }
        var body = Buffer.from(files[request.name]!.subarray(request.offset, request.offset + request.length));
        transferred += body.length;
        if (scenario === 'wrong hash' || scenario === 'failed download cleanup') {
            body[0] = body[0]! ^ 1;
        }
        if (scenario === 'truncated') {
            body = body.subarray(0, Math.max(0, body.length - 1));
        }
        if (scenario === 'oversized') {
            body = Buffer.concat([body, Buffer.from('extra')]);
        }
        if (scenario === 'cancel') {
            controller.abort();
        }
        return new Response(body, { headers: { 'X-Signature': signature, 'X-Package-Response': raw.toString('base64'), 'Content-Length': String(request.length) } });
    };
    try {
        if (scenario === 'existing installation') {
            await writeFile(join(root, 'current.json'), 'preserve');
        }
        if (scenario === 'locked') {
            await writeFile(join(root, '.update.lock'), 'preserve');
        }
        var action = downloadModel({ license: 'TEST-ONLY-KEY', hw: 'a'.repeat(64), modelId: 'skira7alpha', root,
            signal: controller.signal, publicKey, transport: transport as typeof fetch,
            waitForResume: async function () {
                if (scenario === 'cancel while paused') {
                    controller.abort();
                }
            },
            onProgress: function (update) {
                expect(update.downloaded).toBeGreaterThanOrEqual(progress);
                expect(update.downloaded).toBeLessThanOrEqual(update.total);
                progress = update.downloaded;
            }
        });
        if (scenario === 'valid' || scenario === 'legacy version' || scenario === 'cleanup failure') {
            var installed = await action;
            expect(installed.cleanupRequired).toBe(scenario === 'cleanup failure');
            expect(installed.engine_version).toBe(engineVersion);
            expect(catalogs).toBe(2);
            expect(progress).toBe(transferred);
            expect(await readFile(join(installed.path, 'weights.enc'))).toEqual(files['weights.enc']);
            var state = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
            expect(state.highest_sequences.skira7alpha).toBe(1);
            expect(state.engine_version).toBe(engineVersion);
        } else {
            if (scenario === 'failed download cleanup') {
                await expect(action).rejects.toThrow('The checksum does not match');
            } else {
                await expect(action).rejects.toBeInstanceOf(Error);
            }
            if (scenario === 'existing installation') {
                expect(await readFile(join(root, 'current.json'), 'utf8')).toBe('preserve');
                expect(requests).toBe(0);
            } else {
                expect(await readdir(root)).not.toContain('current.json');
            }
        }
        if (scenario === 'cleanup failure' || scenario === 'failed download cleanup') {
            expect(await readdir(root)).toContain('.update.lock');
            return;
        }
        for (var name of await readdir(root)) {
            expect(name.startsWith('.install-')).toBe(false);
        }
        if (scenario === 'cancel while paused') {
            expect(requests).toBe(0);
        }
        if (scenario === 'locked') {
            expect(await readFile(join(root, '.update.lock'), 'utf8')).toBe('preserve');
            expect(requests).toBe(0);
        } else {
            expect(await readdir(root)).not.toContain('.update.lock');
        }
    } finally {
        removal.mockRestore();
        await rm(root, { recursive: true, force: true });
    }
});
