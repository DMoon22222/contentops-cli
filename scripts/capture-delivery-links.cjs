'use strict';
// Static template expansion only: no browser, network, shell, CLI or business writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function element() {
  const children = new Map();
  return {
    innerHTML: '', dataset: {}, childElementCount: 0,
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener() {}, setAttribute() {}, removeAttribute() {},
    append() {}, replaceChildren() {}, focus() {}, scrollIntoView() {}
  };
}
const main = element();
const document = {
  querySelector(selector) { return selector === 'main' ? main : element(); },
  querySelectorAll() { return []; }, createElement: element
};
const window = {addEventListener() {}, scrollTo() {}};
const sandbox = vm.createContext({window, document, location: {hash: ''}, navigator: {}});
for (const file of ['data.js', 'seed.js', 'cli-engine.js', 'playground.js', 'docs/links.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'demo', file), 'utf8'), sandbox, {timeout: 10000});
  // In a browser window === globalThis; the synthetic VM has a separate window object.
  if (file === 'cli-engine.js') window.ContentOpsDemo = sandbox.ContentOpsDemo;
}
let source = fs.readFileSync(path.join(root, 'demo/app.js'), 'utf8');
const end = source.lastIndexOf('})();');
if (end < 0) throw Error('app.js template boundary changed; review static audit adapter');
source = source.slice(0, end) + `
window.deliverySnapshot = config => {
  Object.assign(state, config);
  render();
  return main.innerHTML + (state.route === 'demo' ? main.querySelector('#cli-playground').innerHTML : '');
};
` + source.slice(end);
vm.runInContext(source, sandbox, {timeout: 10000});
const snapshots = [];
function capture(name, config) {
  snapshots.push({name, html: window.deliverySnapshot(config)});
}
capture('product', {route: 'product'});
capture('technical', {route: 'technical'});
for (let command = 0; command < 7; command++) {
  for (const exampleMode of ['preview', 'execute']) {
    capture(`command-${command}-${exampleMode}`, {route: 'demo', command, exampleMode});
  }
}
for (const fault of Object.keys(window.DEMO_DATA.faults)) {
  capture(fault, {route: 'demo', fault, recovery: false});
}
capture('independent-tag-recovery', {route: 'demo', fault: 'tags-reject-before-write', recovery: true});
const provenance = [];
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.source === 'string' && value.source.startsWith('evidence/') && value.stdout !== undefined) {
    for (const suffix of ['.stdout.txt', '.stderr.txt', '.exit-code.txt']) provenance.push(value.source + suffix);
  }
  for (const child of Object.values(value)) visit(child);
}
visit(window.DEMO_DATA);
process.stdout.write(JSON.stringify({
  method: 'Static JS template expansion with synthetic DOM; not browser interaction verification',
  virtual_fragments: ['product', 'demo', 'technical', 'overview', 'commands', 'task2', 'faults', 'agent'],
  reading_map: window.REVIEW_DOCUMENTS,
  provenance: [...new Set(provenance)].sort(), snapshots
}));
