import renderList, { type ListColumn } from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt } from '@inquirer/core';
import useSetupScreen from '../terminal/use-setup-screen.js';
import style from '../terminal/style.js';

type Selection = {
    message: string;
    back?: boolean;
    initialValue?: string;
    columns?: ListColumn[];
    emptyMessage?: string;
    actions?: { name: string; value: string }[];
    choices: { name: string; value: string; cells?: string[]; description?: string; documentationPath?: string }[];
};

export default createPrompt<string, Selection>(function (config, done) {
    var values: string[] = [];
    var rows = [];
    for (var choice of config.choices) {
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
    if (config.message) {
        for (var line of config.message.split('\n')) {
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
    for (var choice of config.choices) {
        if (choice.value === selected) {
            description = choice.description || '';
            documentationPath = choice.documentationPath;
        }
    }
    var MESSAGE_ROWS = content.split('\n').length - 1;
    var DESCRIPTION_ROWS = 0;
    if (description) {
        DESCRIPTION_ROWS = 1;
    }
    if (values.length || config.emptyMessage) {
        content += renderList({ rows, columns: config.columns, actions: config.actions, selected,
            width, height: setupDimensions().contentRows - MESSAGE_ROWS - DESCRIPTION_ROWS, emptyMessage: config.emptyMessage });
    }
    content += '  ' + style(description.slice(0, width), 'muted');
    return useSetupScreen(content, '', false, documentationPath);
});
