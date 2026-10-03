import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manageApiKeys from '../../src/menu/api-keys.js';
import apiKeys from '../../src/api/api-keys.js';

var scenario = process.argv[2];
var directory = await mkdtemp(join(tmpdir(), 'velora-key-menu-'));
var copies = 0;
try {
    if (scenario === 'revoke' || scenario === 'cancel-revoke') {
        await apiKeys({ operation: 'create', name: 'Existing app', note: 'Keep until revoked' }, directory);
    }
    await manageApiKeys(directory, async function (key) {
        copies++;
        if (scenario === 'slow-clipboard') { await Bun.sleep(500); }
        assert.match(key, /^velora_[A-Za-z0-9_-]{43}$/);
        assert.equal((await apiKeys({ operation: 'verify', key }, directory)).authorized, true);
        if (scenario === 'clipboard-throws') { throw new Error('Clipboard unavailable'); }
        return scenario !== 'clipboard';
    });
    var stored = await apiKeys({ operation: 'list' }, directory);
    if (scenario === 'cancel' || scenario === 'revoke') { assert.equal(stored.keys.length, 0); }
    else { assert.equal(stored.keys.length, 1); }
    if (scenario === 'create' || scenario === 'slow-clipboard' || scenario === 'required' || scenario === 'clipboard' || scenario === 'clipboard-throws' || scenario === 'resize') {
        assert.equal(stored.keys[0]?.name, 'Editor');
        assert.equal(stored.keys[0]?.note, 'My local app');
        assert.equal(copies, 1);
    }
    process.stdout.write('API keys verified.\n');
} finally { await rm(directory, { recursive: true, force: true }); }
