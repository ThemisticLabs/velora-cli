import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IS_COMPILED } from '../system/build-mode.js';
import dataDirectory from '../system/data-directory.js';
import serviceRequest, { type ServiceStatus } from './service-request.js';
import servicePaths, { START_TIMEOUT_MS } from './service-paths.js';

export default async function serviceControl(operation: 'start' | 'status' | 'stop', directory = dataDirectory()): Promise<ServiceStatus> {
    var paths = servicePaths(directory);
    if (operation !== 'start') {
        return serviceRequest(operation, paths.directory);
    }
    var status = await serviceRequest('status', paths.directory);
    if (status.state === 'running') { return status; }
    var args = ['--service-worker', paths.directory];
    if (!IS_COMPILED) {
        args.unshift(fileURLToPath(new URL('../cli.ts', import.meta.url)));
        args.unshift('run');
    }
    var child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
    var launchFailed = false;
    child.once('error', function () { launchFailed = true; });
    child.unref();
    var started = Date.now();
    var START_POLL_MS = 50;
    try {
        while (Date.now() - started < START_TIMEOUT_MS) {
            if (launchFailed) {
                throw new Error('Could not launch the velora service. Check executable permissions.');
            }
            status = await serviceRequest('status', paths.directory);
            if (status.state === 'running') { return status; }
            await Bun.sleep(START_POLL_MS);
        }
        throw new Error('The velora service could not start. Check storage and executable permissions, then try again.');
    } catch (error) {
        child.kill();
        throw error;
    }
}
