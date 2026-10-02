import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';

var scenario = process.env.VELORA_TEST_ENGINE_SCENARIO;
for await (var line of createInterface({ input: process.stdin })) {
    var request = JSON.parse(line);
    if (scenario === 'exit') { process.exit(0); }
    if (scenario === 'hang') { await new Promise(function () {}); }
    if (scenario === 'oversized') {
        process.stdout.write('x'.repeat(2 * 1024 ** 2 + 1));
        continue;
    }
    if (scenario === 'malformed') { process.stdout.write('not-json\n'); continue; }
    var result: Record<string, unknown> = {};
    if (request.operation === 'version') {
        result = { version: '0.4.1', engine_api: 1, protocol: 'json-lines-v1', capabilities: ['install_model'] };
        if (scenario === 'no capability') { delete result.capabilities; }
        if (scenario === 'old version') { result.version = '0.4.0'; }
    }
    if (request.operation === 'models') {
        result = { status: 'ok', models: [] };
    }
    if (scenario === 'wrong id') { request.id++; }
    if (scenario === 'error' && request.operation === 'models') {
        var DIAGNOSTIC_BYTES = 4 * 1024 ** 2;
        process.stderr.write('PRIVATE-DIAGNOSTIC\n' + 'x'.repeat(DIAGNOSTIC_BYTES));
        process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: 'download_or_verification_failed' }) + '\n');
        continue;
    }
    if (scenario?.startsWith('install-') && request.operation === 'install_model') {
        assert.equal(request.model_id, 'model-a');
        assert.equal(request.progress, true);
        assert.equal(typeof request.engine_package, 'string');
        assert.equal(typeof request.engine_runtime, 'string');
        var root = join(request.root, request.model_id);
        var path = join(root, 'installed', request.model_id, 'r1');
        await mkdir(path, { recursive: true });
        await writeFile(join(root, 'current.json'), JSON.stringify({ model_id: request.model_id, revision: 'r1', sequence: 1 }));
        result = { model_id: request.model_id, model_version: '1', engine_version: '0.4.1', engine_changed: false,
            files_verified: true, path, receipt: { model_id: request.model_id, model_revision: 'r1',
                engine_revision: 'engine-r1', license_authorized: scenario === 'install-valid', reported_hashes_match: true } };
    }
    var output = '';
    if ((scenario === 'progress' || scenario?.startsWith('install-')) && request.operation === 'install_model') {
        output += JSON.stringify({ id: request.id, event: 'progress', phase: 'download', downloaded_bytes: 1, total_bytes: 2 }) + '\n';
        output += JSON.stringify({ id: request.id, event: 'progress', phase: 'verify' }) + '\n';
    }
    output += JSON.stringify({ id: request.id, ok: true, result }) + '\n';
    process.stdout.write(output);
}
