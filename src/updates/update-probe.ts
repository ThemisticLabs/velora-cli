import DownloadError from '../downloads/download-error.js';
import { spawn } from 'node:child_process';
import { MAX_HELPER_OUTPUT_BYTES } from './update-contract.js';

export default async function updateProbe(executable: string, version: string, directory: string): Promise<void> {
    var child = spawn(executable, ['--self-test', directory], { stdio: ['ignore', 'pipe', 'ignore'] });
    var SELF_TEST_TIMEOUT_MS = 20000;
    await new Promise<void>(function (resolve, reject) {
        var output = '';
        var timedOut = false;
        var timer = setTimeout(function () {
            timedOut = true;
            child.kill('SIGKILL');
        }, SELF_TEST_TIMEOUT_MS);
        child.stdout.on('data', function (bytes) {
            output += bytes.toString();
            if (output.length > MAX_HELPER_OUTPUT_BYTES) {
                child.kill('SIGKILL');
            }
        });
        child.once('error', function () {
            clearTimeout(timer);
            reject(new DownloadError('The new version could not start.'));
        });
        child.once('close', function (code) {
            clearTimeout(timer);
            if (timedOut) {
                reject(new DownloadError('The new version did not complete its self-test.'));
                return;
            }
            if (code !== 0 || output.trim() !== 'velora self-test ' + version) {
                reject(new DownloadError('The new version failed its self-test.'));
                return;
            }
            resolve();
        });
    });
}
