import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import startupUpdate from '../src/updates/startup-update.js';

test.each(['yes', 'no', 'manual', 'saved yes', 'saved no', 'legacy yes', 'invalid JSON', 'invalid permission', 'invalid installation', 'cancel', 'cancel installation', 'save failure'])('startup update consent: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-consent-'));
    var path = join(root, 'cli-updates.json');
    var prompts: string[] = [];
    var requests = 0;
    var controller = new AbortController();
    try {
        var choose: Parameters<typeof startupUpdate>[2] = async function (config) {
            prompts.push(config.message);
            expect(requests).toBe(0);
            expect(config.choices[0]?.value).toBe('no');
            if (scenario === 'cancel' || scenario === 'cancel installation' && prompts.length === 2) {
                controller.abort();
                throw controller.signal.reason;
            }
            if (scenario === 'save failure' && prompts.length === 2) {
                await rm(root, { recursive: true });
                await writeFile(root, 'not a directory');
            }
            if (scenario === 'no' || scenario === 'manual' && prompts.length === 2) {
                return 'no';
            }
            return 'yes';
        };
        var check: Parameters<typeof startupUpdate>[3] = async function () {
            requests++;
            expect(JSON.parse(await readFile(path, 'utf8')).checkAutomatically).toBe(true);
            return null;
        };
        await startupUpdate(controller.signal, root, choose, check);
        expect(prompts).toEqual([]);
        expect(requests).toBe(0);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: null, installAutomatically: null });
        if (scenario === 'saved yes' || scenario === 'saved no') {
            await writeFile(path, JSON.stringify({ checkAutomatically: scenario === 'saved yes', installAutomatically: false }));
        }
        if (scenario === 'legacy yes') {
            await writeFile(path, '{"checkAutomatically":true}');
        }
        if (scenario === 'invalid JSON') {
            await writeFile(path, '{');
        }
        if (scenario === 'invalid permission') {
            await writeFile(path, '{"checkAutomatically":"true"}');
        }
        if (scenario === 'invalid installation') {
            await writeFile(path, '{"checkAutomatically":false,"installAutomatically":true}');
        }
        var operation = startupUpdate(controller.signal, root, choose, check);
        if (scenario.startsWith('cancel')) {
            await expect(operation).rejects.toThrow();
            expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ checkAutomatically: null, installAutomatically: null });
            expect(requests).toBe(0);
            return;
        }
        await operation;
        var enabled = ['yes', 'manual', 'saved yes', 'legacy yes'].includes(scenario);
        expect(requests).toBe(Number(enabled));
        if (scenario === 'yes' || scenario === 'no' || scenario === 'manual' || scenario === 'legacy yes') {
            var expectedPrompts = 2;
            if (scenario === 'no' || scenario === 'legacy yes') {
                expectedPrompts = 1;
            }
            expect(prompts.length).toBe(expectedPrompts);
            expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
                checkAutomatically: enabled, installAutomatically: scenario === 'yes' || scenario === 'legacy yes'
            });
            expect(await readdir(root)).toEqual(['cli-updates.json']);
            await startupUpdate(controller.signal, root, choose, check);
            expect(prompts.length).toBe(expectedPrompts);
            expect(requests).toBe(Number(enabled) * 2);
        }
        if (scenario.startsWith('saved') || scenario.startsWith('invalid')) {
            expect(prompts).toEqual([]);
        }
        if (scenario === 'legacy yes') {
            expect(prompts[0]).toBe('Allow automatic velora updates?');
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.each(['install', 'manual', 'failure', 'cancel'])('startup installs only with saved consent: %s', async function (scenario) {
    var directory = await mkdtemp(join(tmpdir(), 'velora-auto-install-'));
    try {
        await writeFile(join(directory, 'cli-updates.json'), JSON.stringify({ checkAutomatically: true, installAutomatically: scenario !== 'manual' }));
        var controller = new AbortController();
        var installed = '';
        var completed = await startupUpdate(controller.signal, directory, async function () { throw new Error('Unexpected prompt'); }, async function () { return '1.0.0'; }, async function (version) {
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
