import { secrets } from 'bun';

export type LicenseStoreRequest = { operation: 'read' } | { operation: 'write'; license: string };
export type CredentialStore = Pick<typeof secrets, 'get' | 'set'>;

export default async function licenseStore(request: LicenseStoreRequest, storage: CredentialStore = secrets): Promise<string | null> {
    var SERVICE = 'com.themistic.velora';
    var ACCOUNT = 'license';
    if (request.operation === 'read') {
        try {
            var license = await storage.get({ service: SERVICE, name: ACCOUNT });
        } catch {
            throw new LicenseStoreError('Could not read the system credential store. Unlock it and try again.');
        }
        if (license !== null && !/^[A-Z0-9-]{8,64}$/.test(license)) {
            throw new LicenseStoreError('The saved license is invalid. Run velora license set to replace it.');
        }
        return license;
    }
    if (!/^[A-Z0-9-]{8,64}$/.test(request.license)) {
        throw new Error('The license key cannot be saved in this format.');
    }
    try {
        await storage.set({ service: SERVICE, name: ACCOUNT, value: request.license, allowUnrestrictedAccess: false });
    } catch {
        throw new LicenseStoreError('Could not save the license in the system credential store. Unlock it and try again.');
    }
    return null;
}

class LicenseStoreError extends Error {
    override name = 'LicenseStoreError';
}
