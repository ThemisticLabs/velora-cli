import type { EngineProgress } from '../engine/bootstrap-engine.js';
import licenseStore from './license-store.js';
import licenseAccess from './license-access.js';

export type LicenseRequest = { operation: 'status' } | { operation: 'set'; license: string };
type LicenseServices = {
    store: typeof licenseStore;
    check: typeof licenseAccess;
};

export default async function manageLicense(request: LicenseRequest, signal: AbortSignal,
    services: LicenseServices = { store: licenseStore, check: licenseAccess }, onProgress?: (progress: EngineProgress) => void) {
    signal.throwIfAborted();
    try {
        var license: string | null;
        if (request.operation === 'set') {
            license = request.license.trim().toUpperCase();
        } else {
            license = await services.store({ operation: 'read' });
        }
        if (!license) {
            return { ok: false as const, message: 'No license saved. Run velora license set.' };
        }
        if (!/^[A-Z0-9-]{8,64}$/.test(license)) {
            return { ok: false as const, message: 'Check the license key and try again.' };
        }
        signal.throwIfAborted();
        var result = await services.check(license, signal, undefined, onProgress);
        signal.throwIfAborted();
        if (!result.ok) {
            return result;
        }
        if (request.operation === 'set') {
            await services.store({ operation: 'write', license });
        }
        return { ...result, license, saved: request.operation === 'set' };
    } catch (error) {
        if (signal.aborted) {
            throw signal.reason;
        }
        // Storage errors are sanitized at their boundary; other failures may include private data.
        if (error instanceof Error && error.name === 'LicenseStoreError') {
            return { ok: false as const, message: error.message };
        }
        return { ok: false as const, message: 'Could not check this license. Try again.' };
    }
}
