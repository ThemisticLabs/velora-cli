import bootstrapEngine, { type EngineProgress } from '../engine/bootstrap-engine.js';
import { semver } from 'bun';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import licenseStore from '../license/license-store.js';
import packageRequest from '../downloads/package-request.js';
import packageRelease from '../downloads/package-release.js';
import engineRuntime from '../engine/engine-runtime.js';
import runtimeTarget from '../engine/runtime-target.js';
import dataDirectory from '../system/data-directory.js';

export type EngineUpdateReport = { message: string; installed?: string; available?: string; current?: boolean };
export var lastEngineCheck: EngineUpdateReport | null = null;

export var availableEngineVersion: string | null = null;

export default async function engineUpdate(signal: AbortSignal, services = {
    store: licenseStore, request: packageRequest, target: runtimeTarget, directory: dataDirectory, verify: engineRuntime, install: bootstrapEngine
}, installRequest?: { version: string; onProgress: (progress: EngineProgress) => void }): Promise<EngineUpdateReport> {
    availableEngineVersion = null;
    lastEngineCheck = { message: 'Could not check engine updates. Try again.' };
    if (installRequest) {
        var license = await services.store({ operation: 'read' });
        if (!license) { throw new Error('Save a license before updating the engine.'); }
        var updated = await services.install(license, signal, installRequest.onProgress, {
            directory: services.directory(), update: true, expectedVersion: installRequest.version
        });
        return lastEngineCheck = { installed: updated.release.version, current: true, message: 'Engine updated.' };
    }
    var target = await services.target(signal);
    var installed: string | undefined;
    var stateExists = false;
    try {
        var path = join(services.directory(), 'engine', 'bootstrap.json');
        var info = await lstat(path);
        stateExists = true;
        var MAX_STATE_BYTES = 2 * 1024 ** 2;
        if (!info.isFile() || info.size > MAX_STATE_BYTES) {
            return lastEngineCheck = { message: 'The installed engine record is invalid. Check engine storage.' };
        }
        var release = packageRelease(JSON.parse(await readFile(path, 'utf8')), target);
        var installation = join(services.directory(), 'engine', release.revision);
        var runtime = join(installation, 'runtime');
        for (var directory of [join(services.directory(), 'engine'), installation, runtime]) {
            if (!(await lstat(directory)).isDirectory()) {
                return lastEngineCheck = { message: 'The engine installation is missing or linked. Repair it before checking updates.' };
            }
        }
        await services.verify(join(installation, 'package'), runtime, release, signal);
        installed = release.version;
    } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            return lastEngineCheck = { message: 'Could not read the installed engine version. Check engine storage.' };
        }
        if (stateExists) {
            return lastEngineCheck = { message: 'The engine installation is incomplete. Repair it before checking updates.' };
        }
    }
    var license = await services.store({ operation: 'read' });
    if (!license) {
        return lastEngineCheck = { installed, message: 'Save a license before checking engine updates.' };
    }
    var plan = await services.request({ operation: 'resolve', license_key: license, runtime_target: target }, signal);
    var available = packageRelease(plan.metadata.engine, target);
    if (!installed) {
        return lastEngineCheck = { available: available.version, message: 'Engine available. Setup will install it when needed.' };
    }
    if (semver.order(available.version, installed) === 1) {
        availableEngineVersion = available.version;
        return lastEngineCheck = { installed, available: available.version, message: 'Update available. Select Install engine update to continue.' };
    }
    return lastEngineCheck = { installed, current: true, message: 'The engine is up to date.' };
}
