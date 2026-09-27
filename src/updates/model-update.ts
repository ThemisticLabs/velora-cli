import { semver } from 'bun';
import type { InstalledModel } from '../models/installed-models.js';
import licenseStore from '../license/license-store.js';
import engineSession from '../engine/engine-session.js';
import packageRequest from '../downloads/package-request.js';
import packageRelease from '../downloads/package-release.js';
import DownloadError from '../downloads/download-error.js';

export default async function modelUpdate(model: InstalledModel, signal: AbortSignal,
    services = { store: licenseStore, connect: engineSession, request: packageRequest }): Promise<{ message: string; available?: { version: string; engineVersion: string } }> {
    var license = await services.store({ operation: 'read' });
    if (!license) {
        return { message: 'Save a license before checking model updates.' };
    }
    var session = await services.connect(license, signal);
    try {
        var device = await session.request('device');
        if (typeof device.hw !== 'string' || !/^[a-f0-9]{64}$/.test(device.hw) ||
            typeof device.runtime_target !== 'string' || device.runtime_target !== session.installation.target) {
            throw new DownloadError('The engine returned an invalid device identity.');
        }
        var plan = await services.request({ operation: 'resolve', license_key: license, hw: device.hw,
            model_id: model.id, runtime_target: device.runtime_target }, signal, undefined, undefined, undefined, 'check');
        var release = plan.metadata.model;
        if (typeof release !== 'object' || release === null || !('model_id' in release) || release.model_id !== model.id ||
            !('revision' in release) || typeof release.revision !== 'string' ||
            !('sequence' in release) || typeof release.sequence !== 'number' || !Number.isSafeInteger(release.sequence) ||
            !('version' in release) || typeof release.version !== 'string' || !release.version ||
            release.version.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(release.version)) {
            throw new DownloadError('The server returned an invalid model update plan.');
        }
        var engine = packageRelease(plan.metadata.engine, device.runtime_target);
        var modelVersion = '';
        var engineVersion = '';
        if (release.sequence > model.sequence) {
            modelVersion = release.version;
        }
        if (!model.engineVersion || semver.order(engine.version, model.engineVersion) === 1) {
            engineVersion = engine.version;
        }
        if (!modelVersion && !engineVersion) {
            return { message: 'No newer model or engine package is available.' };
        }
        return { message: 'Update available. Package replacement is not available yet.',
            available: { version: modelVersion, engineVersion } };
    } finally {
        await session.close();
    }
}
