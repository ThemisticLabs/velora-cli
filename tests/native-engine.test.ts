import { test, expect } from 'bun:test';
import { createHash, sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import enginePackage from './fixtures/engine-package.js';
import engineSession from '../src/engine/engine-session.js';
import type bootstrapEngine from '../src/engine/bootstrap-engine.js';
import downloadModel from '../src/downloads/download-model.js';
import installedModels from '../src/models/installed-models.js';

var executable = process.env.VELORA_TEST_ENGINE_BINARY;
test.skipIf(!executable)('native 0.4.2 installs through velora with real progress and a signed loopback server', async function () {
    var directory = await mkdtemp(join(tmpdir(), 'velora-native-'));
    var fixture = await enginePackage('valid', '0.4.2');
    var packagePath = join(directory, 'bootstrap');
    await mkdir(packagePath);
    for (var [name, bytes] of Object.entries(fixture.files)) {
        await writeFile(join(packagePath, name), bytes);
    }
    var files: Record<string, Buffer> = {
        'model.safetensors.enc': Buffer.alloc(1024 * 1024 + 1, 42),
        'inference_config.json': Buffer.from('{}'),
        'license_config.json': Buffer.from(JSON.stringify({ model_id: 'fixture', version: 'v1', public_key_hex: fixture.publicKey }))
    };
    var hashes: Record<string, string> = {};
    for (var [name, bytes] of Object.entries(files)) {
        hashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    var manifest = { model_id: 'fixture', version: 'v1', package_revision: 'model-r1', artifact_kind: 'model',
        engine_api: 1, adapter: 'typed-token-v1', files: hashes };
    files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
    files['manifest.sig'] = sign(null, files['manifest.json'], fixture.keys.privateKey);
    var descriptors: Record<string, { size: number; sha256: string }> = {};
    for (var [name, bytes] of Object.entries(files)) {
        descriptors[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    var release = { ...manifest, revision: 'model-r1', sequence: 1, enabled: true, notes: 'Isolated fixture', released_at: '2026-09-27T00:00:00Z', files: descriptors };
    var requests: string[] = [];
    var server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        var value = await request.json() as Record<string, unknown>;
        requests.push(String(value.operation));
        var metadata: Record<string, unknown> = { ...value, valid: true, reason: 'ok' };
        var body: Buffer | undefined = undefined;
        if (value.operation === 'access') {
            metadata.access = { status: 'ok', expires_at: '2027-01-01T00:00:00Z', max_devices: 5, registered_devices: 0,
                models: [{ model_id: 'fixture', entitled: true, can_download: true }] };
        } else if (value.operation === 'resolve') {
            metadata.model = release;
            metadata.engine = fixture.release;
        } else if (value.operation === 'complete') {
            metadata.receipt = { model_id: 'fixture', model_revision: 'model-r1', engine_revision: fixture.release.revision,
                license_authorized: true, reported_hashes_match: true, client_integrity_verified: false };
        } else if (value.operation === 'file') {
            var source = files;
            if (value.artifact_kind === 'engine') { source = fixture.files; }
            var content = source[String(value.name)]!;
            metadata.size = content.length;
            body = content.subarray(Number(value.offset), Number(value.offset) + Number(value.length));
        } else {
            return new Response('Unexpected operation', { status: 400 });
        }
        var raw = Buffer.from(JSON.stringify(metadata));
        var headers: Record<string, string> = { 'X-Signature': sign(null, raw, fixture.keys.privateKey).toString('base64') };
        if (body) {
            headers['X-Package-Response'] = raw.toString('base64');
            headers['Content-Length'] = String(body.length);
            return new Response(body, { headers });
        }
        return new Response(raw, { headers });
    } });
    var progress: { downloaded: number; total: number; message: string }[] = [];
    try {
        var bootstrap = async function () {
            return { executable: executable!, packagePath, release: fixture.release, target: 'macosx-27.0-arm64' };
        } as typeof bootstrapEngine;
        var connect: typeof engineSession = async function (license, signal, onProgress) {
            var session = await engineSession(license, signal, onProgress, bootstrap);
            var request = session.request;
            session.request = async function (operation, fields = {}) {
                if (operation === 'models') {
                    fields = { ...fields, options: { server_url: 'http://127.0.0.1:' + server.port + '/license', public_key: fixture.publicKey } };
                }
                return request(operation, fields);
            };
            return session;
        };
        var result = await downloadModel({ license: 'ISOLATED-TEST-LICENSE', modelId: 'fixture', modelName: 'Fixture',
            root: join(directory, 'models', 'fixture'), signal: new AbortController().signal, connect,
            onProgress: function (value) { progress.push(value); } });
        expect(result.path).toContain('model-r1');
        var completedBytes = 0;
        for (var event of progress) {
            if (event.total > 0) {
                expect(event.downloaded).toBeGreaterThanOrEqual(completedBytes);
                completedBytes = event.downloaded;
            }
        }
        expect(completedBytes).toBeGreaterThan(1024 * 1024);
        var confirmed = false;
        for (var event of progress) {
            if (event.message === 'Confirming the installation.') { confirmed = true; }
        }
        expect(confirmed).toBe(true);
        expect(requests).toContain('complete');
        expect((await installedModels({ operation: 'list' }, directory))[0]?.engineVersion).toBe('0.4.2');
        expect(await installedModels({ operation: 'delete', id: 'fixture' }, directory)).toEqual([]);
    } finally {
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
    }
}, 60000);
