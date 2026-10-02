import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import bootstrapEngine from '../src/engine/bootstrap-engine.js';
import engineSession from '../src/engine/engine-session.js';
import licenseStore from '../src/license/license-store.js';
import installedModels, { type InstalledModel } from '../src/models/installed-models.js';
import DownloadError from '../src/downloads/download-error.js';

var directoryArgument = process.argv[2];
if (!directoryArgument) {
    process.stderr.write('Usage: bun run scripts/check-inference.ts <installed data directory>\n');
    process.exit(1);
}

var directory = resolve(directoryArgument);
var CHECK_TIMEOUT_MS = 120000;
var signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
var TEXT = 'Anna Müller wohnt in Berlin. Anna Müller schreibt an anna.mueller@example.com.';

try {
    await access(join(directory, 'engine', 'bootstrap.json'));
    var models = await installedModels({ operation: 'list' }, directory);
    var model: InstalledModel | undefined;
    for (var entry of models) {
        if (entry.selected) { model = entry; break; }
    }
    assert(model, 'Select an installed model before running this check.');
    var license = await licenseStore({ operation: 'read' });
    assert(license, 'Save a license before running this check.');
    var session = await engineSession(license, signal, undefined, function (key, operationSignal, progress) {
        return bootstrapEngine(key, operationSignal, progress, { directory, transport: Object.assign(async function () {
            throw new DownloadError('This check requires an already installed engine.');
        }, { preconnect: function () {} }) });
    });
    try {
        var loaded = await session.request('load', {
            model: join(directory, 'models', model.id, 'installed', model.id, model.revision),
            options: { license_key: license }
        });
        assert.equal(loaded.model_id, model.id);
        var result = await session.request('predict', { text: TEXT });
        assert.equal(typeof result.placeholder_text, 'string');
        assert(result.mapping && typeof result.mapping === 'object' && !Array.isArray(result.mapping));
        var originals = new Map<string, string>();
        var mapping = result.mapping as Record<string, unknown>;
        for (var [id, value] of Object.entries(mapping)) {
            assert(value && typeof value === 'object' && 'text' in value && typeof value.text === 'string');
            assert('label' in value && typeof value.label === 'string');
            assert('occurrences' in value && Array.isArray(value.occurrences));
            originals.set(value.label + ':' + id, value.text);
            for (var occurrence of value.occurrences) {
                assert(Number.isSafeInteger(occurrence.start) && Number.isSafeInteger(occurrence.end));
                assert(occurrence.start >= 0 && occurrence.end > occurrence.start && occurrence.end <= TEXT.length);
                assert.equal(TEXT.slice(occurrence.start, occurrence.end), value.text);
            }
        }
        assert(originals.size > 0, 'The synthetic input should contain recognized entities.');
        var restored = (result.placeholder_text as string).replace(/\[([A-Z_]+:\d+)\]/g, function (_placeholder, identity: string) {
            var original = originals.get(identity);
            assert(original !== undefined, 'A placeholder has no mapping entry.');
            return original;
        });
        assert.equal(restored, TEXT);
        var empty = await session.request('predict', { text: '' });
        assert.equal(empty.placeholder_text, '');
        assert.deepEqual(empty.mapping, {});
        var shutdown = await session.request('shutdown');
        assert.equal(shutdown.unloaded, true);
        process.stdout.write(JSON.stringify({ engine: loaded.engine_version, model: loaded.model_id,
            input: TEXT, output: result.placeholder_text, mapping: result.mapping,
            schema: result.output_schema, roundTrip: true, emptyInput: true, shutdown: true }, null, 2) + '\n');
    } finally {
        await session.close();
    }
} catch (error) {
    var message = 'Inference check failed. Inspect the engine and selected model installation.';
    if (error instanceof DownloadError) { message = error.message; }
    if (error instanceof assert.AssertionError) { message = 'Inference result did not pass the mapping or protocol checks.'; }
    process.stderr.write(message + '\n');
    process.exitCode = 1;
}
