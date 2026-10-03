import { IS_COMPILED } from '../system/build-mode.js';
import { basename, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import updateFile from './update-file.js';
import updateState from './update-state.js';
import launchUpdateWorker from './launch-update-worker.js';

export default async function recoverCliUpdate(): Promise<{ stop: boolean; message: string }> {
    if (!IS_COMPILED) { return { stop: false, message: '' }; }
    var target = await realpath(process.execPath);
    var state = await updateState(target);
    if (!state) { return { stop: false, message: '' }; }
    if (state.phase === 'installed') { return { stop: false, message: '' }; }
    if (state.phase === 'restored') { return { stop: false, message: 'The previous velora version was restored after an unsuccessful update.' }; }
    if (state.phase === 'failed') { return { stop: false, message: 'The update could not be recovered. Keep the files in ' + state.workdir + ' and check the previous executable before restoring it.' }; }
    if (!basename(state.workdir).startsWith('.velora-update-')) { throw new Error('Invalid update recovery directory.'); }
    if (state.workerPid > 0) {
        try {
            process.kill(state.workerPid, 0);
            return { stop: true, message: 'A velora update is being installed. Wait a moment, then start velora again.' };
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) { throw error; }
        }
    }
    var candidate = join(state.workdir, 'candidate');
    if (process.platform === 'win32') { candidate += '.exe'; }
    if (await updateFile(candidate) !== state.nextHash) { throw new Error('The recovery executable failed its checksum. Keep the backup.'); }
    await updateState(target, { ...state, parentPid: process.pid, workerPid: 0 });
    await launchUpdateWorker(candidate, join(state.workdir, 'plan.json'), true);
    return { stop: true, message: 'An interrupted velora update is being recovered. Start velora again in a moment.' };
}
