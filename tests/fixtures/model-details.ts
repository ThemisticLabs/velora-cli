import assert from 'node:assert/strict';
import modelList from '../../src/setup/model-list.js';

var scenario = process.argv[2];
var model = {
    id: 'skira7alpha', name: 'Skira 7 Alpha', description: 'Overview text. '.repeat(40),
    strengths: 'Strengths text.', limitations: 'Limitations text.',
    canDownload: scenario !== 'unavailable', downloadReason: null
};
var result = await modelList([model], 'Fixture license');
if (scenario === 'install') {
    assert.equal(result, model);
} else {
    assert.equal(result, 'back');
}
process.stdout.write('Details verified.\n');
