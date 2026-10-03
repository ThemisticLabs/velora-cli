import applyCliUpdate from '../../src/updates/apply-cli-update.js';
import { basename } from 'node:path';

if (process.argv[2] === '--self-test') {
    if (basename(process.execPath).startsWith('reject-installed')) { process.exit(1); }
    process.stdout.write('velora self-test 1.0.0\n');
    process.exit(0);
}
if (process.argv[2] === '--finish-update' && process.argv[3]) {
    await applyCliUpdate(process.argv[3], process.argv[4] === '--restore');
    process.exit(0);
}
process.exit(1);
