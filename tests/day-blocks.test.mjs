import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
async function load(path, replace = s => s) {
  const source = replace(await readFile(new URL(path, import.meta.url), 'utf8'));
  const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const helpers = await load('../app/day-blocks.ts');
const {rangeTimes, groupDaySlots, slotsSnapshot} = helpers;
test('contiguous slots join, while gaps and different activities stay separate', () => {
  const slot = (time, id='a') => ({date:'2026-09-21',time,itemId:id,itemTitle:id,categoryName:'Work',createdAt:'2026-09-21 10:00:00'});
  const blocks = groupDaySlots([slot('09:30'),slot('09:00'),slot('09:15'),slot('10:00'),slot('10:15','b')]);
  assert.deepEqual(blocks.map(b=>[b.start,b.duration,b.title]),[['09:00',45,'a'],['10:00',15,'a'],['10:15',15,'b']]);
  assert.equal(rangeTimes('21:45',30),null);
  assert.equal(rangeTimes('09:07',30),null);
  assert.equal(rangeTimes('09:00',NaN),null);
  assert.equal(rangeTimes('04:45',30),null);
  assert.deepEqual(rangeTimes('21:30',30),['21:30','21:45']);
});
test('range edits persist atomically, reject collisions and stale snapshots, and retain actual time totals', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
  const prepare = (sql,args=[]) => ({bind:(...values)=>prepare(sql,values),all:async()=>({results:sqlite.prepare(sql).all(...args)}),first:async()=>sqlite.prepare(sql).get(...args)??null,run:async()=>({meta:sqlite.prepare(sql).run(...args)})});
  globalThis.__rangeDb={prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  globalThis.__rangeHelpers=helpers;
  globalThis.__rangeReview=await load('../app/time-review.ts');
  const api=await load('../app/api/slots/route.ts',s=>s.replace('import { getD1 } from "../../../db";','const getD1=()=>globalThis.__rangeDb;').replace(/import \{ rangeTimes, type DaySlot \} from "..\/..\/day-blocks";/,'const {rangeTimes}=globalThis.__rangeHelpers;').replace(/import \{ buildTimeReview,.*?from "..\/..\/time-review";/,'const {buildTimeReview,mainCategory,weekRange}=globalThis.__rangeReview;'));
  const date='2026-09-21';
  const read=async()=> (await api.GET(new Request(`http://test/api/slots?date=${date}`))).json();
  const post=async(change,state,code=200)=> {const response=await api.POST(new Request('http://test/api/slots',{method:'POST',body:JSON.stringify({...change,date,expectedSlots:slotsSnapshot(state.slots)})}));assert.equal(response.status,code,await response.clone().text());return response.json();};
  try {
    sqlite.prepare("INSERT INTO nodes (id,title,kind) VALUES ('work','Work','list'),('a','Project','item'),('b','Break','item')").run();
    sqlite.prepare("UPDATE nodes SET parent_id='work' WHERE id IN ('a','b')").run();
    let state=await read();
    state=await post({action:'fillRange',time:'09:00',duration:60,itemId:'a'},state);
    assert.equal(state.slots.length,4);assert.equal(state.timeReview.day[0].actualMinMinutes,60);
    state=await post({action:'replaceRange',time:'09:00',duration:90,sourceTime:'09:00',sourceDuration:60},state);
    assert.equal(state.slots.length,6);
    state=await post({action:'replaceRange',time:'09:15',duration:90,sourceTime:'09:00',sourceDuration:90},state);
    assert.equal(state.slots[0].time,'09:15');assert.equal(state.slots.at(-1).time,'10:30');
    state=await post({action:'fillRange',time:'11:00',duration:30,itemId:'b'},state);
    const before=slotsSnapshot(state.slots);
    await post({action:'replaceRange',time:'10:00',duration:90,sourceTime:'09:15',sourceDuration:90},state,409);
    assert.equal(slotsSnapshot((await read()).slots),before,'collision leaves the entire original block unchanged');
    const stale=state;
    state=await post({action:'replaceRange',time:'09:15',duration:30,sourceTime:'09:15',sourceDuration:90},state);
    const shrunk=slotsSnapshot(state.slots);
    await post({action:'fillRange',time:'14:00',duration:60,itemId:'a'},stale,409);
    assert.equal(slotsSnapshot((await read()).slots),shrunk,'stale writes are rolled back');
    state=await post({action:'clearRange',time:'09:15',duration:30,sourceTime:'09:15',sourceDuration:30},state);
    assert.equal(state.slots.length,2);assert.ok(state.slots.every(s=>s.itemId==='b'));
    await post({action:'fillRange',time:'21:45',duration:30,itemId:'a'},state,400);
    state=await post({action:'fillRange',time:'05:00',duration:360,itemId:'a'},state);
    assert.equal(state.slots.length,26,'long blocks work within D1 binding limits');
  } finally {sqlite.close();delete globalThis.__rangeDb;delete globalThis.__rangeHelpers;delete globalThis.__rangeReview;}
});
