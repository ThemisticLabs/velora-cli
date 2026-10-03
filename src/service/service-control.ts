import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IS_COMPILED } from '../system/build-mode.js';
import dataDirectory from '../system/data-directory.js';
import serviceRequest, { type ServiceStatus } from './service-request.js';
import servicePaths, { LAUNCH_TIMEOUT_MS, START_TIMEOUT_MS } from './service-paths.js';

export type ServiceLaunch = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export default async function serviceControl(operation: 'start' | 'status' | 'stop', directory = dataDirectory(), launch: ServiceLaunch = spawn): Promise<ServiceStatus> {
    var paths = servicePaths(directory);
    if (operation !== 'start') {
        return serviceRequest(operation, paths.directory);
    }
    var status = await serviceRequest('status', paths.directory);
    if (status.state === 'running') { return status; }
    if (status.state === 'failed') {
        throw new Error(status.message);
    }
    var child: ChildProcess | undefined;
    var launchFailed = false;
    var waitingForModel = status.state === 'starting';
    var deadline = Date.now() + START_TIMEOUT_MS;
    if (!waitingForModel) {
        deadline = Date.now() + LAUNCH_TIMEOUT_MS;
        var args = ['--service-worker', paths.directory];
        if (!IS_COMPILED) {
            args.unshift(fileURLToPath(new URL('../cli.ts', import.meta.url)));
            args.unshift('run');
        }
        child = launch(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', function () { launchFailed = true; });
        child.unref();
    }
    var START_POLL_MS = 50;
    try {
        while (Date.now() < deadline) {
            if (launchFailed) {
                throw new Error('Could not launch the velora service. Check executable permissions.');
            }
            status = await serviceRequest('status', paths.directory);
            if (status.state === 'running') { return status; }
            if (status.state === 'failed') { throw new Error(status.message); }
            if (status.state === 'starting' && !waitingForModel) {
                waitingForModel = true;
                deadline = Date.now() + START_TIMEOUT_MS;
            }
            await Bun.sleep(START_POLL_MS);
        }
        throw new Error('The velora service could not start. Check storage and executable permissions, then try again.');
    } catch (error) {
        child?.kill();
        throw error;
    }
}
