// Build-time evidence extraction only. The browser loads data.js without fetch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const hashes = {};
function raw(p) {
  const bytes = fs.readFileSync(path.join(root, p));
  hashes[p] = crypto.createHash('sha256').update(bytes).digest('hex');
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}
const json = p => JSON.parse(raw(p));
function record(base, command) {
  const stdout = raw(base + '.stdout.txt');
  const stderr = raw(base + '.stderr.txt');
  const exit = Number(raw(base + '.exit-code.txt').trim());
  const result = JSON.parse(stdout);
  if (result.exit_code !== exit) throw Error('Inconsistent exit code: ' + base);
  return {source: base, command, stdout, stderr, exit, result};
}
const task = {};
for (const name of ['03-pending-page1-json','05-candidate-ct000004-detail',
  '07-candidate-ct000004-history','08-active-tags','10-process-preview',
  '13-process-execute','14-after-detail','15-after-history',
  '16-after-pending-exact','17-after-pending-total']) {
  const base = 'evidence/task2/commands/' + name;
  task[name] = record(base, json(base + '.started.json').command);
}
const summary = json('evidence/s5/summary.json');
const faults = {};
for (const name of ['tags-reject-before-write','review-commit-response-lost',
  'tags-commit-response-lost','review-readback-mismatch','tags-readback-mismatch']) {
  const command = suffix => {
    const id = name + suffix;
    const meta = summary.commands.find(c => c.name === id);
    if (!meta) throw Error('Missing command ' + id);
    return record('evidence/s5/commands/' + id, meta.command);
  };
  faults[name] = {facts: json('evidence/s5/scenarios/' + name + '/result.json'),
    process: command('-04-process'), query: command('-05-query-no-fault'),
    history: command('-06-history-no-fault')};
  if (name === 'tags-reject-before-write') {
    faults[name].recovery = command('-08-tags-only-recovery');
    faults[name].recoveredQuery = command('-09-recovered-query');
    faults[name].recoveredHistory = command('-10-recovered-history');
  }
}
const data = {task, faults, taskFacts: json('evidence/task2/after/snapshot-facts.json')};
const output = '// Generated from immutable evidence by evidence/demo/export-data.cjs.\n' +
  '"use strict";\nwindow.DEMO_DATA = ' + JSON.stringify(data, null, 2) + ';\n';
fs.mkdirSync(path.join(root, 'demo'), {recursive:true});
fs.writeFileSync(path.join(root, 'demo/data.js'), output);
fs.writeFileSync(path.join(__dirname, 'source-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log('Exported ' + Object.keys(task).length + ' task2 records, ' + Object.keys(faults).length +
  ' fault scenarios; ' + Object.keys(hashes).length + ' source hashes. No business state accessed.');
