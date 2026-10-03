import serviceControl from '../service/service-control.js';

export default async function serviceCommand(operation: 'start' | 'status' | 'stop'): Promise<void> {
    try {
        var status = await serviceControl(operation);
        var message = 'velora service stopped.';
        if (status.state === 'running') {
            message = 'velora service ready. Model ' + status.model + ' · Engine ' + status.engineVersion + '. Local API http://127.0.0.1:' + status.port + '.';
        }
        if (status.state === 'starting') { message = 'velora service starting. Loading the selected model.'; }
        if (status.state === 'stopping') { message = 'velora service stopping. Waiting for the active request to finish.'; }
        if (status.state === 'failed') { message = 'velora service failed. ' + status.message; }
        process.stdout.write(message + '\n');
    } catch (error) {
        var message = 'Could not control the velora service. Check storage permissions and try again.';
        if (error instanceof Error) { message = error.message; }
        process.stderr.write(message + '\n');
        process.exitCode = 1;
    }
}
