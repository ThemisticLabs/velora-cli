import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { PackageRelease } from '../../src/downloads/package-release.js';
import { ZipFile } from 'yazl';

export default async function enginePackage(scenario = 'valid', engineVersion = '0.4.1', revision = 'engine-r1', sequence = 1) {
    var keys = generateKeyPairSync('ed25519');
    var publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    var content = Buffer.from('synthetic engine, never executed');
    var digest = createHash('sha256').update(content).digest('hex');
    var entrypoint = 'themistic-engine/themistic-engine';
    var item = { size: content.length, sha256: digest, executable: true };
    var inventory = { schema: 1, version: engineVersion, runtime_target: 'standalone-macos-arm64-14.0', files: { [entrypoint]: item } };
    var zip = new ZipFile();
    var bytes: Buffer[] = [];
    var ended = new Promise<void>(function (resolve, reject) {
        zip.outputStream.on('data', function (chunk) { bytes.push(chunk); });
        zip.outputStream.on('end', resolve);
        zip.outputStream.on('error', reject);
    });
    var mode = 0o100755;
    if (scenario === 'linked entry') {
        mode = 0o120777;
    }
    zip.addBuffer(content, entrypoint, { mode });
    if (scenario === 'extra entry') {
        zip.addBuffer(content, 'themistic-engine/extra', { mode });
    }
    zip.end();
    await ended;
    if (scenario === 'wrong inventory hash') {
        item.sha256 = '0'.repeat(64);
    }
    if (scenario === 'unsafe path') {
        inventory.files['themistic-engine/../outside'] = item;
    }
    var files: Record<string, Buffer> = {
        'inventory.json': Buffer.from(JSON.stringify(inventory)),
        ['themistic-engine-' + engineVersion + '-macos.zip']: Buffer.concat(bytes)
    };
    var hashes: Record<string, string> = {};
    for (var [name, raw] of Object.entries(files)) {
        hashes[name] = createHash('sha256').update(raw).digest('hex');
    }
    var manifest = { model_id: 'themistic-engine', version: engineVersion, engine_version: engineVersion, package_revision: revision,
        artifact_kind: 'engine', engine_api: 1, distribution: 'standalone-v1', runtime_target: inventory.runtime_target, files: hashes };
    if (scenario === 'wrong manifest') {
        manifest.runtime_target = 'standalone-windows-x64';
    }
    var manifestBytes = Buffer.from(JSON.stringify(manifest));
    files['manifest.json'] = manifestBytes;
    files['manifest.sig'] = sign(null, manifestBytes, keys.privateKey);
    if (scenario === 'bad manifest signature') {
        files['manifest.sig'] = Buffer.alloc(64);
    }
    var descriptors: Record<string, { size: number; sha256: string }> = {};
    for (var [name, raw] of Object.entries(files)) {
        descriptors[name] = { size: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
    }
    var release: PackageRelease & { notes: string; released_at: string; package_revision: string } = {
        ...manifest, artifact_kind: 'engine', distribution: 'standalone-v1',
        runtime_target: inventory.runtime_target, revision, sequence, enabled: true,
        notes: 'Isolated fixture', released_at: '2026-09-27T00:00:00Z', files: descriptors
    };
    var requests: Record<string, unknown>[] = [];
    var transport = async function (url: unknown, options?: RequestInit) {
        if (url !== 'https://api.themistic.com/license/engine') {
            throw new Error('Unexpected endpoint');
        }
        var request = JSON.parse(options?.body as string);
        if (request.hw !== undefined || request.model_id !== undefined || request.engine_api !== undefined) {
            throw new Error('Bootstrap must not send device or model fields');
        }
        requests.push(request);
        var metadata = { ...request, valid: true };
        if (request.operation === 'resolve') {
            metadata.engine = release;
            if (scenario === 'withdrawn' && requests.length > 1) {
                metadata.engine = null;
            }
        } else {
            metadata.size = files[request.name]!.length;
        }
        if (scenario === 'wrong nonce') {
            metadata.nonce = 'wrong';
        }
        if (scenario === 'wrong range' && request.operation === 'file') {
            metadata.offset++;
        }
        var raw = Buffer.from(JSON.stringify(metadata));
        var signature = sign(null, raw, keys.privateKey).toString('base64');
        if (scenario === 'bad response signature') {
            signature = Buffer.alloc(64).toString('base64');
        }
        if (request.operation === 'resolve') {
            return new Response(raw, { headers: { 'X-Signature': signature } });
        }
        var body = Buffer.from(files[request.name]!.subarray(request.offset, request.offset + request.length));
        if (scenario === 'wrong checksum') {
            body[0] = body[0]! ^ 1;
        }
        if (scenario === 'truncated') {
            body = body.subarray(1);
        }
        return new Response(body, { headers: { 'Content-Length': String(request.length),
            'X-Package-Response': raw.toString('base64'), 'X-Signature': signature } });
    };
    return { keys, publicKey, release, files, transport: transport as typeof fetch, requests };
}
