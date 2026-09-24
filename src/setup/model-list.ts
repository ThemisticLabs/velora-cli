import setupDimensions from '../terminal/setup-dimensions.js';
import { createPrompt, isEnterKey, useEffect, useKeypress, useState } from '@inquirer/core';
import type { LicenseModel } from '../license/license-access.js';
import setSetupLayout from '../terminal/set-setup-layout.js';
import style from '../terminal/style.js';
import useSetupScreen from '../terminal/use-setup-screen.js';

export default async function modelList(models: LicenseModel[], summary: string, signal?: AbortSignal) {
    var selectedIndex = 0;
    while (true) {
        setSetupLayout('Your models.', summary, '↑/↓ Scroll · Enter Open · Esc Back · Ctrl+C Quit');
        var choose = createPrompt<LicenseModel | 'back' | 'finish', Record<string, never>>(function (_config, done) {
            var [activeIndex, setActiveIndex] = useState(selectedIndex);
            useKeypress(function (key) {
                if (key.name === 'escape') {
                    done('back');
                    return;
                }
                if (setupDimensions().tooSmall) {
                    return;
                }
                if (isEnterKey(key)) {
                    selectedIndex = activeIndex;
                    if (activeIndex === models.length) {
                        done('back');
                        return;
                    }
                    if (activeIndex === models.length + 1) {
                        done('finish');
                        return;
                    }
                    done(models[activeIndex]!);
                    return;
                }
                if (key.name === 'down') {
                    setActiveIndex(Math.min(models.length + 1, activeIndex + 1));
                }
                if (key.name === 'up') {
                    setActiveIndex(Math.max(0, activeIndex - 1));
                }
            });
            var dimensions = setupDimensions();
            var TABLE_HEADING_ROWS = 2;
            var TABLE_ACTION_ROWS = 3;
            var MODEL_ROWS = 2;
            var MIN_VISIBLE_MODELS = 3;
            var availableModelRows = dimensions.contentRows - TABLE_HEADING_ROWS - TABLE_ACTION_ROWS;
            var visibleModels = Math.max(MIN_VISIBLE_MODELS, Math.floor(availableModelRows / MODEL_ROWS));
            var modelIndex = Math.min(activeIndex, models.length - 1);
            var start = Math.max(0, modelIndex - visibleModels + 1);
            var end = Math.min(models.length, start + visibleModels);
            var width = dimensions.contentWidth;
            var NAME_WIDTH = 18;
            var SELECTION_MARKER_COLUMNS = 2;
            var COLUMN_DIVIDER_COLUMNS = 1;
            var DESCRIPTION_PADDING_COLUMNS = 2;
            var descriptionWidth = width - NAME_WIDTH - COLUMN_DIVIDER_COLUMNS - DESCRIPTION_PADDING_COLUMNS;
            var separator = style('─'.repeat(NAME_WIDTH) + '┼' + '─'.repeat(descriptionWidth + DESCRIPTION_PADDING_COLUMNS), 'divider');
            var output = '  ' + style('Model'.padEnd(NAME_WIDTH), 'muted') + style('│', 'divider') + style(' Description', 'muted') + '\n';
            output += '  ' + separator + '\n';
            for (var index = start; index < end; index++) {
                var model = models[index]!;
                var name = model.name.slice(0, NAME_WIDTH - SELECTION_MARKER_COLUMNS);
                var marker = '  ';
                if (index === activeIndex) {
                    marker = '› ';
                }
                var nameCell = (marker + name).padEnd(NAME_WIDTH);
                if (index === activeIndex) {
                    nameCell = style(nameCell, 'accent');
                }
                var description = model.description;
                if (description.length > descriptionWidth) {
                    description = description.slice(0, descriptionWidth - 1) + '…';
                }
                output += '  ' + nameCell + style('│', 'divider') + ' ' + style(description, 'muted') + '\n';
                output += '  ' + separator + '\n';
            }
            var scrollHint = '  All models shown';
            if (start > 0) {
                scrollHint = '  ↑ More above';
            }
            if (end < models.length) {
                scrollHint = '  ↓ More below';
                if (start > 0) {
                    scrollHint = '  ↑ More above    ↓ More below';
                }
            }
            if (models.length === 0) {
                scrollHint = '  No models included in this license.';
            }
            output += style(scrollHint, 'muted') + '\n\n';
            var back = '  Go back';
            var finish = '  Finish';
            if (activeIndex === models.length) {
                back = style('› Go back', 'accent');
            }
            if (activeIndex === models.length + 1) {
                finish = style('› Finish', 'accent');
            }
            output += back + '    ' + finish;
            var documentationPath = '/velora/setup';
            if (activeIndex < models.length) {
                documentationPath = '/models/' + encodeURIComponent(models[activeIndex]!.id);
            }
            return useSetupScreen(output, '', false, documentationPath);
        });
        var selected = await choose({}, { signal });
        if (selected === 'back' || selected === 'finish') {
            return selected;
        }

        var modelToInstall = selected;
        setSetupLayout('Model details.', selected.name, '←/→ Pages · I Install · Esc Back · Ctrl+C Quit', '/models/' + encodeURIComponent(selected.id));
        var installationText = 'No downloadable release is available for this model.';
        if (selected.canDownload) {
            installationText = 'Press I to download this model. This registers this device with your license. The package is verified before installation.';
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
                if (key.name === 'i' && modelToInstall.canDownload) {
                    done('install');
                    return;
                }
                if (isEnterKey(key) || key.name === 'escape') {
                    done('back');
                    return;
                }
                if (key.name === 'right') {
                    setPageIndex(Math.min(pages.length - 1, currentPageIndex + 1));
                }
                if (key.name === 'left') {
                    setPageIndex(Math.max(0, currentPageIndex - 1));
                }
            });
            return useSetupScreen(pages[currentPageIndex] + style('Page ' + (currentPageIndex + 1) + ' of ' + pages.length, 'muted'));
        });
        if (await details({}, { signal }) === 'install') {
            return selected;
        }
    }
}
