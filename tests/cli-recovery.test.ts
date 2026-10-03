import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import recoverCliUpdate from '../src/updates/recover-cli-update.js';
import updateState, { type UpdateState } from '../src/updates/update-state.js';
import directoryLock from '../src/system/directory-lock.js';
import updatePaths from '../src/updates/update-paths.js';
import { UPDATE_LOCK_SUFFIX } from '../src/updates/update-contract.js';

var SCENARIOS = ['absent', 'installed', 'restored', 'failed', 'recover', 'launch-failure', 'bad-candidate', 'busy', 'legacy-lock'];
test.each(SCENARIOS)('startup recovery handles lock ownership: %s', async function (scenario) {
    var root = await mkdtemp(join(tmpdir(), 'velora-recovery-'));
    try {
        var target = join(root, 'fixture');
        await writeFile(target, 'original fixture');
        target = await realpath(target);
        var workdir = await mkdtemp(join(root, '.velora-update-'));
        workdir = await realpath(workdir);
        var paths = updatePaths(workdir);
        var candidate = 'candidate fixture';
        await writeFile(paths.candidate, candidate);
        var phase: UpdateState['phase'] = 'prepared';
        if (scenario === 'installed' || scenario === 'restored' || scenario === 'failed') { phase = scenario; }
        var state: UpdateState = {
            phase, workdir, target, version: '1.0.0', previousVersion: '0.0.1',
            previousHash: createHash('sha256').update('original fixture').digest('hex'),
            nextHash: createHash('sha256').update(candidate).digest('hex'),
            dataDirectory: root, parentPid: 2147483647, workerPid: 2147483647
        };
        if (scenario !== 'absent') { await updateState(target, state); }
        var lockPath = target + UPDATE_LOCK_SUFFIX;
        if (scenario === 'legacy-lock') {
            await writeFile(lockPath, paths.plan);
        } else if (scenario === 'busy') {
            await directoryLock({ operation: 'acquire', path: lockPath });
        } else {
            await mkdir(lockPath);
            await writeFile(join(lockPath, randomUUID() + '.json'), JSON.stringify({ token: randomUUID(), pid: 2147483647 }));
        }
        if (scenario === 'bad-candidate') { await writeFile(paths.candidate, 'corrupted fixture'); }
        var launched = false;
        var options = { executable: target, launch: async function (executable: string, plan: string, repair?: boolean): Promise<number> {
            launched = true;
            expect(executable).toBe(paths.candidate);
            expect(plan).toBe(paths.plan);
            expect(repair).toBe(true);
            var saved = await updateState(target);
            expect(saved?.parentPid).toBe(process.pid);
            expect(saved?.workerPid).toBe(0);
            expect(saved?.lockToken).toMatch(/^[a-f0-9-]{36}$/);
            if (scenario === 'launch-failure') { throw new Error('Fixture launch failed'); }
            return process.pid;
        } };
        if (scenario === 'launch-failure' || scenario === 'bad-candidate' || scenario === 'legacy-lock') {
            await expect(recoverCliUpdate(options)).rejects.toThrow();
        } else {
            var result = await recoverCliUpdate(options);
            expect(result.stop).toBe(scenario === 'recover' || scenario === 'busy');
            if (scenario === 'restored') { expect(result.message).toContain('restored'); }
            if (scenario === 'failed') { expect(result.message).toContain('could not be recovered'); }
        }
        expect(launched).toBe(scenario === 'recover' || scenario === 'launch-failure');
        expect(await readFile(target, 'utf8')).toBe('original fixture');
        var remaining = await readdir(root);
        if (scenario === 'recover' || scenario === 'busy' || scenario === 'legacy-lock') {
            expect(remaining).toContain('fixture' + UPDATE_LOCK_SUFFIX);
        } else {
            expect(remaining).not.toContain('fixture' + UPDATE_LOCK_SUFFIX);
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
