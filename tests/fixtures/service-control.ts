import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import serviceControl from '../../src/service/service-control.js';
var operation = process.argv[2];
var directory = process.argv[3];
if (!directory || !['start', 'status', 'stop'].includes(operation || '')) {
    throw new Error('Invalid fixture arguments');
}
var result = await serviceControl(operation as 'start' | 'status' | 'stop', directory, function (_command, args, options) {
    return spawn(process.execPath, ['run', fileURLToPath(new URL('./service-worker.ts', import.meta.url)), args.at(-1)!], options);
});
process.stdout.write(JSON.stringify(result) + '\n');
