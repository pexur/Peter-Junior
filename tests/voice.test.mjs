import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const typesUrl=moduleUrl(await readFile(new URL('../app/voice-types.ts',import.meta.url),'utf8'));
const {parseProposal,validDate,validTime}=await import(typesUrl);
const {approve}=await import(moduleUrl((await readFile(new URL('../app/voice-approval.ts',import.meta.url),'utf8')).replace('"./voice-types"',JSON.stringify(typesUrl))));
const db=new DatabaseSync(':memory:');
for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) db.exec(await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const prepare=(sql,args=[])=>({bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
const adapter={prepare,batch:async(statements)=>{db.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
db.prepare("INSERT INTO nodes (id,title,kind,status,is_draft) VALUES ('voice-category','Personal','list','active',0)").run();
const base={type:'create_task',target_id:'',destination_id:'voice-category',title:'Market review',notes:'',date:'',time:'',from_date:'',from_time:'',reason:'',needs_clarification:false};
const proposal=overrides=>parseProposal({...base,...overrides});
db.prepare("INSERT INTO voice_captures(id,owner_id,request_id,checksum,filename,local_date,timezone) VALUES ('c','owner','request','checksum','test.m4a','2026-09-06','Asia/Shanghai')").run();
function add(p){const id=crypto.randomUUID();db.prepare('INSERT INTO voice_actions(id,capture_id,proposal) VALUES (?,?,?)').run(id,'c',JSON.stringify(p));return id;}
function apply(id,p,user='owner'){return approve(adapter,id,user,p,db.prepare('SELECT proposal FROM voice_actions WHERE id=?').get(id).proposal);}
const row=id=>db.prepare('SELECT * FROM voice_actions WHERE id=?').get(id);

test('proposal approval is atomic and repeat approvals do not duplicate task/history',async()=>{
 const p=proposal({});const id=add(p);await apply(id,p);assert.equal(row(id).status,'approved');
 const before=db.prepare('SELECT count(*) n FROM nodes').get().n;
 await assert.rejects(()=>apply(id,p),/changed/);assert.equal(db.prepare('SELECT count(*) n FROM nodes').get().n,before);
 assert.equal(db.prepare("SELECT count(*) n FROM history WHERE item_title='Market review'").get().n,1);
});
test('capture deduplication covers both request IDs and identical audio',()=>{
 assert.throws(()=>db.prepare("INSERT INTO voice_captures(id,owner_id,request_id,checksum,filename,local_date,timezone) VALUES ('c2','owner','request','other','x','2026-09-06','UTC')").run(),/UNIQUE/);
 assert.throws(()=>db.prepare("INSERT INTO voice_captures(id,owner_id,request_id,checksum,filename,local_date,timezone) VALUES ('c3','owner','other','checksum','x','2026-09-06','UTC')").run(),/UNIQUE/);
});
test('unauthorized and ambiguous approvals leave all state unchanged',async()=>{
 const p=proposal({title:'Private task'});const id=add(p);await assert.rejects(()=>apply(id,p,'intruder'));assert.equal(row(id).status,'pending');assert.equal(db.prepare("SELECT count(*) n FROM nodes WHERE title='Private task'").get().n,0);
 const ambiguous=proposal({needs_clarification:true});const a=add(ambiguous);await assert.rejects(()=>apply(a,ambiguous),/ambiguity/);assert.equal(row(a).status,'pending');
});
test('occupied schedule is never overwritten and failed move preserves original',async()=>{
 const target=db.prepare("SELECT id FROM nodes WHERE title='Market review'").get().id;
 db.prepare("INSERT INTO daily_slots(date,time,item_id,item_title) VALUES ('2026-09-06','09:00',?,'Market review'),('2026-09-07','10:00','other','Gym')").run(target);
 const p=proposal({type:'move_schedule',target_id:target,from_date:'2026-09-06',from_time:'09:00',date:'2026-09-07',time:'10:00'});const id=add(p);
 await assert.rejects(()=>apply(id,p),/occupied/);assert.equal(row(id).status,'pending');assert.equal(db.prepare("SELECT item_title FROM daily_slots WHERE date='2026-09-07' AND time='10:00'").get().item_title,'Gym');assert.ok(db.prepare("SELECT * FROM daily_slots WHERE date='2026-09-06' AND time='09:00'").get());
 const edit={...p,time:'10:15'};await apply(id,edit);assert.equal(row(id).status,'approved');assert.equal(db.prepare("SELECT count(*) n FROM daily_slots WHERE date='2026-09-06' AND time='09:00'").get().n,0);
});
test('review append preserves existing text and replays cannot append twice',async()=>{
 db.prepare("INSERT INTO daily_reviews(date,notes) VALUES ('2026-09-06','Original note')").run();const p=proposal({type:'review_note',date:'2026-09-06',notes:'New observation'});const id=add(p);await apply(id,p);assert.equal(db.prepare("SELECT notes FROM daily_reviews WHERE date='2026-09-06'").get().notes,'Original note\nNew observation');await assert.rejects(()=>apply(id,p));
});
test('renamed tasks, stale proposals, invalid dates and invalid times cannot silently apply',async()=>{
 const target=db.prepare("SELECT id FROM nodes WHERE title='Market review'").get().id;
 const p=proposal({type:'complete_task',target_id:target});const id=add(p);db.prepare("UPDATE nodes SET title='Updated market review' WHERE id=?").run(target);await assert.rejects(()=>apply(id,p),/title changed/);assert.equal(row(id).status,'pending');
 const other=proposal({title:'Another task'});const a=add(other);await assert.rejects(()=>approve(adapter,a,'owner',other,'stale'),/changed/);
 assert.equal(validDate('2026-02-30'),false);assert.equal(validTime('22:00'),false);assert.equal(validTime('09:07'),false);assert.equal(validTime('09:15'),true);assert.throws(()=>parseProposal({...base,type:'delete_database'}));
});

// Exercise the actual capture routes and processing stages against SQLite with
// only the external AI responses substituted; no paid calls or live data.
globalThis.__voiceDb=adapter;globalThis.__voiceEnv={OPENAI_API_KEY:'test-only'};
const promptUrl=moduleUrl(await readFile(new URL("../app/voice-prompt.ts",import.meta.url),"utf8"));
const serverUrl=moduleUrl((await readFile(new URL('../app/voice-server.ts',import.meta.url),'utf8')).replace('import { env } from "cloudflare:workers";','const env=globalThis.__voiceEnv;').replace('import { getD1 } from "../db";','const getD1=()=>globalThis.__voiceDb;').replace('"./voice-types"',JSON.stringify(typesUrl)).replace('"./voice-prompt"',JSON.stringify(promptUrl)));
const server=await import(serverUrl);
const audioObjects=new Map();
globalThis.__voiceEnv.BUCKET={put:async(key,bytes)=>audioObjects.set(key,bytes.slice(0)),get:async key=>audioObjects.has(key)?{arrayBuffer:async()=>audioObjects.get(key).slice(0)}:null,delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])audioObjects.delete(key);}};
const uploadServerUrl=moduleUrl((await readFile(new URL('../app/voice-upload-server.ts',import.meta.url),'utf8')).replace('import { getD1 } from "../db";','const getD1=()=>globalThis.__voiceDb;').replace('"./voice-server"',JSON.stringify(serverUrl)));
const shortcutUrl=moduleUrl((await readFile(new URL('../app/shortcut-server.ts',import.meta.url),'utf8')).replace('import { env } from "cloudflare:workers";','const env=globalThis.__voiceEnv;').replace('import { getD1 } from "../db";','const getD1=()=>globalThis.__voiceDb;').replace('"./voice-server"',JSON.stringify(serverUrl)).replace('"./voice-upload-server"',JSON.stringify(uploadServerUrl)));
const shortcut=await import(moduleUrl((await readFile(new URL('../app/api/shortcut-upload/route.ts',import.meta.url),'utf8')).replace('"../../shortcut-server"',JSON.stringify(shortcutUrl)).replace('"../../voice-server"',JSON.stringify(serverUrl))));
const {checkSiteAccess}=await import(moduleUrl(await readFile(new URL('../worker/access.ts',import.meta.url),'utf8')));
test('identity-less Shortcut access is confined to POST upload and cannot reveal settings or board',async()=>{
 globalThis.__voiceEnv.SHORTCUT_OWNER_ID='owner';globalThis.__voiceEnv.SHORTCUT_UPLOAD_TOKEN='test-upload-only-secret';
 for(const path of ['/','/voice','/api/state','/api/board','/api/slots','/api/voice-captures','/api/voice-actions/id','/api/shortcut-setup','/api/shortcut-upload/'])for(const method of ['GET','POST'])assert.equal(checkSiteAccess(new Request('https://nextup.test'+path,{method}),'owner').status,401);
 assert.equal(checkSiteAccess(new Request('https://nextup.test/api/shortcut-upload',{method:'POST'}),'owner'),null);
 assert.equal(checkSiteAccess(new Request('https://nextup.test/api/shortcut-upload'),'owner').status,401);
 assert.equal(checkSiteAccess(new Request('https://nextup.test/api/state',{headers:{'oai-authenticated-user-id':'owner'}}),'owner'),null);
 assert.equal(checkSiteAccess(new Request('https://nextup.test/api/state',{headers:{'oai-authenticated-user-id':'other'}}),'owner').status,403);
});
test('Shortcut upload verifies tokens, reassembles Base64 parts and safely repeats completion',async()=>{
 const old=globalThis.fetch;let calls=0;const bytes=Buffer.alloc(1224122,87),encoded=bytes.toString('base64'),parts=encoded.match(/.{1,262144}/g);
 const send=(body,token='test-upload-only-secret')=>shortcut.POST(new Request('https://nextup.test/api/shortcut-upload',{method:'POST',headers:{'content-type':'application/json','x-next-up-token':token},body:JSON.stringify(body)}));
 globalThis.fetch=async(url,options)=>{calls++;if(url.endsWith('transcriptions')){assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()),bytes);return Response.json({text:'I worked out for one hour.'});}return Response.json({choices:[{finish_reason:'stop',message:{content:'{"recording_mode":"actions","actions":[]}'}}]});};
 const meta={action:'start',request_id:'shortcut-integration',filename:'recording.m4a',total_chunks:parts.length,local_date:'2026-09-10',timezone:'Asia/Shanghai'};
 try{
  assert.equal((await send({action:'check'},'wrong')).status,401);assert.equal((await send({action:'check'},'')).status,401);assert.equal(calls,0);
  assert.equal((await (await send({action:'check'})).json()).ready,true);
  const wrongDateType=await send({...meta,local_date:20260910});assert.equal(wrongDateType.status,400);assert.match((await wrongDateType.json()).error,/local_date must be sent as Text; received number/);
  const wrongDateValue=await send({...meta,local_date:'September 10, 2026'});assert.equal(wrongDateValue.status,400);assert.match((await wrongDateValue.json()).error,/received local_date "September 10, 2026" as Text/);
  assert.equal((await send({...meta,request_id:'too-many-parts',total_chunks:55})).status,400);
  assert.equal((await send(meta)).status,200);assert.equal((await send(meta)).status,200);
  assert.equal((await send({...meta,total_chunks:parts.length+1})).status,409);
  assert.equal((await send({action:'complete',request_id:meta.request_id})).status,409);
  assert.equal((await send({action:'chunk',request_id:meta.request_id,part:1,data:'garbage'})).status,400);
  for(let i=0;i<parts.length;i++)assert.equal((await send({action:'chunk',request_id:meta.request_id,part:i+1,data:parts[i]})).status,200);
  assert.equal((await send({action:'chunk',request_id:meta.request_id,part:1,data:parts[0]})).status,200);
  const response=await send({action:'complete',request_id:meta.request_id}),result=await response.json();assert.equal(response.status,200);assert.equal(result.transcript_saved,true);assert.equal(calls,2);assert.equal(audioObjects.size,0);
  assert.equal((await (await send({action:'complete',request_id:meta.request_id})).json()).capture_id,result.capture_id);assert.equal(calls,2);
  assert.equal(db.prepare('SELECT owner_id FROM voice_captures WHERE id=?').get(result.capture_id).owner_id,'owner');
  const oversized=await shortcut.POST(new Request('https://nextup.test/api/shortcut-upload',{method:'POST',headers:{'x-next-up-token':'test-upload-only-secret','x-request-id':'oversized-direct'},body:bytes}));assert.equal(oversized.status,413);
 }finally{globalThis.fetch=old;}
});
async function chunkRoute(path){return import(moduleUrl((await readFile(new URL('../app/api/voice-uploads/'+path,import.meta.url),'utf8')).replace('import { env } from "cloudflare:workers";','const env=globalThis.__voiceEnv;').replace(/import \{ getD1 \} from "[^"]+";/,'const getD1=()=>globalThis.__voiceDb;').replace(/"[^"]*voice-upload-server"/,JSON.stringify(uploadServerUrl)).replace(/"[^"]*voice-server"/,JSON.stringify(serverUrl))));}
const chunkInit=await chunkRoute('route.ts'),chunkPart=await chunkRoute('[id]/[part]/route.ts'),chunkComplete=await chunkRoute('[id]/complete/route.ts');
const chunkRequest=(method,body,user='owner')=>new Request('https://nextup.test/api/voice-uploads',{method,headers:{'oai-authenticated-user-id':user},body});
test('10 MB chunk upload reconstructs exact audio, isolates owners, and deduplicates retries',async()=>{
 const old=globalThis.fetch;const bytes=new Uint8Array(10*1024*1024);bytes.fill(71);let transcriptions=0;
 globalThis.fetch=async(url,options)=>{if(url.endsWith('transcriptions')){transcriptions++;const sent=new Uint8Array(await options.body.get('file').arrayBuffer());assert.deepEqual(sent,bytes);return Response.json({text:'A complete large recording'});}return Response.json({choices:[{finish_reason:'stop',message:{content:'{"recording_mode":"actions","actions":[]}'}}]});};
 const id='chunk-large';const metadata={upload_id:id,filename:'large.m4a',content_type:'audio/mp4',size:bytes.length,total_chunks:20,local_date:'2026-09-09',timezone:'UTC'};
 const init=()=>chunkInit.POST(chunkRequest('POST',JSON.stringify(metadata)));
 const complete=()=>chunkComplete.POST(chunkRequest('POST','{}'),{params:Promise.resolve({id})});
 try{
  assert.equal((await init()).status,200);assert.equal((await init()).status,200);
  assert.equal((await complete()).status,409);assert.equal(transcriptions,0);
  const part=bytes.slice(0,512*1024);
  assert.equal((await chunkPart.PUT(chunkRequest('PUT',part,'intruder'),{params:Promise.resolve({id,part:'0'})})).status,404);
  assert.equal((await chunkPart.PUT(chunkRequest('PUT',part.slice(0,5)),{params:Promise.resolve({id,part:'0'})})).status,400);
  for(let i=0;i<20;i++)assert.equal((await chunkPart.PUT(chunkRequest('PUT',bytes.slice(i*512*1024,(i+1)*512*1024)),{params:Promise.resolve({id,part:String(i)})})).status,200);
  assert.equal((await chunkPart.PUT(chunkRequest('PUT',part),{params:Promise.resolve({id,part:'0'})})).status,200);
  const result=await (await complete()).json();assert.equal(result.transcript_saved,true);assert.equal(transcriptions,1);assert.equal(audioObjects.size,0);
  assert.equal(db.prepare('SELECT count(*) n FROM voice_uploads WHERE id=?').get(id).n,0);
  assert.equal((await init()).status,200);
  for(let i=0;i<20;i++)await chunkPart.PUT(chunkRequest('PUT',bytes.slice(i*512*1024,(i+1)*512*1024)),{params:Promise.resolve({id,part:String(i)})});
  assert.equal((await (await complete()).json()).capture_id,result.capture_id);assert.equal(transcriptions,1);
  const tooLarge=await chunkInit.POST(chunkRequest('POST',JSON.stringify({...metadata,upload_id:'oversize',size:bytes.length+1,total_chunks:21})));assert.equal(tooLarge.status,413);
 }finally{globalThis.fetch=old;}
});
const uploadRoute=await import(moduleUrl((await readFile(new URL('../app/api/voice-captures/route.ts',import.meta.url),'utf8')).replace('import { getD1 } from "../../../db";','const getD1=()=>globalThis.__voiceDb;').replace('"../../voice-server"',JSON.stringify(serverUrl))));
const postAudio=(id,bytes='fake-m4a',signed=true)=>uploadRoute.POST(new Request('https://nextup.test/api/voice-captures',{method:'POST',headers:{...(signed?{'oai-authenticated-user-id':'owner'}:{}),'content-type':'audio/mp4','x-filename':'test.m4a','x-request-id':id,'x-local-date':'2026-09-06','x-timezone':'Asia/Shanghai'},body:bytes}));
test('capture pipeline persists transcript, deduplicates retries, and never applies proposals automatically',async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;return url.endsWith('transcriptions')?Response.json({text:'Add a trading journal task'}):Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recording_mode:'actions',actions:[proposal({title:'Trading journal'})]})}}]});};
 try{
  const result=await (await postAudio('pipeline-1')).json();assert.equal(result.status,'ready');assert.equal(result.transcript_saved,true);assert.equal(result.audio_stored,false);assert.equal(calls,2);
  const again=await (await postAudio('pipeline-1')).json();assert.equal(again.capture_id,result.capture_id);assert.equal(calls,2);
  const manualRetry=await (await postAudio('pipeline-2')).json();assert.equal(manualRetry.capture_id,result.capture_id);assert.equal(calls,2);
  assert.equal(db.prepare("SELECT count(*) n FROM nodes WHERE title='Trading journal'").get().n,0);
  assert.equal((await postAudio('pipeline-1','different')).status,409);assert.equal((await postAudio('unsigned','x',false)).status,401);
 } finally{globalThis.fetch=old;}
});
test('whole-recording reflection mode produces one daily note and cannot become task proposals',async()=>{
 const old=globalThis.fetch;
 const capture={id:'reflection-fixture',local_date:'2026-09-10',timezone:'Asia/Shanghai',transcript:'这几天我一直有一点焦虑。我发现不是事情太多，而是我总觉得自己应该马上有答案。'};
 const note={...base,type:'review_note',title:'Thoughts for the day',notes:'这几天我一直有一点焦虑。我发现不是事情太多，而是我总觉得自己应该马上有答案。',date:'2026-09-09',end_time:'',evidence:'',approximate:false,duration_min:0,duration_max:0,completion:'ongoing'};
 const respond=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
 try {
  globalThis.fetch=async()=>respond({recording_mode:'reflection',actions:[note]});
  const result=await server.generateProposals(capture,{nodes:[]},'gpt-4.1');
  assert.equal(result.actions.length,1);assert.equal(result.actions[0].type,'review_note');assert.equal(result.actions[0].date,'2026-09-10');
  globalThis.fetch=async()=>respond({recording_mode:'reflection',actions:[{...note,type:'record_activity',evidence:'这几天我一直有一点焦虑'}]});
  await assert.rejects(()=>server.generateProposals(capture,{nodes:[]},'gpt-4.1'),/one daily note/);
  globalThis.fetch=async()=>respond({recording_mode:'actions',actions:[note]});
  await assert.rejects(()=>server.generateProposals(capture,{nodes:[]},'gpt-4.1'),/mixed reflection/);
 } finally {globalThis.fetch=old;}
});
test('oversized direct recordings return a useful JSON 413 before any paid processing',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({});};
 try {
  const response=await postAudio('too-large-recording','x'.repeat(851*1024));
  assert.equal(response.status,413);assert.match(response.headers.get('content-type'),/application\/json/);
  const result=await response.json();assert.match(result.error,/850 KB/);assert.equal(result.audio_stored,false);assert.equal(calls,0);
 } finally {globalThis.fetch=old;}
});
test('interpretation failure retains transcript and retry skips transcription',async()=>{
 const old=globalThis.fetch;let transcriptions=0;let fail=true;
 globalThis.fetch=async url=>{if(url.endsWith('transcriptions')){transcriptions++;return Response.json({text:'I need to review today'});}return fail?new Response('',{status:500}):Response.json({choices:[{finish_reason:'stop',message:{content:'{"recording_mode":"actions","actions":[]}'}}]});};
 try{
  const result=await (await postAudio('pipeline-fail','second-file')).json();assert.equal(result.status,'interpretation_failed');assert.equal(result.transcript_saved,true);
  assert.equal((await server.capture(result.capture_id,'owner')).transcript,'I need to review today');fail=false;await server.interpret(result.capture_id,'owner');assert.equal(transcriptions,1);assert.equal((await server.capture(result.capture_id,'owner')).status,'ready');
 }finally{globalThis.fetch=old;}
});
test('failed transcription is visible and same-file reupload recovers without new capture',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:400});
 try{
  const failed=await postAudio('bad-audio','third-file');assert.equal(failed.status,502);const result=await failed.json();assert.equal(result.transcript_saved,false);
  const c=await server.capture(result.capture_id,'owner');assert.equal(c.status,'transcription_failed');assert.equal(c.retryable,0);
  globalThis.fetch=async url=>url.endsWith('transcriptions')?Response.json({text:'A recovered thought'}):Response.json({choices:[{finish_reason:'stop',message:{content:'{"recording_mode":"actions","actions":[]}'}}]});
  const retry=await (await postAudio('bad-audio','third-file')).json();assert.equal(retry.capture_id,result.capture_id);assert.equal(retry.transcript_saved,true);
 }finally{globalThis.fetch=old;}
});
test('processing leases exclude concurrent or redundant paid stages',async()=>{
 const result=await postAudio('lease','lease-file',false);assert.equal(result.status,401);
 const c=db.prepare("SELECT id FROM voice_captures WHERE request_id='pipeline-1'").get();await assert.rejects(()=>server.lease(c.id,'owner','transcribing'),/already/);
});

