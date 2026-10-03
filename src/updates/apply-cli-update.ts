import { lstat, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import updateState, { type UpdateState } from './update-state.js';
import updateFile from './update-file.js';
import updateProbe from './update-probe.js';
import syncDirectory from '../system/sync-directory.js';

export default async function applyCliUpdate(planPath: string, repair = false): Promise<void> {
    var workdir = dirname(planPath);
    if (basename(planPath) !== 'plan.json' || !basename(workdir).startsWith('.velora-update-') || !(await lstat(workdir)).isDirectory()) {
        throw new Error('Invalid update workspace.');
    }
    var planFile = await lstat(planPath);
    if (!planFile.isFile() || planFile.size > 8192) { throw new Error('Invalid update plan.'); }
    var plan: UpdateState = JSON.parse(await readFile(planPath, 'utf8'));
    if (typeof plan.target !== 'string') { throw new Error('Invalid update target.'); }
    var state = await updateState(plan.target);
    if (!state || state.workdir !== workdir || state.target !== plan.target || state.version !== plan.version ||
        state.previousHash !== plan.previousHash || state.nextHash !== plan.nextHash) { throw new Error('Update state does not match the prepared plan.'); }
    var lockPath = plan.target + '.update.lock';
    if (!(await lstat(lockPath)).isFile() || await readFile(lockPath, 'utf8') !== planPath) { throw new Error('The update lock does not match this transaction.'); }
    state.workerPid = process.pid;
    await updateState(state.target, state);
    process.stdout.write('ready\n');
    var WAIT_FOR_PARENT_MS = 60000;
    var started = Date.now();
    while (true) {
        try { process.kill(state.parentPid, 0); }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') { break; }
            throw error;
        }
        if (Date.now() - started > WAIT_FOR_PARENT_MS) { throw new Error('The previous process has not closed.'); }
        await Bun.sleep(100);
    }
    var candidate = join(workdir, 'candidate');
    if (process.platform === 'win32') { candidate += '.exe'; }
    var backup = join(workdir, 'previous');
    var replacement = join(workdir, 'replacement');
    try {
        if (!repair) {
            if (await updateFile(state.target) !== state.previousHash || await updateFile(candidate) !== state.nextHash) {
                throw new Error('The executable changed after the update was prepared.');
            }
            await updateFile(state.target, backup);
            await syncDirectory(workdir);
            if (await updateFile(backup) !== state.previousHash) { throw new Error('The update backup failed its checksum.'); }
            await updateState(state.target, { ...state, phase: 'installing', workerPid: process.pid });
            await updateFile(candidate, replacement);
            await rename(replacement, state.target);
            await syncDirectory(dirname(state.target));
            await updateProbe(state.target, state.version, state.dataDirectory);
            await updateState(state.target, { ...state, phase: 'installed', workerPid: process.pid });
        } else {
            throw new Error('Recovering an interrupted installation.');
        }
    } catch {
        try {
            var currentHash = '';
            try { currentHash = await updateFile(state.target); } catch {}
            if (currentHash && currentHash !== state.previousHash && currentHash !== state.nextHash) { throw new Error('The executable was replaced outside this update.'); }
            if (currentHash !== state.previousHash) {
                if (await updateFile(backup) !== state.previousHash) { throw new Error('Invalid update backup.'); }
                await rm(replacement, { force: true });
                await updateFile(backup, replacement);
                await rename(replacement, state.target);
                await syncDirectory(dirname(state.target));
            }
            await updateState(state.target, { ...state, phase: 'restored', workerPid: process.pid });
        } catch {
            await updateState(state.target, { ...state, phase: 'failed', workerPid: process.pid });
        }
    } finally {
        await rm(lockPath, { force: true });
        await syncDirectory(dirname(state.target));
    }
}
