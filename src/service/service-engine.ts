import { join } from 'node:path';
import licenseStore from '../license/license-store.js';
import installedModels from '../models/installed-models.js';
import engineSession from '../engine/engine-session.js';
import bootstrapEngine from '../engine/bootstrap-engine.js';
import DownloadError from '../downloads/download-error.js';

export type ServiceEngine = {
    model: string;
    engineVersion: string;
    request: Awaited<ReturnType<typeof engineSession>>['request'];
    close: () => Promise<void>;
    exited: Promise<void>;
};

export default async function serviceEngine(directory: string, signal: AbortSignal,
    services = { store: licenseStore, models: installedModels, connect: engineSession }): Promise<ServiceEngine> {
    signal.throwIfAborted();
    var models = await services.models({ operation: 'list' }, directory);
    var selected;
    for (var model of models) {
        if (model.selected) {
            selected = model;
            break;
        }
    }
    if (!selected) {
        throw new DownloadError('Select an installed model in velora before starting the service.');
    }
    signal.throwIfAborted();
    var license = await new Promise<string | null>(function (resolve, reject) {
        var cancelRead = function () { reject(signal.reason); };
        signal.addEventListener('abort', cancelRead, { once: true });
        services.store({ operation: 'read' }).then(resolve, reject).finally(function () {
            signal.removeEventListener('abort', cancelRead);
        });
    });
    signal.throwIfAborted();
    if (!license) {
        throw new DownloadError('Save a license in velora before starting the service.');
    }
    var session = await services.connect(license, signal, undefined, function (key, operationSignal, progress) {
        return bootstrapEngine(key, operationSignal, progress, { directory, installedOnly: true });
    });
    try {
        var loaded = await session.request('load', {
            model: join(directory, 'models', selected.id, 'installed', selected.id, selected.revision),
            options: { license_key: license }
        });
        signal.throwIfAborted();
        if (loaded.model_id !== selected.id || loaded.engine_version !== session.installation.release.version) {
            throw new DownloadError('The loaded model does not match the selection. Check the engine and model installation.');
        }
        return {
            model: selected.id, engineVersion: session.installation.release.version, request: session.request, exited: session.exited,
            close: async function () {
                try {
                    await session.request('shutdown');
                } catch {
                    // Closing the process also releases a model when the shutdown response is unavailable.
                } finally {
                    await session.close();
                }
            }
        };
    } catch (error) {
        await session.close();
        throw error;
    }
}