const actual=(overrides={})=>proposal({type:'record_activity',title:'健身',date:'2026-09-08',time:'10:00',end_time:'11:00',duration_min:60,duration_max:60,approximate:false,completion:'session_done',evidence:'十点到十一点健身',...overrides});
test('one-hour workout creates one activity, four cells, and keeps recurring task open',async()=>{
 const p=actual();const id=add(p);await apply(id,p);
 const session=db.prepare('SELECT * FROM activity_sessions WHERE action_id=?').get(id);
 assert.equal(session.duration_min,60);assert.equal(session.completion,'session_done');assert.equal(db.prepare('SELECT status FROM nodes WHERE id=?').get(session.item_id).status,'active');
 assert.deepEqual(db.prepare('SELECT time FROM daily_slots WHERE date=? AND item_id=? ORDER BY time').all(p.date,session.item_id).map(r=>r.time),['10:00','10:15','10:30','10:45']);
 const event=db.prepare('SELECT occurred_date,occurred_time FROM history WHERE item_title=? ORDER BY id DESC').get(p.title);assert.equal(event.occurred_date,'2026-09-08');assert.equal(event.occurred_time,'11:00');
 await assert.rejects(()=>apply(id,p));assert.equal(db.prepare('SELECT count(*) n FROM activity_sessions WHERE action_id=?').get(id).n,1);
});
test('commute and lunch occupy distinct consecutive intervals',async()=>{
 for(const p of [actual({title:'乘地铁',time:'11:00',end_time:'11:30',duration_min:30,duration_max:30}),actual({title:'吃饭',time:'11:30',end_time:'13:00',duration_min:90,duration_max:90,approximate:true})])await apply(add(p),p);
 assert.equal(db.prepare("SELECT item_title FROM daily_slots WHERE date='2026-09-08' AND time='11:00'").get().item_title,'乘地铁');assert.equal(db.prepare("SELECT item_title FROM daily_slots WHERE date='2026-09-08' AND time='11:30'").get().item_title,'吃饭');
});
test('multiple reading sessions share one task and only explicit finish closes it, even out of order',async()=>{
 const last=actual({title:'The Quiet Garden',time:'15:00',end_time:'16:30',duration_min:90,duration_max:90,completion:'completed'});await apply(add(last),last);
 const first=actual({title:'The Quiet Garden',time:'13:30',end_time:'14:00',duration_min:30,duration_max:30,approximate:true,completion:'ongoing'});await apply(add(first),first);
 const sessions=db.prepare("SELECT item_id FROM activity_sessions WHERE title='The Quiet Garden'").all();assert.equal(sessions.length,2);assert.equal(sessions[0].item_id,sessions[1].item_id);assert.equal(db.prepare('SELECT status FROM nodes WHERE id=?').get(sessions[0].item_id).status,'done');
});
test('unknown start and duration ranges stay visible without fabricated time cells',async()=>{
 const p=actual({title:'另一段阅读',time:'',end_time:'',duration_min:15,duration_max:30,approximate:true,completion:'ongoing'});const id=add(p);await apply(id,p);
 const session=db.prepare('SELECT * FROM activity_sessions WHERE action_id=?').get(id);assert.equal(session.duration_max,30);assert.equal(db.prepare('SELECT count(*) n FROM daily_slots WHERE item_id=?').get(session.item_id).n,0);
});
test('future plan only enters Planning board, never Things or actual timeline',async()=>{
 const p=actual({type:'plan',destination_id:'',title:'明天攀岩',date:'2026-09-09',completion:'ongoing'});const id=add(p);await apply(id,p);
 assert.equal(db.prepare('SELECT count(*) n FROM planning_cards WHERE title=?').get(p.title).n,1);assert.equal(db.prepare('SELECT count(*) n FROM nodes WHERE title=?').get(p.title).n,0);assert.equal(db.prepare('SELECT count(*) n FROM activity_sessions WHERE action_id=?').get(id).n,0);
});
test('a conflict anywhere in a duration rolls back new item, record, history and all cells',async()=>{
 const p=actual({title:'Conflicting activity',time:'09:30',end_time:'10:30'});const id=add(p);await assert.rejects(()=>apply(id,p),/occupied/);assert.equal(row(id).status,'pending');assert.equal(db.prepare('SELECT count(*) n FROM nodes WHERE title=?').get(p.title).n,0);assert.equal(db.prepare('SELECT count(*) n FROM activity_sessions WHERE action_id=?').get(id).n,0);assert.equal(db.prepare("SELECT count(*) n FROM daily_slots WHERE date='2026-09-08' AND time='09:30'").get().n,0);
});
test('re-analysis retains old proposals on failure and only supersedes pending ones after success',async()=>{
 const c=db.prepare("SELECT * FROM voice_captures WHERE request_id='pipeline-1'").get();const before=db.prepare('SELECT id FROM voice_actions WHERE capture_id=? AND status=\'pending\'').all(c.id);const old=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response('',{status:500});await assert.rejects(()=>server.interpret(c.id,'owner',true));assert.equal(db.prepare('SELECT count(*) n FROM voice_actions WHERE capture_id=? AND status=\'pending\'').get(c.id).n,before.length);
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recording_mode:'actions',actions:[actual({title:'Trading journal',time:'',end_time:'',duration_min:0,duration_max:0,evidence:c.transcript})]})}}]});await server.interpret(c.id,'owner',true);assert.ok(before.every(a=>row(a.id).status==='superseded'));assert.equal((await server.capture(c.id,'owner')).interpretation_model,'gpt-4.1');
 }finally{globalThis.fetch=old;}
});

