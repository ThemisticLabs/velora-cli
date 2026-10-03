import { IS_COMPILED } from '../system/build-mode.js';
import { realpath } from 'node:fs/promises';
import directoryLock, { type DirectoryLease } from '../system/directory-lock.js';
import { UPDATE_LOCK_SUFFIX } from './update-contract.js';
import updatePaths from './update-paths.js';
import updateFile from './update-file.js';
import updateState from './update-state.js';
import launchUpdateWorker from './launch-update-worker.js';

type Options = { executable?: string; launch?: typeof launchUpdateWorker };

export default async function recoverCliUpdate(options: Options = {}): Promise<{ stop: boolean; message: string }> {
    if (!options.executable && !IS_COMPILED) { return { stop: false, message: '' }; }
    var target = await realpath(options.executable || process.execPath);
    var lockPath = target + UPDATE_LOCK_SUFFIX;
    var lease: DirectoryLease | undefined;
    var launched = false;
    try {
        while (true) {
            var state = await updateState(target);
            if (!state || ['installed', 'restored', 'failed'].includes(state.phase)) {
                await directoryLock({ operation: 'clean', path: lockPath });
                var message = '';
                if (state?.phase === 'restored') {
                    message = 'The previous velora version was restored after an unsuccessful update.';
                }
                if (state?.phase === 'failed') {
                    message = 'The update could not be recovered. Keep the files in ' + state.workdir + ' and check the previous executable before restoring it.';
                }
                return { stop: false, message };
            }
            if (lease) { break; }
            try {
                lease = await directoryLock({ operation: 'acquire', path: lockPath });
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
                    return { stop: true, message: 'A velora update is being installed. Wait a moment, then start velora again.' };
                }
                throw error;
            }
        }
        var paths = updatePaths(state.workdir);
        if (await updateFile(paths.candidate) !== state.nextHash) {
            throw new Error('The recovery executable failed its checksum. Keep the backup.');
        }
        await updateState(target, { ...state, parentPid: process.pid, workerPid: 0, lockToken: lease.token });
        var launch = options.launch || launchUpdateWorker;
        await launch(paths.candidate, paths.plan, true);
        launched = true;
        return { stop: true, message: 'An interrupted velora update is being recovered. Start velora again in a moment.' };
    } finally {
        if (lease && !launched) {
            await directoryLock({ operation: 'release', path: lockPath, lease });
        }
    }
}
