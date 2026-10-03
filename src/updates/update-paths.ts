import { join } from 'node:path';
import { UPDATE_PLAN_NAME } from './update-contract.js';

export default function updatePaths(workdir: string): { candidate: string; plan: string; backup: string; replacement: string } {
    var candidateName = 'candidate';
    if (process.platform === 'win32') {
        candidateName += '.exe';
    }
    return {
        candidate: join(workdir, candidateName),
        plan: join(workdir, UPDATE_PLAN_NAME),
        backup: join(workdir, 'previous'),
        replacement: join(workdir, 'replacement')
    };
}
