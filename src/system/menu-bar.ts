import { spawn } from 'node:child_process';
import logoPath from '../assets/logo.svg' with { type: 'file' };

export default async function menuBar(): Promise<{ available: boolean; close: () => void }> {
    if (process.platform !== 'darwin') { return { available: true, close: function () {} }; }
    var icon = (await Bun.file(logoPath).arrayBuffer());
    var encodedIcon = Buffer.from(icon).toString('base64');
    var script = `
ObjC.import('AppKit');
var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
var data = $.NSData.alloc.initWithBase64EncodedStringOptions('${encodedIcon}', 0);
var image = $.NSImage.alloc.initWithData(data);
if (image.isNil()) { throw new Error('Cannot load velora icon'); }
var ICON_WIDTH = 22;
var ICON_HEIGHT = 18;
image.setSize($.NSMakeSize(ICON_WIDTH, ICON_HEIGHT));
image.setTemplate(true);
var item = $.NSStatusBar.systemStatusBar.statusItemWithLength(26);
item.button.setImage(image);
item.button.setToolTip('velora · CLI open');
$.NSFileHandle.fileHandleWithStandardOutput.writeData($('ready\\n').dataUsingEncoding($.NSUTF8StringEncoding));
ObjC.bindFunction('kill', ['int', ['int', 'int']]);
while ($.kill(${process.pid}, 0) === 0) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1));
}
`;
    var child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    var available = await new Promise<boolean>(function (resolve) {
        var START_TIMEOUT_MS = 5000;
        var output = '';
        var timer = setTimeout(function () { child.kill(); resolve(false); }, START_TIMEOUT_MS);
        child.once('error', function () { clearTimeout(timer); resolve(false); });
        child.once('close', function () { clearTimeout(timer); resolve(false); });
        child.stdout.on('data', function (chunk) {
            output += chunk.toString();
            if (output.includes('ready\n')) { clearTimeout(timer); resolve(true); }
        });
    });
    return { available, close: function () { child.kill(); } };
}