test('comparison isolates model failures, uses identical inputs, reports usage, and selection never applies to board',async()=>{
 const id='compare-fixture';db.prepare("INSERT INTO voice_captures(id,owner_id,request_id,checksum,filename,local_date,timezone,transcript) VALUES (?,?,?,?,?,'2026-09-08','Asia/Shanghai','明天十点健身')").run(id,'owner',id,id,'compare.m4a');
 const old=globalThis.fetch,requests=[];
 const counts=()=>['nodes','daily_slots','history','planning_cards','activity_sessions'].map(t=>db.prepare(`SELECT count(*) n FROM ${t}`).get().n);
 const before=counts();
 globalThis.fetch=async(url,options)=>{const b=JSON.parse(options.body);requests.push(b);if(b.model==='gpt-6-astra')return new Response('{}',{status:403});return Response.json({model:b.model,service_tier:'default',usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:100},completion_tokens_details:{reasoning_tokens:20}},choices:[{finish_reason:'stop',message:{content:JSON.stringify({recording_mode:'actions',actions:[{...base,type:'plan',title:'健身',date:'2026-09-09',time:'10:00',end_time:'',duration_min:0,duration_max:0,approximate:false,completion:'ongoing',evidence:'明天十点健身'}]})}}]});};
 try {
  await assert.rejects(()=>server.compareModels(id,'intruder',['gpt-4.1','gpt-6-astra']),/not found/);
  await assert.rejects(()=>server.compareModels(id,'owner',['made-up-model','gpt-4.1']),/supported/);
  const runs=await server.compareModels(id,'owner',['gpt-4.1','gpt-5.6-sol','gpt-6-astra']);const run=runs[0];
  assert.equal(requests.length,3);assert.deepEqual(requests[0].messages,requests[1].messages);assert.deepEqual(requests[0].messages,requests[2].messages);
  assert.equal(run.results.filter(r=>r.error).length,1);assert.equal(run.results[0].estimated_usd,0.00345);assert.deepEqual(counts(),before);
  assert.equal(db.prepare('SELECT count(*) n FROM voice_actions WHERE capture_id=?').get(id).n,0);
  await assert.rejects(()=>server.adoptComparison(id,'owner',run.id,'gpt-6-astra'),/successful/);
  await server.adoptComparison(id,'owner',run.id,'gpt-4.1');assert.deepEqual(counts(),before);
  assert.equal(db.prepare("SELECT count(*) n FROM voice_actions WHERE capture_id=? AND status='pending'").get(id).n,1);
  await assert.rejects(()=>server.adoptComparison(id,'owner',run.id,'gpt-5.6-sol'),/already selected/);
  const next=await server.compareModels(id,'owner',['gpt-4.1','gpt-5.6-sol']);
  db.prepare("UPDATE voice_actions SET status='approved' WHERE capture_id=?").run(id);
  await assert.rejects(()=>server.adoptComparison(id,'owner',next[0].id,'gpt-4.1'),/already being processed/);
  assert.deepEqual(counts(),before);
 } finally {globalThis.fetch=old;}
});

