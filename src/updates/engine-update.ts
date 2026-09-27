import { semver } from 'bun';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import licenseStore from '../license/license-store.js';
import packageRequest from '../downloads/package-request.js';
import packageRelease from '../downloads/package-release.js';
import engineRuntime from '../engine/engine-runtime.js';
import runtimeTarget from '../engine/runtime-target.js';
import dataDirectory from '../system/data-directory.js';

export var availableEngineVersion: string | null = null;

export default async function engineUpdate(signal: AbortSignal, services = {
    store: licenseStore, request: packageRequest, target: runtimeTarget, directory: dataDirectory, verify: engineRuntime
}): Promise<{ message: string; installed?: string; available?: string; current?: boolean }> {
    availableEngineVersion = null;
    var target = await services.target(signal);
    var installed: string | undefined;
    var stateExists = false;
    try {
        var path = join(services.directory(), 'engine', 'bootstrap.json');
        var info = await lstat(path);
        stateExists = true;
        var MAX_STATE_BYTES = 2 * 1024 ** 2;
        if (!info.isFile() || info.size > MAX_STATE_BYTES) {
            return { message: 'The installed engine record is invalid. Check engine storage.' };
        }
        var release = packageRelease(JSON.parse(await readFile(path, 'utf8')), target);
        var installation = join(services.directory(), 'engine', release.revision);
        var runtime = join(installation, 'runtime');
        for (var directory of [join(services.directory(), 'engine'), installation, runtime]) {
            if (!(await lstat(directory)).isDirectory()) {
                return { message: 'The engine installation is missing or linked. Repair it before checking updates.' };
            }
        }
        await services.verify(join(installation, 'package'), runtime, release, signal);
        installed = release.version;
    } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            return { message: 'Could not read the installed engine version. Check engine storage.' };
        }
        if (stateExists) {
            return { message: 'The engine installation is incomplete. Repair it before checking updates.' };
        }
    }
    var license = await services.store({ operation: 'read' });
    if (!license) {
        return { installed, message: 'Save a license before checking engine updates.' };
    }
    var plan = await services.request({ operation: 'resolve', license_key: license, runtime_target: target }, signal);
    var available = packageRelease(plan.metadata.engine, target);
    if (!installed) {
        return { available: available.version, message: 'Engine available. Setup will install it when needed.' };
    }
    if (semver.order(available.version, installed) === 1) {
        availableEngineVersion = available.version;
        return { installed, available: available.version, message: 'Update available. Engine replacement is not available yet.' };
    }
    return { installed, current: true, message: 'The engine is up to date.' };
}
