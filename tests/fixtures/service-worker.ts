import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import apiServer from '../../src/api/api-server.js';
import serviceWorker from '../../src/service/service-worker.js';

var directory = process.argv[2]!;
await serviceWorker(directory, async function () {
    if (await Bun.file(join(directory, 'delay-engine')).exists()) { await Bun.sleep(400); }
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
}, function (path, getEngine) { return apiServer(path, getEngine, 0); });
