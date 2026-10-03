import { lstat, readFile, rename, rm } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import updateState, { type UpdateState } from './update-state.js';
import updateFile from './update-file.js';
import updateProbe from './update-probe.js';
import updatePaths from './update-paths.js';
import { MAX_UPDATE_STATE_BYTES, UPDATE_LOCK_SUFFIX, UPDATE_PLAN_NAME, UPDATE_WORKSPACE_PREFIX } from './update-contract.js';
import syncDirectory from '../system/sync-directory.js';
import directoryLock from '../system/directory-lock.js';

export default async function applyCliUpdate(planPath: string, repair = false): Promise<void> {
    var workdir = dirname(planPath);
    if (basename(planPath) !== UPDATE_PLAN_NAME || !basename(workdir).startsWith(UPDATE_WORKSPACE_PREFIX) || !(await lstat(workdir)).isDirectory()) {
        throw new Error('Invalid update workspace.');
    }
    var planFile = await lstat(planPath);
    if (!planFile.isFile() || planFile.size > MAX_UPDATE_STATE_BYTES) {
        throw new Error('Invalid update plan.');
    }
    var plan: UpdateState = JSON.parse(await readFile(planPath, 'utf8'));
    if (typeof plan.target !== 'string') {
        throw new Error('Invalid update target.');
    }
    var state = await updateState(plan.target);
    if (!state || state.workdir !== workdir || state.target !== plan.target || state.version !== plan.version ||
        state.previousHash !== plan.previousHash || state.nextHash !== plan.nextHash || !state.lockToken || (!repair && state.lockToken !== plan.lockToken)) {
        throw new Error('Update state does not match the prepared plan.');
    }
    var lockPath = state.target + UPDATE_LOCK_SUFFIX;
    var lease = await directoryLock({ operation: 'acquire', path: lockPath, token: state.lockToken });
    try {
        state.workerPid = process.pid;
        await updateState(state.target, state);
        process.stdout.write('ready\n');
        var WAIT_FOR_PARENT_MS = 60000;
        var PARENT_POLL_MS = 100;
        var started = Date.now();
        while (true) {
            try {
                process.kill(state.parentPid, 0);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
                    break;
                }
                throw error;
            }
            if (Date.now() - started > WAIT_FOR_PARENT_MS) {
                throw new Error('The previous process has not closed.');
            }
            await Bun.sleep(PARENT_POLL_MS);
        }
        var paths = updatePaths(workdir);
        if (!repair) {
            try {
                if (await updateFile(state.target) !== state.previousHash || await updateFile(paths.candidate) !== state.nextHash) {
                    throw new Error('The executable changed after the update was prepared.');
                }
                await updateFile(state.target, paths.backup);
                await syncDirectory(workdir);
                if (await updateFile(paths.backup) !== state.previousHash) {
                    throw new Error('The update backup failed its checksum.');
                }
                await updateState(state.target, { ...state, phase: 'installing', workerPid: process.pid });
                var permissions = (await lstat(paths.backup)).mode & 0o777;
                await updateFile(paths.candidate, paths.replacement, permissions);
                await rename(paths.replacement, state.target);
                await syncDirectory(dirname(state.target));
                await updateProbe(state.target, state.version, state.dataDirectory);
                await updateState(state.target, { ...state, phase: 'installed', workerPid: process.pid });
                return;
            } catch {}
        }
        try {
            var currentHash = '';
            try {
                currentHash = await updateFile(state.target);
            } catch {}
            if (currentHash && currentHash !== state.previousHash && currentHash !== state.nextHash) {
                throw new Error('The executable was replaced outside this update.');
            }
            if (currentHash !== state.previousHash) {
                if (await updateFile(paths.backup) !== state.previousHash) {
                    throw new Error('Invalid update backup.');
                }
                await rm(paths.replacement, { force: true });
                await updateFile(paths.backup, paths.replacement);
                await rename(paths.replacement, state.target);
                await syncDirectory(dirname(state.target));
            }
            await updateState(state.target, { ...state, phase: 'restored', workerPid: process.pid });
        } catch {
            await updateState(state.target, { ...state, phase: 'failed', workerPid: process.pid });
        }
    } finally {
        await directoryLock({ operation: 'release', path: lockPath, lease });
    }
}
