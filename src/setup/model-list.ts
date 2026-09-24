import renderList from '../terminal/render-list.js';
import useListNavigation from '../terminal/use-list-navigation.js';
import select from './select-option.js';
import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, useEffect, useKeypress, useState } from '@inquirer/core';
import type { LicenseModel } from '../license/license-access.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';
import useSetupScreen from '../terminal/use-setup-screen.js';

export default async function modelList(models: LicenseModel[], summary: string, signal?: AbortSignal): Promise<LicenseModel | 'back' | 'finish'> {
    var selectedValue = '';
    var choices = [];
    for (var model of models) {
        choices.push({ name: model.name, value: 'model:' + model.id, cells: [model.name, model.description], documentationPath: '/models/' + encodeURIComponent(model.id) });
    }
    while (true) {
        setSetupLayout('Your models.', summary, '↑/↓ Scroll · Enter Open · Esc Back · Ctrl+C Quit');
        var value = await select({ back: true, message: '', choices, initialValue: selectedValue,
            columns: [{ title: 'Model', width: 18 }, { title: 'Description' }],
            actions: [{ name: 'Finish', value: 'finish' }],
            emptyMessage: 'No models included in this license.'
        }, { signal });
        if (value === 'back' || value === 'finish') {
            return value;
        }
        selectedValue = value;
        var selected = models[0]!;
        for (var model of models) {
            if ('model:' + model.id === value) {
                selected = model;
                break;
            }
        }

        var modelToInstall = selected;
        setSetupLayout('Model details.', selected.name, '←/→ Pages · Enter Install · Esc Back · Ctrl+C Quit', '/models/' + encodeURIComponent(selected.id));
        if (!selected.canDownload) {
            setSetupLayout('Model details.', selected.name, '←/→ Pages · Esc Back · Ctrl+C Quit', '/models/' + encodeURIComponent(selected.id));
        }
        var installationText = 'No downloadable release is available for this model.';
        if (selected.canDownload) {
            installationText = 'Select Install model to download. This registers this device with your license. The package is verified before installation.';
        }
        if (selected.downloadReason === 'release_withdrawn') {
            installationText = 'This release has been withdrawn from download.';
        }
        var sections = [
            { title: 'Overview', text: selected.description },
            { title: 'Strengths', text: selected.strengths },
            { title: 'Known limitations', text: selected.limitations },
            { title: 'Installation', text: installationText }
        ];
        var details = createPrompt<'back' | 'install', Record<string, never>>(function (_config, done) {
            var pages: string[] = [];
            var DETAIL_TEXT_INSET_COLUMNS = 2;
            var width = Math.max(1, setupDimensions().contentWidth - DETAIL_TEXT_INSET_COLUMNS);
            var LINES_PER_PAGE = 5;
            for (var section of sections) {
                var lines = [];
                var line = '';
                for (var word of section.text.split(' ')) {
                    if (line.length + word.length + 1 > width && line) {
                        lines.push(line);
                        line = '';
                    }
                    while (word.length > width) {
                        lines.push(word.slice(0, width));
                        word = word.slice(width);
                    }
                    if (line) {
                        line += ' ';
                    }
                    line += word;
                }
                if (line) {
                    lines.push(line);
                }
                for (var offset = 0; offset < lines.length; offset += LINES_PER_PAGE) {
                    var page = style(section.title, 'strong') + '\n\n';
                    for (var index = offset; index < Math.min(offset + LINES_PER_PAGE, lines.length); index++) {
                        page += lines[index] + '\n';
                    }
                    pages.push(page);
                }
            }
            var [pageIndex, setPageIndex] = useState(0);
            var currentPageIndex = Math.min(pageIndex, pages.length - 1);
            useEffect(function () {
                if (pageIndex !== currentPageIndex) {
                    setPageIndex(currentPageIndex);
                }
            }, [pageIndex, currentPageIndex]);
            useKeypress(function (key) {
                if (setupDimensions().tooSmall) {
                    return;
                }
                if (key.name === 'right') {
                    setPageIndex(Math.min(pages.length - 1, currentPageIndex + 1));
                }
                if (key.name === 'left') {
                    setPageIndex(Math.max(0, currentPageIndex - 1));
                }
            });
            var actions = [];
            var values: string[] = [];
            if (modelToInstall.canDownload) {
                actions.push({ name: 'Install model', value: 'install' });
                values.push('install');
            }
            var selectedAction = useListNavigation({ values,
                onSelect: function () { done('install'); },
                onBack: function () { done('back'); }
            });
            var output = pages[currentPageIndex] || '';
            output += style('Page ' + (currentPageIndex + 1) + ' of ' + pages.length, 'muted') + '\n';
            if (actions.length) {
                output += renderList({ rows: [], actions, selected: selectedAction,
                    emptyMessage: '', width: setupDimensions().contentWidth,
                    height: setupDimensions().contentRows - output.split('\n').length + 1 });
            }
            return useSetupScreen(output);
        });
        if (await details({}, { signal }) === 'install') {
            return selected;
        }
    }
}
