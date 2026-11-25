const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  let listener, starts = 0, release;
  const writes = [], opened = [];
  const window = {addEventListener() {}, dispatchEvent(event) { opened.push(event.detail.threadId); }};
  const phone = {
    capabilities: async () => ({paths: {files: '/test'}, overlay: true}),
    call: async (_, params) => writes.push(JSON.parse(params.text)),
    on: (_, fn) => { listener = fn; return () => {}; },
    start: async () => { starts++; },
  };
  const context = {window, phone, fetch: async () => ({ok: true, text: async () => ''}),
    crypto: {randomUUID: () => 'owner'}, console, Date, CustomEvent: class { constructor(_, options) { this.detail = options.detail; } },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval};
  vm.runInNewContext(fs.readFileSync('server/web/assets/progress-controller.js', 'utf8'), context);

  const progress = window.AICTProgress;
  let calls = 0;
  const a = {id: 'a', turnId: 'ta', sessionName: 'A'};
  const b = {id: 'b', turnId: 'tb', sessionName: 'B', request: {
    req: {id: 7, method: 'item/tool/requestUserInput', params: {
      questions: [{id: 'q', question: 'Choose', options: [{label: 'A'}]}],
    }},
    respond: async result => {
      calls++;
      assert.equal(result.answers.q.answers[0], 'A');
      await new Promise(resolve => { release = resolve; });
      progress.sync([a, {...b, request: null}]);
    },
  }};
  progress.sync([a, b]);
  await tick();
  const state = writes.at(-1);
  assert.deepEqual(state.entries.map(row => row.id), ['a', 'b']);
  assert.equal(state.entries[1].interaction.kind, 'input');
  assert.equal(state.entries[1].interaction.questions[0].options[0].label, 'A');
  assert.equal(starts, 1);

  await listener({owner: 'stale', type: 'open-thread', threadId: 'a'});
  await listener({owner: state.owner, type: 'open-thread', threadId: 'missing'});
  await listener({owner: state.owner, type: 'open-thread', threadId: 'a'});
  assert.deepEqual(opened, ['a']);

  const data = {owner: state.owner, type: 'response', threadId: 'b', requestId: '7', result: {answers: {q: {answers: ['A']}}}};
  await listener({...data, owner: 'stale'});
  await listener({...data, threadId: 'a'});
  assert.equal(calls, 0);
  const inFlight = listener(data);
  progress.sync([a, b]);
  await listener(data);
  assert.equal(calls, 1);
  release();
  await inFlight;
  await tick();
  assert.equal(writes.at(-1).entries[1].interaction, null);

  progress.sync([b]);
  await tick();
  assert.equal(writes.at(-1).done, false);
  assert.deepEqual(writes.at(-1).entries.map(row => row.id), ['b']);
  assert.equal(starts, 1);
  progress.sync([]);
  await tick();
  assert.equal(writes.at(-1).done, true);
  console.log('PASS: one overlay for two turns, per-session interaction routing, and independent completion');
})().catch(error => { console.error(error); process.exitCode = 1; });
