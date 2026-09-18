import { createPrompt, isEnterKey, useKeypress, useState } from '@inquirer/core';
import type { LicenseModel } from './license-access.js';
import renderSetup from './render-setup.js';
import style from './style.js';
import useSetupScreen from './use-setup-screen.js';

export default async function modelList(models: LicenseModel[], summary: string, signal: AbortSignal) {
    var selectedIndex = 0;
    while (true) {
        renderSetup('Your models.', summary, '↑/↓ Scroll · Enter Open · Ctrl+C Cancel');
        var choose = createPrompt<LicenseModel | 'back' | 'finish', Record<string, never>>(function (_config, done) {
            var [activeIndex, setActiveIndex] = useState(selectedIndex);
            useKeypress(function (key) {
                if (process.stdout.columns < 60 || process.stdout.rows < 20) {
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
            var layoutRows = 14;
            if (process.stdout.rows >= 28) {
                layoutRows += 5;
            }
            var VISIBLE_MODELS = Math.max(3, Math.floor((process.stdout.rows - layoutRows) / 2));
            var modelIndex = Math.min(activeIndex, models.length - 1);
            var start = Math.max(0, modelIndex - VISIBLE_MODELS + 1);
            var end = Math.min(models.length, start + VISIBLE_MODELS);
            var width = Math.max(56, process.stdout.columns - 4);
            var NAME_WIDTH = 18;
            var descriptionWidth = width - NAME_WIDTH - 3;
            var separator = style('─'.repeat(NAME_WIDTH) + '┼' + '─'.repeat(descriptionWidth + 2), 'divider');
            var output = '  ' + style('Model'.padEnd(NAME_WIDTH), 'muted') + style('│', 'divider') + style(' Description', 'muted') + '\n';
            output += '  ' + separator + '\n';
            for (var index = start; index < end; index++) {
                var model = models[index]!;
                var name = model.name.slice(0, NAME_WIDTH - 2);
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

        renderSetup('Model details.', selected.name.slice(0, process.stdout.columns - 4), '←/→ Pages · Enter Back · Ctrl+C Cancel', '/models/' + encodeURIComponent(selected.id));
        var sections = [
            { title: 'Overview', text: selected.description },
            { title: 'Strengths', text: selected.strengths },
            { title: 'Known limitations', text: selected.limitations },
            { title: 'Installation', text: 'Model downloads are not connected in velora yet.' }
        ];
        if (selected.downloadReason === 'release_withdrawn') {
            sections[3]!.text = 'This release has been withdrawn from download.';
        }
        var details = createPrompt<void, Record<string, never>>(function (_config, done) {
            var pages: string[] = [];
            var width = Math.max(54, process.stdout.columns - 6);
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
            useKeypress(function (key) {
                if (process.stdout.columns < 60 || process.stdout.rows < 20) {
                    return;
                }
                if (isEnterKey(key) || key.name === 'escape') {
                    done();
                    return;
                }
                if (key.name === 'right') {
                    setPageIndex(Math.min(pages.length - 1, pageIndex + 1));
                }
                if (key.name === 'left') {
                    setPageIndex(Math.max(0, pageIndex - 1));
                }
            });
            return useSetupScreen(pages[Math.min(pageIndex, pages.length - 1)] + style('Page ' + (pageIndex + 1) + ' of ' + pages.length, 'muted'));
        });
        await details({}, { signal });
    }
}
