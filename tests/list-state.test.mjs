import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

async function loadTs(path, replace = (source) => source) {
  const source = replace(await readFile(new URL(path, import.meta.url), 'utf8'));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: '__element', jsxFragmentFactory: '__fragment' } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { applyMutation, ListMutationQueue } = await loadTs('../app/list-state.ts');
const row = (id, parentId = null, position = 1) => ({ id, parentId, position, title: id, kind: 'item', isDraft: false, notes: '', didAt: null, createdAt: '2026-08-28 00:00:00' });
const initial = { nodes: [row('a'), row('b', null, 2)], history: [], reviews: [] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('pending create, rename and nest are immediate and survive older responses', async () => {
  const requests = [];
  const queue = new ListMutationQueue((change) => new Promise((resolve) => requests.push({ change, resolve })), () => {});
  queue.reset(initial);
  const create = queue.enqueue({ action: 'createNode', id: 'c', afterId: 'a' });
  const rename = queue.enqueue({ action: 'updateNode', id: 'c', title: 'New task' });
  const nest = queue.enqueue({ action: 'moveNode', id: 'c', parentId: 'a' });
  assert.equal(requests.length, 1);
  assert.equal(queue.current.nodes.find((n) => n.id === 'c').title, 'New task');
  assert.equal(queue.current.nodes.find((n) => n.id === 'c').parentId, 'a');
  let server = initial;
  for (let i = 0; i < 3; i++) {
    server = applyMutation(server, requests[i].change);
    requests[i].resolve(server);
    await tick();
    assert.equal(queue.current.nodes.find((n) => n.id === 'c').title, 'New task');
    assert.equal(queue.current.nodes.find((n) => n.id === 'c').parentId, 'a');
  }
  await Promise.all([create, rename, nest]);
  assert.deepEqual(queue.current, server);
});

test('failed save rolls back and cancels dependent requests; queue remains usable', async () => {
  let fail;
  let calls = 0;
  const queue = new ListMutationQueue(() => { calls++; return new Promise((_, reject) => { fail = reject; }); }, () => {});
  queue.reset(initial);
  const first = queue.enqueue({ action: 'createNode', id: 'c' });
  const second = queue.enqueue({ action: 'updateNode', id: 'c', title: 'Later' });
  const results = Promise.allSettled([first, second]);
  fail(new Error('offline'));
  assert.ok((await results).every((r) => r.status === 'rejected'));
  assert.deepEqual(queue.current, initial);
  assert.equal(calls, 1);
  const retry = queue.enqueue({ action: 'doneNode', id: 'a' });
  const rejected = assert.rejects(retry, /offline/);
  assert.equal(calls, 2);
  fail(new Error('offline'));
  await rejected;
});

test('newer renames remain visible while earlier rename is acknowledged', async () => {
  const requests = [];
  const queue = new ListMutationQueue((change) => new Promise((resolve) => requests.push({ change, resolve })), () => {});
  queue.reset(initial);
  const first = queue.enqueue({ action: 'updateNode', id: 'a', title: 'First' });
  const second = queue.enqueue({ action: 'updateNode', id: 'a', title: 'Second' });
  requests[0].resolve(applyMutation(initial, requests[0].change));
  await tick();
  assert.equal(queue.current.nodes[0].title, 'Second');
  requests[1].resolve(applyMutation(initial, requests[1].change));
  await Promise.all([first, second]);
});

test('completion removes descendants without mutating confirmed state', () => {
  const state = { nodes: [row('a'), row('b', 'a'), row('c', 'b'), row('d')], history: [], reviews: [] };
  const result = applyMutation(state, { action: 'doneNode', id: 'a' });
  assert.deepEqual(result.nodes.map((n) => n.id), ['d']);
  assert.equal(state.nodes.length, 4);
});

test('API persists edits using migrated schema, without setup or maintenance queries', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_initial.sql']) {
    sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  }
  const queries = [];
  const prepare = (sql, values = []) => ({
    bind: (...args) => prepare(sql, args),
    all: async () => { queries.push(sql); return { results: sqlite.prepare(sql).all(...values) }; },
    first: async () => { queries.push(sql); return sqlite.prepare(sql).get(...values) ?? null; },
    run: async () => { queries.push(sql); return { meta: sqlite.prepare(sql).run(...values) }; },
  });
  globalThis.__listTestDb = { prepare, batch: async (statements) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const api = await loadTs('../app/api/state/route.ts', (source) => source.replace('import { getD1 } from "../../../db";', 'const getD1 = () => globalThis.__listTestDb;'));
  const post = async (payload) => {
    const response = await api.POST(new Request('http://test/api/state', { method: 'POST', body: JSON.stringify(payload) }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  try {
    assert.deepEqual((await (await api.GET()).json()).nodes, []);
    assert.equal(queries.length, 3);
    const id = crypto.randomUUID();
    const child = crypto.randomUUID();
    await post({ action: 'createNode', id });
    queries.length = 0;
    let state = await post({ action: 'updateNode', id, title: 'Parent' });
    assert.equal(state.nodes[0].title, 'Parent');
    assert.equal(queries.length, 6); // lookup, update, history insert, and three state reads
    state = await post({ action: 'createNode', id: child, parentId: id });
    assert.equal(state.nodes.find((n) => n.id === id).kind, 'list');
    state = await post({ action: 'updateNode', id: child, title: '' });
    assert.ok(state.nodes.some((n) => n.id === child && n.isDraft), 'empty draft save must not delete the row');
    await post({ action: 'updateNode', id: child, title: 'Child' });
    state = await post({ action: 'moveNode', id: child, parentId: null, afterId: id });
    assert.equal(state.nodes.find((n) => n.id === child).parentId, null);
    state = await post({ action: 'tagNode', id: child, mode: 'work', workType: 'research' });
    assert.equal(state.nodes.find(n => n.id === child).workType, 'research');
    await post({ action: 'startNode', id: child });
    state = await (await api.GET()).json();
    assert.equal(state.nodes.find(n => n.id === child).focused, true, 'focus survives reload');
    await post({ action: 'updateNode', id: child, title: 'Renamed child', notes: 'Keep these notes' });
    state = await post({ action: 'tagNode', id: child, workType: 'execution' });
    assert.equal(state.nodes.find(n => n.id === child).notes, 'Keep these notes');
    assert.equal(state.nodes.find(n => n.id === child).mode, 'work', 'partial tag edit preserves mode');
    const timed = crypto.randomUUID();
    await post({ action: 'createNode', id: timed, title: 'Timed work', mode: 'work', estimatedMinutes: 90 });
    state = await (await api.GET()).json();
    assert.equal(state.nodes.find(n => n.id === timed).estimatedMinutes, 90, 'estimate survives reload');
    await post({ action: 'tagNode', id: timed, estimatedMinutes: 45 });
    await post({ action: 'updateNode', id: timed, title: 'Renamed timed work' });
    state = await (await api.GET()).json();
    assert.equal(state.nodes.find(n => n.id === timed).estimatedMinutes, 45, 'edits persist and renaming preserves the estimate');
    for (const estimatedMinutes of [0, -1, 1.5, '30', 525601]) {
      const result = await api.POST(new Request('http://test/api/state', {method: 'POST', body: JSON.stringify({action:'tagNode', id:timed, estimatedMinutes})}));
      assert.equal(result.status, 400);
    }
    const second = crypto.randomUUID();
    await post({ action: 'createNode', id: second, title: 'Second focus', mode: 'relax' });
    state = await post({ action: 'startNode', id: second });
    assert.deepEqual(state.nodes.filter(n => n.focused).map(n => n.id), [second], 'only one task in focus');
    state = await post({ action: 'didNode', id: second });
    assert.equal(state.nodes.find(n => n.id === second).focused, false);
    assert.ok(state.nodes.find(n => n.id === second).didAt, 'worked-on retains task and records progress');
    await post({ action: 'startNode', id: child });
    state = await post({ action: 'pauseNode', id: child });
    assert.equal(state.nodes.find(n => n.id === child).focused, false);
    assert.equal((await api.POST(new Request('http://test/api/state', {method:'POST', body:JSON.stringify({action:'tagNode', id:child, workType:'invalid'})}))).status, 400);
    await post({ action: 'startNode', id: child });
    state = await post({ action: 'doneNode', id: child });
    assert.ok(!state.nodes.some((n) => n.id === child));
    assert.equal(state.history[0].action, 'item_done');
    await post({ action: 'saveReview', date: '2020-01-01', notes: 'An issue to address', starred: true });
    await post({ action: 'saveReview', date: '2020-01-01', notes: 'Updated issue' });
    for (let i = 0; i < 370; i++) {
      const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      sqlite.prepare('INSERT INTO daily_reviews (date, notes) VALUES (?, ?)').run(date, 'Another day');
    }
    state = await (await api.GET()).json();
    assert.equal(state.reviews.length, 366);
    assert.deepEqual(state.reviews.find(r => r.date === '2020-01-01').starred, true, 'star survives editing, reloads and 365 newer entries');
    await post({ action: 'setReviewStar', date: '2020-01-01', starred: false });
    const stored = sqlite.prepare('SELECT notes, starred FROM daily_reviews WHERE date = ?').get('2020-01-01');
    assert.equal(stored.notes, 'Updated issue', 'unstar keeps original journal note');
    assert.equal(stored.starred, 0);
    await post({ action: 'setReviewStar', date: '2020-01-01', starred: true });
    for (const payload of [
      { action: 'saveReview', date: '2026-09-18', notes: '', starred: true },
      { action: 'setReviewStar', date: '2020-01-01', starred: 'false' },
    ]) {
      assert.equal((await api.POST(new Request('http://test/api/state', { method: 'POST', body: JSON.stringify(payload) }))).status, 400);
    }
    state = await post({ action: 'ensureCategories' });
    assert.equal(state.nodes.filter(n => n.id.startsWith('default-category-')).length, 5);
    state = await post({ action: 'ensureCategories' });
    assert.equal(state.nodes.filter(n => n.id.startsWith('default-category-')).length, 5);
    const study = state.nodes.find(n => n.title === 'Study');
    const lesson = crypto.randomUUID();
    await post({ action: 'createNode', id: lesson, title: 'Lesson one', parentId: study.id });
    const rejected = async payload => assert.equal((await api.POST(new Request('http://test/api/state', { method: 'POST', body: JSON.stringify(payload) }))).status, 400);
    await rejected({ action: 'removeNode', id: study.id });
    await rejected({ action: 'removeNode', id: study.id, confirmTitle: 'Study' });
    await rejected({ action: 'doneNode', id: study.id });
    await rejected({ action: 'moveNode', id: study.id, parentId: lesson });
    await post({ action: 'moveNode', id: lesson, parentId: null });
    await post({ action: 'removeNode', id: study.id, confirmTitle: 'Study' });
    state = await post({ action: 'ensureCategories' });
    assert.ok(!state.nodes.some(n => n.title === 'Study'), 'removed default must stay removed');
    assert.ok(state.nodes.some(n => n.id === lesson), 'moving preserves the item');
    const oldRelax = crypto.randomUUID();
    sqlite.prepare("INSERT INTO nodes (id, title, kind, status, notes) VALUES (?, '放松', 'list', 'active', 'Original notes')").run(oldRelax);
    const newRelax = state.nodes.find(n => n.title === 'Relax');
    const game = crypto.randomUUID();
    await post({ action: 'createNode', id: game, title: 'Chess', parentId: newRelax.id });
    await post({ action: 'updateNode', id: newRelax.id, title: 'Relax', notes: 'New notes' });
    state = await post({ action: 'ensureCategories' });
    assert.equal(state.nodes.filter(n => n.title === 'Relax').length, 1);
    assert.equal(state.nodes.find(n => n.title === 'Relax').id, oldRelax);
    assert.equal(state.nodes.find(n => n.id === game).parentId, oldRelax);
    assert.equal(state.nodes.find(n => n.id === oldRelax).notes, 'Original notes\n\nNew notes');
    state = await post({ action: 'ensureCategories' });
    assert.equal(state.nodes.find(n => n.id === oldRelax).notes, 'Original notes\n\nNew notes', 'reconciliation is idempotent');
    const duplicate = await api.POST(new Request('http://test/api/state', { method: 'POST', body: JSON.stringify({ action: 'createNode', id: crypto.randomUUID(), kind: 'list', title: '放松' }) }));
    assert.equal(duplicate.status, 409, 'aliases cannot create duplicate categories');
    await rejected({ action: 'removeCategory', id: oldRelax, confirmTitle: 'wrong' });
    state = await post({ action: 'removeCategory', id: oldRelax, confirmTitle: 'Relax' });
    assert.equal(state.nodes.find(n => n.id === game).parentId, null);
    assert.ok(!state.nodes.some(n => n.id === oldRelax));
    state = await post({ action: 'ensureCategories' });
    assert.ok(!state.nodes.some(n => n.title === 'Relax'), 'deleted consolidated category stays deleted');
    assert.ok(queries.every((sql) => !/CREATE |PRAGMA|FROM categories|FROM items/.test(sql)));
  } finally { sqlite.close(); delete globalThis.__listTestDb; }
});

test('named categories and items appear immediately in optimistic state', () => {
  const state = applyMutation(initial, { action: 'createNode', id: 'group', title: 'Reading', kind: 'list' });
  assert.equal(state.nodes.at(-1).kind, 'list');
  assert.equal(state.nodes.at(-1).isDraft, false);
  const next = applyMutation(state, { action: 'createNode', id: 'task', title: 'Chapter one', parentId: 'group' });
  assert.equal(next.nodes.at(-1).title, 'Chapter one');
  assert.equal(next.nodes.at(-1).parentId, 'group');
});

test('empty title updates preserve drafts, including any nested items', () => {
  const state = { nodes: [{ ...row('draft'), title: '', isDraft: true }, row('child', 'draft')], history: [], reviews: [] };
  assert.deepEqual(applyMutation(state, { action: 'updateNode', id: 'draft', title: '' }), state);
});

test('deleting a category preserves nested items in its parent', () => {
  const state = { nodes: [row('root'), { ...row('group', 'root'), kind: 'list' }, row('child', 'group'), row('grandchild', 'child')], history: [], reviews: [] };
  const next = applyMutation(state, { action: 'removeCategory', id: 'group', confirmTitle: 'group' });
  assert.equal(next.nodes.find(n => n.id === 'child').parentId, 'root');
  assert.equal(next.nodes.find(n => n.id === 'grandchild').parentId, 'child');
  assert.equal(next.nodes.length, 3);
});
