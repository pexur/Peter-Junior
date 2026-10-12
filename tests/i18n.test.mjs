import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('app/i18n/zh.json', root), 'utf8'));
const samples = JSON.parse(await readFile(new URL('app/i18n/samples.json', root), 'utf8'));
function moduleUrl(source) {
  let js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for (const specifier of ['react', 'react/jsx-runtime']) js = js.replaceAll(`"${specifier}"`, JSON.stringify(import.meta.resolve(specifier)));
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const coreUrl = moduleUrl((await readFile(new URL('app/i18n/core.ts', root),'utf8')).replace('import messages from "./zh.json";',`const messages=${JSON.stringify(catalog)};`).replace('import samples from "./samples.json";',`const samples=${JSON.stringify(samples)};`));
const { translate, sampleText, languageOf } = await import(coreUrl);
const providerUrl = moduleUrl((await readFile(new URL('app/i18n/provider.tsx', root),'utf8')).replace('"./core"',JSON.stringify(coreUrl)));
const { LanguageProvider, LanguageToggle } = await import(providerUrl);
const loadComponent = async file => import(moduleUrl((await readFile(new URL(file,root),'utf8')).replace(/"\.\.?\/i18n\/provider"/g,JSON.stringify(providerUrl))));
const { PlanningBoard } = await loadComponent('app/planning-board.tsx');
const { default: ShortcutSetup } = await loadComponent('app/voice/shortcut-setup.tsx');
const render = (language, child) => renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:language},child));

test('both languages render their branding, controls and AI-first Shortcut instructions on the server',()=>{
  const zh=render('zh-CN',React.createElement(React.Fragment,null,React.createElement(LanguageToggle),React.createElement(ShortcutSetup)));
  const en=render('en',React.createElement(ShortcutSetup));
  assert.match(zh,/界面语言/);assert.match(zh,/aria-pressed="true">中/);
  assert.match(zh,/帮我为个人手账设置/);assert.match(zh,/iPhone 详细设置步骤/);
  assert.match(en,/Personal Daily/);assert.match(en,/Detailed iPhone setup steps/);
  assert.doesNotMatch(zh,/Start by asking AI|Generate a secure upload token/);
  assert.match(zh,/total_chunks/); // Protocol keys stay unchanged.
});

test('planning localizes seeded content but preserves user-created text and canonical IDs',()=>{
  const board={columns:[{id:'default-work',title:'Work',position:1,createdAt:''},{id:'custom-category',title:'Work',position:2,createdAt:''}],cards:[{id:'sample-plan-0',columnId:'default-work',title:'Project Beacon: discovery plan',notes:'',subTag:'project beacon',position:1,createdAt:''},{id:'my-card',columnId:'custom-category',title:'Today',notes:'Keep my English notes.',position:2,createdAt:''}]};
  const before=JSON.stringify(board);
  const props={board,collapsed:false,status:'',armedCardId:null,onCollapsedChange:()=>{},onAction:async()=>true,onArmCard:()=>{}};
  const zh=render('zh-CN',React.createElement(PlanningBoard,props));
  assert.match(zh,/灯塔项目：需求调研计划/);assert.match(zh,/灯塔项目/);assert.match(zh,/>工作</);
  assert.match(zh,/>Today</);assert.match(zh,/Keep my English notes\./);assert.match(zh,/value="custom-category">Work</);
  assert.equal(JSON.stringify(board),before);
  assert.match(render('en',React.createElement(PlanningBoard,props)),/Project Beacon: discovery plan/);
});

test('only original values on known sample IDs are translated',()=>{
  assert.equal(sampleText('Work','default-category-0','zh-CN'),'工作');
  assert.equal(sampleText('Work','my-category','zh-CN'),'Work');
  assert.equal(sampleText('My revised project','sample-work-0','zh-CN'),'My revised project');
  assert.equal(sampleText('Work','default-category-0','en'),'Work');
  assert.equal(languageOf('zh-CN'),'zh-CN');assert.equal(languageOf('invalid'),'en');
});

test('dynamic statuses, durations and accessibility labels translate without corrupting unknown strings',()=>{
  assert.equal(translate('1h 30m','zh-CN'),'1 小时 30 分钟');
  assert.equal(translate('30 min','zh-CN'),'30 分钟');
  assert.equal(translate('Remove “Today” from the board?','zh-CN'),'从看板移除“Today”？');
  assert.equal(translate('2 audios are ready to review below. 1 still needs attention.','zh-CN'),'2 段录音可在下方审核，还有 1 段需要处理。');
  assert.equal(translate('home','zh-CN'),'home');assert.equal(translate('strength','zh-CN'),'strength');
  assert.equal(translate('Could not load the planning board.','zh-CN'),'无法加载计划看板。');
});