test('meal title mismatch requires explicit task selection and keeps the diary wording',async()=>{
 const {selectProposalTask}=await import(typesUrl);
 const target='meal-title-regression';db.prepare("INSERT INTO nodes (id,title,kind,status,is_draft) VALUES (?,'吃饭','item','active',0)").run(target);
 const p=actual({title:'和严一帆吃饭',target_id:target,date:'2026-09-10',time:'11:30',end_time:'13:00',duration_min:90,duration_max:90,approximate:true,completion:'session_done',needs_clarification:true});const id=add(p);
 await assert.rejects(()=>apply(id,{...p,needs_clarification:false}),/links to “吃饭”/);
 assert.equal(row(id).status,'pending');assert.equal(db.prepare('SELECT count(*) n FROM activity_sessions WHERE action_id=?').get(id).n,0);
 const selected=selectProposalTask(p,target,'吃饭');assert.equal(selected.needs_clarification,true);assert.equal(selected.notes,'和严一帆吃饭');
 await assert.rejects(()=>apply(id,selected),/ambiguity/);
 await apply(id,{...selected,needs_clarification:false});
 const session=db.prepare('SELECT * FROM activity_sessions WHERE action_id=?').get(id);assert.equal(session.title,'吃饭');assert.equal(session.notes,'和严一帆吃饭');assert.equal(session.duration_min,90);
 assert.equal(db.prepare("SELECT count(*) n FROM daily_slots WHERE date='2026-09-10' AND item_id=?").get(target).n,6);
 assert.equal(selectProposalTask(selected,target,'吃饭').notes,'和严一帆吃饭');
});

