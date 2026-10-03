import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import serviceWorker from '../../src/service/service-worker.js';

var directory = process.argv[2]!;
await serviceWorker(directory, async function () {
    var resolveExit: () => void;
    var exited = new Promise<void>(function (resolve) { resolveExit = resolve; });
    return {
        model: 'model-a', engineVersion: '0.4.4', exited,
        request: async function () { return {}; },
        close: async function () {
            await writeFile(join(directory, 'engine-closed'), 'closed');
            resolveExit();
        }
    };
});
