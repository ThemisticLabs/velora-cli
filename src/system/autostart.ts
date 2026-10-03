import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_COMPILED } from './build-mode.js';
import syncDirectory from './sync-directory.js';

export default async function autostart(enabled?: boolean, home = homedir(), platform = process.platform): Promise<{ supported: boolean; enabled: boolean }> {
    if (platform !== 'darwin') { return { supported: false, enabled: false }; }
    var LABEL = 'com.themistic.velora';
    var directory = join(home, 'Library', 'LaunchAgents');
    var path = join(directory, LABEL + '.plist');
    try {
        var parent = await lstat(directory);
        if (!parent.isDirectory() || parent.isSymbolicLink()) { throw new Error('Invalid login item directory.'); }
        var file = await lstat(path);
        var MAX_PLIST_BYTES = 16 * 1024;
        if (!file.isFile() || file.size > MAX_PLIST_BYTES) { throw new Error('Invalid velora login item.'); }
        var plist = await readFile(path, 'utf8');
        if (!plist.includes('<string>' + LABEL + '</string>')) { throw new Error('Unexpected login item.'); }
        var installed = true;
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw new Error('Could not read the velora login item. Check Library/LaunchAgents.');
        }
        installed = false;
    }
    if (enabled === undefined) { return { supported: true, enabled: installed }; }
    if (!enabled) {
        if (installed) { await unlink(path); await syncDirectory(directory); }
        return { supported: true, enabled: false };
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) { throw new Error('Login item storage must not be a symbolic link.'); }
    var args = [process.execPath];
    if (!IS_COMPILED) { args.push('run', fileURLToPath(new URL('../cli.ts', import.meta.url))); }
    args.push('serve', 'start', '--headless');
    var argumentsXml = '';
    for (var argument of args) {
        argumentsXml += '        <string>' + argument.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') + '</string>\n';
    }
    var contents = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>\n' +
        '    <key>Label</key><string>' + LABEL + '</string>\n' +
        '    <key>ProgramArguments</key><array>\n' + argumentsXml + '    </array>\n' +
        '    <key>RunAtLoad</key><true/>\n' +
        '</dict></plist>\n';
    var temporary = await mkdtemp(join(directory, '.velora-login-'));
    try {
        var output = await open(join(temporary, 'agent.plist'), 'wx', 0o600);
        try { await output.writeFile(contents); await output.sync(); } finally { await output.close(); }
        await rename(join(temporary, 'agent.plist'), path);
        await syncDirectory(directory);
    } finally { await rm(temporary, { recursive: true, force: true }); }
    return { supported: true, enabled: true };
}