test('new audio tasks cannot be approved without a category, including completed tasks',async()=>{
 for(const completion of ['ongoing','session_done','completed']) {
  const p=actual({title:`Needs category ${completion}`,destination_id:'',completion});const id=add(p);
  await assert.rejects(()=>apply(id,p),/Choose a category/);
  assert.equal(row(id).status,'pending');
  assert.equal(db.prepare('SELECT count(*) n FROM nodes WHERE title=?').get(p.title).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM activity_sessions WHERE action_id=?').get(id).n,0);
 }
 const p=proposal({destination_id:''});await assert.rejects(()=>apply(add(p),p),/Choose a category/);
});
test('chosen categories must be active lists and survive into the task, history and timeline',async()=>{
 const p=actual({title:'Categorized activity',date:'2026-09-12',destination_id:''});const id=add(p);
 db.prepare("INSERT INTO nodes (id,title,kind,status,is_draft) VALUES ('deleted-category','Old','list','done',0),('draft-category','Draft','list','active',1)").run();
 const item=db.prepare("SELECT id FROM nodes WHERE kind='item' LIMIT 1").get().id;
 for(const destination_id of ['missing-category','deleted-category','draft-category',item]) await assert.rejects(()=>apply(id,{...p,destination_id}),/active category/);
 await apply(id,{...p,destination_id:'voice-category'});
 const saved=db.prepare('SELECT id,parent_id FROM nodes WHERE title=?').get(p.title);assert.equal(saved.parent_id,'voice-category');
 assert.equal(db.prepare('SELECT category_name FROM history WHERE item_title=?').get(p.title).category_name,'Personal');
 assert.equal(db.prepare('SELECT category_name FROM daily_slots WHERE item_id=?').get(saved.id).category_name,'Personal');
 const repeat=actual({title:p.title,target_id:saved.id,destination_id:'',date:'2026-09-13'});await apply(add(repeat),repeat);
 assert.equal(db.prepare('SELECT category_name FROM daily_slots WHERE date=? AND item_id=?').get(repeat.date,saved.id).category_name,'Personal');
});
test('existing uncategorized audio tasks must be categorized before recording',async()=>{
 const target='uncategorized-regression';db.prepare("INSERT INTO nodes(id,title,kind,status,is_draft) VALUES (?,'Previously uncategorized','item','active',0)").run(target);
 const p=actual({title:'Previously uncategorized',target_id:target,destination_id:'',date:'2026-09-14'});const id=add(p);
 await assert.rejects(()=>apply(id,p),/Choose a category/);
 await apply(id,{...p,destination_id:'voice-category'});
 assert.equal(db.prepare('SELECT parent_id FROM nodes WHERE id=?').get(target).parent_id,'voice-category');
});
test('category review stays required independently of generic clarification',async()=>{
 const {needsTaskCategory}=await import(typesUrl);
 const nodes=[{id:'known',kind:'item',parent_id:'voice-category'},{id:'uncategorized',kind:'item',parent_id:null}];
 assert.equal(needsTaskCategory(actual({destination_id:'',needs_clarification:false}),nodes),true);
 assert.equal(needsTaskCategory(actual({target_id:'uncategorized'}),nodes),true);
 assert.equal(needsTaskCategory(actual({target_id:'known'}),nodes),false);
 assert.equal(needsTaskCategory(actual({type:'plan'}),nodes),false);
});
test('model category guesses are cleared so new audio tasks require user selection',async()=>{
 const old=globalThis.fetch;
 try {
  const c={local_date:'2026-09-15',timezone:'Asia/Shanghai',transcript:'十点到十一点健身'};
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recording_mode:'actions',actions:[actual({destination_id:'voice-category'})]})}}]});
  const result=await server.generateProposals(c,{nodes:[],columns:[],cards:[],slots:[]},'gpt-4.1');
  assert.equal(result.actions[0].destination_id,'');
 } finally {globalThis.fetch=old;}
});

