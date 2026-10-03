import serviceControl from '../service/service-control.js';

export default async function serviceCommand(operation: 'start' | 'status' | 'stop'): Promise<void> {
    try {
        var status = await serviceControl(operation);
        var message = 'velora service stopped.';
        if (status.state === 'running') {
            message = 'velora service running. The local API is not connected yet.';
        }
        process.stdout.write(message + '\n');
    } catch (error) {
        var message = 'Could not control the velora service. Check storage permissions and try again.';
        if (error instanceof Error) { message = error.message; }
        process.stderr.write(message + '\n');
        process.exitCode = 1;
    }
}
