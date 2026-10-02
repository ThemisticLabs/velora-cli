import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import doctor, { type DoctorCheck } from '../commands/doctor.js';
import renderProgress from '../terminal/render-progress.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

export default async function doctorScreen(): Promise<void> {
    var controller = new AbortController();
    var task: Promise<void> | undefined;
    var prompt = createPrompt<void, Record<string, never>>(function (_config, done) {
        var [checks, setChecks] = useState<DoctorCheck[]>([]);
        var [finished, setFinished] = useState(false);
        var [error, setError] = useState('');
        useEffect(function () {
            var active = true;
            task = doctor(undefined, undefined, { signal: controller.signal, onProgress: function (updates) {
                if (!active) { return; }
                var snapshot = [];
                for (var check of updates) {
                    snapshot.push({ ...check });
                }
                setChecks(snapshot);
            } }).then(function () {
                if (active) { setFinished(true); }
            }).catch(function () {
                if (active) {
                    setError('Could not complete the checks. Try doctor again.');
                    setFinished(true);
                }
            });
            return function () { active = false; controller.abort(); };
        }, []);
        useKeypress(function (key) {
            if (key.name === 'escape' || finished && isEnterKey(key)) {
                done();
            }
        });
        var dimensions = setupDimensions();
        var completed = 0;
        var current = 'Preparing checks…';
        var lines = [];
        for (var check of checks) {
            if (check.status === 'Checking') { current = check.name; }
            if (check.status === 'Waiting') { continue; }
            if (check.status !== 'Checking') { completed++; }
            lines.push(style((check.status + '  ' + check.name).slice(0, dimensions.contentWidth), check.status));
            var detail = check.detail.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
            for (var offset = 0; offset < detail.length; offset += dimensions.contentWidth) {
                lines.push(detail.slice(offset, offset + dimensions.contentWidth));
            }
        }
        var footer = 'Esc Back · Ctrl+C Quit';
        if (finished) {
            current = 'Checks complete.';
            if (error) { current = 'Checks stopped.'; }
            footer = 'Enter Continue · Esc Back · Ctrl+C Quit';
        }
        var output = renderProgress(completed, checks.length, dimensions.contentWidth, 0) + '\n';
        output += '  ' + style(current.slice(0, dimensions.contentWidth), 'muted') + '\n';
        output += '  ' + style('─'.repeat(dimensions.contentWidth), 'divider') + '\n';
        var PROGRESS_ROWS = 3;
        var capacity = Math.max(1, dimensions.contentRows - PROGRESS_ROWS);
        for (var index = Math.max(0, lines.length - capacity); index < lines.length; index++) {
            output += '  ' + lines[index]! + '\n';
        }
        setSetupLayout('Settings / Doctor', '', '/velora/settings', footer);
        return useSetupScreen(output, error);
    });
    try {
        await prompt({});
    } finally {
        controller.abort();
        await task;
    }
}