const captureRoute=await import(moduleUrl((await readFile(new URL('../app/api/voice-captures/[id]/route.ts',import.meta.url),'utf8')).replace('import { getD1 } from "../../../../db";','const getD1=()=>globalThis.__voiceDb;').replace('"../../../voice-server"',JSON.stringify(serverUrl))));
const deleteCapture=(id,user='owner',origin='https://nextup.test')=>captureRoute.POST(new Request(`https://nextup.test/api/voice-captures/${id}`,{method:'POST',headers:{'content-type':'application/json',...(user?{'oai-authenticated-user-id':user}:{}),origin},body:JSON.stringify({action:'delete'})}),{params:Promise.resolve({id})});
function deletionFixture(status,transcript='') {
 const id=crypto.randomUUID();
 db.prepare("INSERT INTO voice_captures(id,owner_id,request_id,checksum,filename,local_date,timezone,status,transcript) VALUES (?,?,?,?,?,'2026-10-08','Asia/Shanghai',?,?)").run(id,'owner',id,id,'failed.m4a',status,transcript);
 return id;
}
test('failed, empty and interrupted recordings can be deleted without affecting a replacement',async()=>{
 const replacement=deletionFixture('ready','Replacement recording');
 for(const status of ['transcription_failed','interpretation_failed','uploaded','transcribing','ready']) {
  const id=deletionFixture(status,status==='interpretation_failed'?'Saved transcript':'');
  db.prepare("INSERT INTO voice_comparisons(id,capture_id,snapshot) VALUES (?,?,'{}')").run(crypto.randomUUID(),id);
  const response=await deleteCapture(id);assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
  await assert.rejects(()=>server.capture(id,'owner'),/not found/);
  assert.equal(db.prepare('SELECT count(*) n FROM voice_comparisons WHERE capture_id=?').get(id).n,0);
 }
 assert.equal((await server.capture(replacement,'owner')).transcript,'Replacement recording');
});
test('deletion requires the recording owner and same-origin authorization',async()=>{
 const id=deletionFixture('transcription_failed');
 assert.equal((await deleteCapture(id,'intruder')).status,404);
 assert.equal((await deleteCapture(id,'')).status,401);
 assert.equal((await deleteCapture(id,'owner','https://elsewhere.test')).status,403);
 assert.ok(await server.capture(id,'owner'));
});
test('deletion protects active processing, comparisons and existing proposals',async()=>{
 const id=deletionFixture('transcribing');
 db.prepare('UPDATE voice_captures SET lease_until=? WHERE id=?').run(Date.now()+180000,id);
 assert.equal((await deleteCapture(id)).status,409);
 db.prepare('UPDATE voice_captures SET lease_until=0 WHERE id=?').run(id);
 db.prepare("INSERT INTO voice_comparisons(id,capture_id,snapshot,lease_until) VALUES (?,?,'{}',?)").run(id,id,Date.now()+180000);
 assert.equal((await deleteCapture(id)).status,409);
 assert.ok(db.prepare('SELECT id FROM voice_comparisons WHERE id=?').get(id));
 db.prepare('UPDATE voice_comparisons SET lease_until=0 WHERE id=?').run(id);
 db.prepare('INSERT INTO voice_actions(id,capture_id,proposal) VALUES (?,?,?)').run(id,id,JSON.stringify(proposal({})));
 for(const status of ['pending','approved','rejected','superseded']) {
  db.prepare('UPDATE voice_actions SET status=? WHERE id=?').run(status,id);
  assert.equal((await deleteCapture(id)).status,409);
  assert.ok(await server.capture(id,'owner'));
  assert.ok(db.prepare('SELECT id FROM voice_comparisons WHERE id=?').get(id));
 }
});
