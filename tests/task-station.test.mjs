import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the component's event handlers with persistent hook state.
async function stationHarness(mutate, nodes) {
  const values = []; let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initial) { const [ref] = this.useState({ current: initial }); return ref; },
    useEffect() {},
  };
  const key = `stationTest${Math.random().toString(36).slice(2)}`;
  globalThis[key] = hooks;
  let source = (await readFile(new URL('../app/task-station.tsx', import.meta.url), 'utf8')).replace('import { LanguageToggle, useI18n } from "./i18n/provider";', 'const useI18n = () => ({ tr: value => value, sample: value => value }); const LanguageToggle = () => null;');
  source = source.replace(/import .* from "react";/, `const {useState,useEffect} = globalThis.${key}; const useRef = globalThis.${key}.useRef.bind(globalThis.${key});`)
    .replace(/import .* from "\.\/time-estimate";/, 'const TimeEstimateEditor = () => null; const formatEstimate = n => `${n} minutes`;')
    .replace(/import styles .*;/, 'const styles = new Proxy({}, {get: (_, key) => key});');
  source = `const element = (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)});\n${source}`;
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'element' } });
  const { TaskStation } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const node = {id:'a', title:'Write outline', notes:'First draft', kind:'item', parentId:null, isDraft:false, mode:'work'};
  let exited = false;
  const render = () => { cursor = 0; return TaskStation({nodes:nodes || [node], loading:false, pending:0, error:'', mutate, onExit: () => { exited = true; }}); };
  const all = root => [root, ...(root?.children || []).flatMap(child => typeof child === 'object' && child ? all(child) : [])];
  const find = predicate => all(render()).find(predicate);
  return { find, render, exited: () => exited, cleanup: () => delete globalThis[key] };
}

test('checkmarks retain tasks, can be undone, and only complete on exit', async () => {
  const changes = [];
  const h = await stationHarness(async change => { changes.push(change); });
  const check = () => h.find(n => n.type === 'input' && n.props.type === 'checkbox');
  check().props.onChange();
  assert.equal(check().props.checked, true);
  assert.ok(h.find(n => n.type === 'article' && n.props.className.includes('completed')));
  assert.deepEqual(changes, []);
  check().props.onChange(); assert.equal(check().props.checked, false);
  check().props.onChange();
  await h.find(n => n.type === 'button' && n.children.includes('Turn off workstation')).props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(changes, [{action:'doneNode', id:'a'}]);
  assert.equal(h.exited(), true); h.cleanup();
});

test('checked tasks remain editable and exit saves details before completing', async () => {
  const changes = [];
  const h = await stationHarness(async change => { changes.push(change); });
  h.find(n => n.props.type === 'checkbox').props.onChange();
  h.find(n => n.children.includes('Edit task')).props.onClick();
  h.find(n => n.type === 'textarea').props.onChange({target:{value:'Added a detailed plan'}});
  h.find(n => n.children.includes('Turn off workstation')).props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(changes.map(c => c.action), ['updateNode', 'doneNode']);
  assert.equal(changes[0].notes, 'Added a detailed plan');
  assert.equal(h.exited(), true); h.cleanup();
});

test('failed completion keeps the session and checkmark for retry', async () => {
  const h = await stationHarness(async () => { throw new Error('Offline'); });
  h.find(n => n.props.type === 'checkbox').props.onChange();
  h.find(n => n.children.includes('Turn off workstation')).props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.exited(), false);
  assert.equal(h.find(n => n.props.type === 'checkbox').props.checked, true);
  assert.equal(h.find(n => n.children.includes('Turn off workstation')).props.disabled, false);
  h.cleanup();
});


test('workstation only lists work tasks, including nested Work items and explicit work tags', async () => {
  const item = (id, parentId = null, mode = '') => ({id, title:id, notes:'', kind:'item', parentId, mode, isDraft:false});
  const nodes = [
    {id:'work', title:'Work', kind:'list', parentId:null},
    {id:'project', title:'Project', kind:'list', parentId:'work'},
    {id:'games', title:'Games', kind:'list', parentId:null},
    item('nested-work', 'project'), item('tagged-work', null, 'work'),
    item('game', 'games'), item('personal'), item('relax-override', 'work', 'relax'),
    {...item('draft', 'work'), isDraft:true},
  ];
  const h = await stationHarness(async () => {}, nodes);
  for (const id of ['nested-work', 'tagged-work']) assert.ok(h.find(n => n.props['aria-label'] === `Check off ${id}`));
  for (const id of ['game', 'personal', 'relax-override', 'draft']) assert.equal(h.find(n => n.props['aria-label'] === `Check off ${id}`), undefined);
  h.find(n => n.props.type === 'search').props.onChange({target:{value:'game'}});
  assert.equal(h.find(n => n.props.type === 'checkbox'), undefined);
  h.cleanup();
});
