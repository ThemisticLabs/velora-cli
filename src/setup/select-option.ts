import navigation from '../terminal/interactive-navigation.js';
import renderList, { type ListColumn } from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, useEffect, useState } from '@inquirer/core';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

type Selection = {
    message: string;
    refresh?: (signal: AbortSignal) => Promise<Pick<Selection, 'message' | 'choices'>>;
    back?: boolean;
    initialValue?: string;
    columns?: ListColumn[];
    emptyMessage?: string;
    actions?: { name: string; value: string }[];
    choices: { name: string; value: string; cells?: string[]; description?: string; documentationPath?: string }[];
};

var prompt = createPrompt<string, Selection>(function (config, done) {
    var [updated, setUpdated] = useState<Pick<Selection, 'message' | 'choices'> | undefined>();
    useEffect(function () {
        if (!config.refresh) { return; }
        var controller = new AbortController();
        var REFRESH_INTERVAL_MS = 1000;
        var timer: ReturnType<typeof setTimeout>;
        var refresh = async function () {
            try {
                var update = await config.refresh!(controller.signal);
                if (!controller.signal.aborted) { setUpdated(update); }
            } catch {
                // The last confirmed menu remains visible if refresh is interrupted.
            } finally {
                if (!controller.signal.aborted) { timer = setTimeout(refresh, REFRESH_INTERVAL_MS); }
            }
        };
        timer = setTimeout(refresh, REFRESH_INTERVAL_MS);
        return function () { controller.abort(); clearTimeout(timer); };
    }, []);
    var choices = updated?.choices || config.choices;
    var message = updated?.message ?? config.message;
    var values: string[] = [];
    var rows = [];
    var hasDescriptions = false;
    for (var choice of choices) {
        hasDescriptions = hasDescriptions || choice.description !== undefined;
        values.push(choice.value);
        rows.push({ value: choice.value, cells: choice.cells || [choice.name] });
    }
    for (var action of config.actions || []) {
        values.push(action.value);
    }
    var selected = useListNavigation({ values, initialValue: config.initialValue, onSelect: done,
        onBack: function () {
            if (config.back) {
                done('back');
            }
        }
    });
    var width = setupDimensions().contentWidth;
    var content = '';
    if (message) {
        for (var line of message.split('\n')) {
            while (line.length > width) {
                var endOfLine = line.lastIndexOf(' ', width);
                if (endOfLine < 1) {
                    endOfLine = width;
                }
                content += '  ' + style(line.slice(0, endOfLine), 'strong') + '\n';
                line = line.slice(endOfLine).trimStart();
            }
            content += '  ' + style(line, 'strong') + '\n';
        }
        content += '\n';
    }
    var description = '';
    var documentationPath: string | undefined;
    for (var choice of choices) {
        if (choice.value === selected) {
            description = choice.description || '';
            documentationPath = choice.documentationPath;
        }
    }
    var MESSAGE_ROWS = content.split('\n').length - 1;
    var detail: string | undefined;
    if (hasDescriptions) { detail = description; }
    if (values.length || config.emptyMessage) {
        content += renderList({ rows, columns: config.columns, actions: config.actions, selected,
            width, height: setupDimensions().contentRows - MESSAGE_ROWS, emptyMessage: config.emptyMessage, detail });
    }
    if (content.endsWith('\n')) { content = content.slice(0, -1); }
    return useSetupScreen(content, '', false, documentationPath);
});

export default async function select(config: Selection, context?: Parameters<typeof prompt>[1]): Promise<string> {
    if (navigation.quit) { throw Object.assign(new Error('Closing velora.'), { name: 'AbortPromptError' }); }
    if (navigation.settings) { throw new Error('OpenSettings'); }
    var signal = navigation.controller.signal;
    if (context?.signal) { signal = AbortSignal.any([signal, context.signal]); }
    return prompt(config, { ...context, signal });
}
