import serviceControl from '../../src/service/service-control.js';
var operation = process.argv[2];
var directory = process.argv[3];
if (!directory || !['start', 'status', 'stop'].includes(operation || '')) {
    throw new Error('Invalid fixture arguments');
}
var result = await serviceControl(operation as 'start' | 'status' | 'stop', directory);
process.stdout.write(JSON.stringify(result) + '\n');
