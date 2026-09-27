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
        result = { version: '0.4.1', engine_api: 1, protocol: 'json-lines-v1' };
        if (scenario === 'old version') { result.version = '0.4.0'; }
    }
    if (request.operation === 'models') {
        result = { status: 'ok', models: [] };
    }
    if (scenario === 'wrong id') { request.id++; }
    if (scenario === 'error' && request.operation === 'models') {
        process.stderr.write('PRIVATE-DIAGNOSTIC\n');
        process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: 'download_or_verification_failed' }) + '\n');
        continue;
    }
    var output = '';
    if (scenario === 'progress' && request.operation === 'install') {
        output += JSON.stringify({ id: request.id, event: 'progress', phase: 'download', downloaded_bytes: 1, total_bytes: 2 }) + '\n';
        output += JSON.stringify({ id: request.id, event: 'progress', phase: 'verify' }) + '\n';
    }
    output += JSON.stringify({ id: request.id, ok: true, result }) + '\n';
    process.stdout.write(output);
}
