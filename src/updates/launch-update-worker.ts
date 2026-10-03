import DownloadError from '../downloads/download-error.js';
import { spawn } from 'node:child_process';
import { MAX_HELPER_OUTPUT_BYTES } from './update-contract.js';

export default async function launchUpdateWorker(executable: string, planPath: string, repair = false): Promise<number> {
    var args = ['--finish-update', planPath];
    if (repair) {
        args.push('--restore');
    }
    var child = spawn(executable, args, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    var START_TIMEOUT_MS = 5000;
    await new Promise<void>(function (resolve, reject) {
        var output = '';
        var timer = setTimeout(function () {
            child.kill('SIGKILL');
        }, START_TIMEOUT_MS);
        child.once('error', function () {
            clearTimeout(timer);
            reject(new DownloadError('Could not start the update helper.'));
        });
        child.once('close', function () {
            clearTimeout(timer);
            reject(new DownloadError('The update helper closed before it was ready.'));
        });
        child.stdout.on('data', function (bytes) {
            output += bytes.toString();
            if (output.length > MAX_HELPER_OUTPUT_BYTES) {
                child.kill('SIGKILL');
                return;
            }
            if (output === 'ready\n') {
                clearTimeout(timer);
                resolve();
            }
        });
    });
    child.stdout.destroy();
    child.unref();
    return child.pid!;
}
