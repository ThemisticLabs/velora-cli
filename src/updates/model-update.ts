import type { InstalledModel } from '../models/installed-models.js';
import licenseStore from '../license/license-store.js';
import deviceFingerprint from '../system/device-fingerprint.js';
import packageRequest from '../downloads/package-request.js';
import packageRelease from '../downloads/package-release.js';

export default async function modelUpdate(model: InstalledModel, signal: AbortSignal,
    services = { store: licenseStore, identity: deviceFingerprint, request: packageRequest }): Promise<{ message: string; available?: { version: string; engineVersion: string } }> {
    var license = await services.store({ operation: 'read' });
    if (!license) {
        return { message: 'Save a license before checking model updates.' };
    }
    var identity = await services.identity();
    signal.throwIfAborted();
    var catalog = await services.request({ operation: 'catalog', license_key: license, hw: identity.hw, model_id: null }, signal);
    if (!Array.isArray(catalog.metadata.releases)) {
        throw new Error('Invalid model catalog.');
    }
    var matches = [];
    for (var item of catalog.metadata.releases) {
        var release = packageRelease(item);
        if (release.model_id === model.id && release.enabled) {
            matches.push(release);
        }
    }
    if (matches.length !== 1) {
        return { message: 'No unique release is available for this model.' };
    }
    var release = matches[0]!;
    if (release.sequence <= model.sequence) {
        return { message: 'No newer model package is available.' };
    }
    return { message: 'Update available. Package installation is not available yet.',
        available: { version: release.version, engineVersion: release.engine_version || 'Unknown' } };
}
