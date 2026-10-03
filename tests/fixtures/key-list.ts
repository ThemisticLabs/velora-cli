import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manageApiKeys from '../../src/menu/api-keys.js';
import apiKeys from '../../src/api/api-keys.js';

var directory = await mkdtemp(join(tmpdir(), 'velora-full-key-list-'));
try {
    for (var index = 0; index < 10; index++) {
        var note = '';
        if (index % 3 === 1) { note = 'Short note for Key ' + index; }
        if (index % 3 === 2) { note = 'Long note with enough words to fill the preview. '.repeat(5); }
        await apiKeys({ operation: 'create', name: 'Key ' + index, note }, directory);
    }
    await manageApiKeys(directory);
    process.stdout.write('Full key list verified.\n');
} finally { await rm(directory, { recursive: true, force: true }); }
