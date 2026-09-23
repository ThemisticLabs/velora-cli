import { lstat, mkdtemp, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import dataDirectory from '../system/data-directory.js';

export type InstalledModel = { id: string; name: string; version: string; revision: string; sequence: number; engineVersion: string; selected: boolean };
type ModelAction = { operation: 'list' } | { operation: 'select' | 'delete'; id: string };

export default async function installedModels(action: ModelAction, directory = dataDirectory()): Promise<InstalledModel[]> {
    var modelsPath = join(directory, 'models');
    for (var parent of [directory, modelsPath]) {
        try {
            if (!(await lstat(parent)).isDirectory()) {
                throw new ModelStorageError('Model storage must be a directory, not a link.');
            }
        } catch (error) {
            if (action.operation === 'list' && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
    var selectionPath = join(directory, 'selected-model.json');
    if (action.operation === 'list') {
        var selectedId: string | null = null;
        try {
            var selection: unknown = JSON.parse(await readFile(selectionPath, 'utf8'));
            if (typeof selection !== 'object' || selection === null || !('id' in selection) || typeof selection.id !== 'string') {
                throw new ModelStorageError('Invalid model selection.');
            }
            selectedId = selection.id;
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw new ModelStorageError('Could not read the selected model. Check selected-model.json.');
            }
        }
        var models: InstalledModel[] = [];
        var entries = await readdir(modelsPath, { withFileTypes: true });
        entries.sort(function (left, right) { return left.name.localeCompare(right.name); });
        for (var entry of entries) {
            if (!entry.isDirectory() || !/^[a-z0-9_-]{2,64}$/.test(entry.name)) {
                continue;
            }
            try {
                if (!(await lstat(join(modelsPath, entry.name, 'current.json'))).isFile()) {
                    throw new ModelStorageError('Linked installation state.');
                }
                var state: unknown = JSON.parse(await readFile(join(modelsPath, entry.name, 'current.json'), 'utf8'));
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                    continue;
                }
                throw new ModelStorageError('Could not read the installed model ' + entry.name + '. Check its current.json.');
            }
            if (typeof state !== 'object' || state === null || !('model_id' in state) || state.model_id !== entry.name ||
                !('revision' in state) || typeof state.revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(state.revision) ||
                !('sequence' in state) || typeof state.sequence !== 'number' || !Number.isSafeInteger(state.sequence) || state.sequence < 1 ||
                !('version' in state) || typeof state.version !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(state.version)) {
                throw new ModelStorageError('Invalid installation state for ' + entry.name + '. Check its current.json.');
            }
            var root = join(modelsPath, entry.name, 'installed');
            for (var folder of [root, join(root, entry.name), join(root, entry.name, state.revision)]) {
                if (!(await lstat(folder)).isDirectory()) {
                    throw new ModelStorageError('The installed package is missing or linked. Check model storage.');
                }
            }
            var name = entry.name;
            if ('model_name' in state && typeof state.model_name === 'string' && state.model_name.trim() &&
                state.model_name.length <= 128 && !/[\x00-\x1f\x7f-\x9f]/.test(state.model_name)) {
                name = state.model_name;
            }
            var engineVersion = '';
            if ('engine_version' in state && typeof state.engine_version === 'string' && /^\d+\.\d+\.\d+$/.test(state.engine_version)) {
                engineVersion = state.engine_version;
            }
            models.push({ id: entry.name, name, version: state.version, revision: state.revision, sequence: state.sequence, engineVersion, selected: entry.name === selectedId });
        }
        if (selectedId === null && models.length === 1) {
            models[0]!.selected = true;
        }
        return models;
    }
    if (!/^[a-z0-9_-]{2,64}$/.test(action.id)) {
        throw new ModelStorageError('Invalid model identifier.');
    }
    var found = false;
    for (var model of await installedModels({ operation: 'list' }, directory)) {
        if (model.id === action.id) {
            found = true;
        }
    }
    if (!found) {
        throw new ModelStorageError('This model is no longer installed.');
    }
    var root = join(modelsPath, action.id);
    if (!(await lstat(root)).isDirectory()) {
        throw new ModelStorageError('The model directory is missing or linked.');
    }
    var lockPath = join(root, '.update.lock');
    var lock = await open(lockPath, 'wx', 0o600);
    var moved = false;
    try {
        if (!(await lstat(join(root, 'current.json'))).isFile()) {
            throw new ModelStorageError('The model has no installation record.');
        }
        if (action.operation === 'select') {
            var temporary = await mkdtemp(join(directory, '.selection-'));
            try {
                var path = join(temporary, 'selected-model.json');
                var file = await open(path, 'wx', 0o600);
                try {
                    await file.writeFile(JSON.stringify({ id: action.id }) + '\n');
                    await file.sync();
                } finally {
                    await file.close();
                }
                await rename(path, selectionPath);
            } finally {
                await rm(temporary, { recursive: true, force: true });
            }
            return [];
        }
        var quarantine = await mkdtemp(join(modelsPath, '.delete-'));
        try {
            await rename(root, join(quarantine, 'model'));
            moved = true;
        } catch (error) {
            await rm(quarantine, { recursive: true, force: true });
            throw error;
        }
        await lock.close();
        try {
            await rm(quarantine, { recursive: true, force: true });
        } catch {
            throw new ModelStorageError('Model removed from the menu. Some files remain in models/.delete-*. Check storage permissions.');
        }
        return [];
    } finally {
        await lock.close();
        if (!moved) {
            await rm(lockPath, { force: true });
        }
    }
}

class ModelStorageError extends Error {
    override name = 'ModelStorageError';
}
