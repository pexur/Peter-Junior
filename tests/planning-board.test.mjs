import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

async function load(path, replace) {
  const source = replace(await readFile(new URL(path, import.meta.url), 'utf8')).replace('import { useI18n } from "./i18n/provider";', 'const useI18n = () => ({ tr: value => value, sample: value => value });');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: '__element', jsxFragmentFactory: '__fragment' } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('idea creation is atomic, retry-safe and uses one database round trip', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../db/seed.sql', import.meta.url), 'utf8'));
  sqlite.exec('DELETE FROM planning_cards');
  let trips = 0;
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args) });
  globalThis.__boardDb = { prepare, batch: async (statements) => {
    trips++;
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(({ sql, values }) => ({ results: sqlite.prepare(sql).all(...values) }));
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  try {
    const api = await load('../app/api/board/route.ts', s => s.replace('import { getD1 } from "../../../db";', 'const getD1 = () => globalThis.__boardDb;'));
    const post = (payload) => api.POST(new Request('http://test/api/board', { method: 'POST', body: JSON.stringify(payload) }));
    const payload = { action: 'createCard', id: 'idea-1', columnId: 'default-work', title: '  An idea  ', notes: ' Notes ' };
    let response = await post(payload);
    assert.equal(response.status, 200);
    assert.equal(trips, 1);
    let board = await response.json();
    assert.equal(board.cards[0].title, 'An idea');
    assert.equal(board.cards[0].notes, 'Notes');
    assert.equal(board.cards[0].subTag, '');
    assert.equal(board.cards[0].position, 1);
    response = await post(payload);
    assert.equal(response.status, 200);
    board = await response.json();
    assert.equal(board.cards.length, 1, 'retry cannot insert another copy');
    response = await post({ ...payload, id: 'idea-2' });
    board = await response.json();
    assert.equal(board.cards.length, 2, 'a distinct draft may intentionally have the same title');
    assert.equal(board.cards[1].position, 2);
    response = await post({ ...payload, id: 'missing-area', columnId: 'missing' });
    assert.equal(response.status, 409);
    response = await post({ action: 'updateCard', cardId: 'idea-1', title: 'An idea', notes: 'Notes', columnId: 'default-study', subTag: '  TypeScript  ' });
    assert.equal(response.status, 200);
    board = await response.json();
    assert.equal(board.cards.find(c => c.id === 'idea-1').subTag, 'typescript');
    assert.equal(board.cards.find(c => c.id === 'idea-1').columnId, 'default-study');
    response = await post({ action: 'updateCard', cardId: 'idea-1', title: 'An idea', columnId: 'missing', subTag: 'bad' });
    assert.equal(response.status, 409);
    response = await post({ action: 'updateCard', cardId: 'idea-1', title: 'An idea', subTag: '' });
    assert.equal((await response.json()).cards.find(c => c.id === 'idea-1').subTag, '');
    sqlite.exec("UPDATE planning_columns SET status = 'removed' WHERE id = 'default-work'");
    response = await post({ ...payload, id: 'removed-area' });
    assert.equal(response.status, 409);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM planning_cards').get().count, 2);
  } finally { sqlite.close(); delete globalThis.__boardDb; }
});

test('slow saves block double-click and Enter, preserve failed drafts and reuse retry IDs', async () => {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { return hooks.useState({ current: initial })[0]; },
  };
  globalThis.__boardHooks = hooks;
  try {
    const { PlanningBoard } = await load('../app/planning-board.tsx', s => s.replace('import { useRef, useState } from "react";', `const { useRef, useState } = globalThis.__boardHooks;
      const __fragment = 'fragment'; const __element = (type, props, ...children) => ({ type, props: { ...props, children } });`));
    const requests = [];
    let tree;
    const props = { board: { columns: [{ id: 'work', title: 'Work', position: 1, createdAt: '' }], cards: [{ id: 'existing', columnId: 'work', title: 'Existing', notes: '', position: 1, createdAt: '' }] }, collapsed: false, status: '', armedCardId: null, onCollapsedChange() {}, onArmCard() {}, onAction: payload => new Promise(resolve => requests.push({ payload, resolve })) };
    const render = () => { cursor = 0; tree = PlanningBoard(props); };
    const find = predicate => { let result; const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (predicate(n)) result = n; walk(n.props?.children); }; walk(tree); assert.ok(result); return result; };
    const button = text => find(n => n.type === 'button' && n.props.children.includes(text));
    const title = () => find(n => n.props?.['aria-label'] === 'New idea title');
    const tick = () => new Promise(resolve => setImmediate(resolve));
    render();
    title().props.onChange({ target: { value: 'My idea' } });
    render();
    const add = button('Add idea');
    add.props.onClick(); add.props.onClick();
    title().props.onKeyDown({ key: 'Enter', preventDefault() {} });
    assert.equal(requests.length, 1, 'even calls before rerender are guarded');
    render();
    assert.equal(button('Saving…').props.disabled, true);
    requests[0].resolve(false); await tick(); render();
    assert.equal(title().props.value, 'My idea');
    button('Add idea').props.onClick();
    assert.equal(requests[1].payload.id, requests[0].payload.id);
    requests[1].resolve(true); await tick(); render();
    assert.equal(title().props.value, '');
    title().props.onChange({ target: { value: 'My idea' } }); render();
    button('Add idea').props.onClick();
    assert.notEqual(requests[2].payload.id, requests[0].payload.id);
    requests[2].resolve(true); await tick(); render();
    button('Edit').props.onClick(); render();
    const save = button('Save'); save.props.onClick(); save.props.onClick();
    assert.equal(requests.length, 4);
    render();
    assert.equal(find(n => n.type === 'fieldset' && n.props.className.includes('is-editing')).props.disabled, true);
    requests[3].resolve(false); await tick(); render();
    assert.ok(button('Save'));
    button('Cancel').props.onClick(); render();
    props.board.cards.push({ id: 'tagged', title: 'Beacon idea', notes: '', columnId: 'work', subTag: 'project beacon', createdAt: '', position: 2 });
    render();
    const filter = () => find(n => n.props?.['aria-label'] === 'Filter by sub-tag');
    filter().props.onChange({ target: { value: 'project beacon' } }); render();
    assert.equal(find(n => n.props?.className === 'idea-grid').props.children[0].length, 1);
    assert.ok(find(n => n.type === 'strong' && n.props.children.includes('Beacon idea')));
    filter().props.onChange({ target: { value: '' } }); render();
    assert.equal(find(n => n.props?.className === 'idea-grid').props.children[0].length, 1);
    assert.ok(find(n => n.type === 'strong' && n.props.children.includes('Existing')));
    filter().props.onChange({ target: { value: 'project willow' } }); render();
    assert.ok(find(n => n.props?.className === 'idea-empty'));
    button('Clear filters').props.onClick(); render();
    assert.equal(find(n => n.props?.className === 'idea-grid').props.children[0].length, 2);
  } finally { delete globalThis.__boardHooks; }
});
