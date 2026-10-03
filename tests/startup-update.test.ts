import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import startupUpdate from '../src/updates/startup-update.js';

test.each(['missing', 'unset', 'allowed', 'denied', 'legacy', 'invalid'])('startup uses existing consent without prompting: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-consent-'));
    var path = join(directory, 'cli-updates.json');
    var requests = 0;
    try {
        if (scenario === 'unset') { await writeFile(path, '{"checkAutomatically":null,"installAutomatically":null}'); }
        if (scenario === 'allowed') { await writeFile(path, '{"checkAutomatically":true,"installAutomatically":false}'); }
        if (scenario === 'denied') { await writeFile(path, '{"checkAutomatically":false,"installAutomatically":false}'); }
        if (scenario === 'legacy') { await writeFile(path, '{"checkAutomatically":true}'); }
        if (scenario === 'invalid') { await writeFile(path, '{'); }
        var before = await readFile(path, 'utf8').catch(function () { return null; });
        await startupUpdate(new AbortController().signal, directory, async function () { requests++; return null; });
        expect(requests).toBe(Number(scenario === 'allowed' || scenario === 'legacy'));
        expect(await readFile(path, 'utf8').catch(function () { return null; })).toBe(before);
        if (scenario === 'missing') { expect(await readdir(directory)).toEqual([]); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test.each(['install', 'manual', 'failure', 'cancel'])('startup installs only with saved consent: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-auto-install-'));
    try {
        await writeFile(join(directory, 'cli-updates.json'), JSON.stringify({ checkAutomatically: true, installAutomatically: scenario !== 'manual' }));
        var controller = new AbortController();
        var installed = '';
        var completed = await startupUpdate(controller.signal, directory, async function () { return '1.0.0'; }, async function (version) {
            installed = version;
            if (scenario === 'failure') { throw new Error('Download failed'); }
            if (scenario === 'cancel') { controller.abort(); controller.signal.throwIfAborted(); }
        }).catch(function (error) { if (scenario !== 'cancel') { throw error; } return 'cancelled'; });
        if (scenario === 'manual') { expect(installed).toBe(''); }
        else { expect(installed).toBe('1.0.0'); }
        if (scenario === 'install') { expect(completed).toBe(true); }
        if (scenario === 'cancel') { expect(completed).toBe('cancelled'); }
        if (scenario === 'failure') { expect(completed).toBeUndefined(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
});
