"use client";
import { LanguageToggle, useI18n } from "../i18n/provider";

import Link from "next/link";
import ModelComparison from "./comparison";
import VoiceRecorder from "./recorder";
import ShortcutSetup from "./shortcut-setup";
import { useCallback, useEffect, useState } from "react";
import { actionLabels, actionTypes, completionLabels, needsTaskCategory, selectProposalTask, type Capture, type Proposal, type VoiceAction } from "../voice-types";
type Context = { nodes:{id:string;title:string;kind:string;parent_id:string|null}[]; columns:{id:string;title:string}[]; cards:{id:string;title:string}[] };
type Inbox = { captures:Capture[];actions:VoiceAction[];context:Context;ai_configured:boolean };
type QueuedAudio = { id:string; file:File; playUrl:string; requestId:string; date:string; timezone:string; status:"waiting"|"uploading"|"processing"|"error"; progress:number; error:string };
const MAX_DIRECT_UPLOAD = 10 * 1024 * 1024;
const AUDIO_CHUNK_BYTES = 512 * 1024;
const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
async function api(url:string,body?:unknown) {
  const response=await fetch(url,body instanceof Blob?{method:"PUT",headers:{"Content-Type":"application/octet-stream"},body}:body instanceof FormData?{method:"POST",body}:body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  if(!response.headers.get("content-type")?.includes("application/json")) {
    if(response.status===413) throw new Error("The server rejected an upload part. Your recording is still available in this tab; download a copy and retry.");
    if(response.status===401||response.status===403) throw new Error("The site could not verify your sign-in. Refresh Personal Daily, sign in again if asked, and retry. Keep the recording in this tab or download a copy first.");
    throw new Error(`The server returned ${response.status} before the recording could be processed. Keep the recording in this tab or download a copy, then retry.`);
  }
  const result=await response.json();if(!response.ok) throw new Error(result.error||"Could not save. Keep your local file and retry.");return result;
}
const statusLabels:Record<string,string>={uploaded:"Needs upload retry",transcribing:"Transcribing",transcribed:"Transcript saved",interpreting:"Preparing proposals",ready:"Ready to review",transcription_failed:"Re-upload or enter transcript",interpretation_failed:"Interpretation needs attention"};
function ActionEditor({action,context,busy,onAction}:{action:VoiceAction;context:Context;busy:boolean;onAction:(action:VoiceAction,verb:string,proposal:Proposal)=>Promise<void>}) {
  const { tr, sample } = useI18n();
  const [p,setP]=useState(action.proposal);const [editing,setEditing]=useState(false);const [actionError,setActionError]=useState("");
  const set=(key:keyof Proposal,value:string|boolean)=>setP(old=>({...old,[key]:value}));
  const item=context.nodes.find(n=>n.id===p.target_id)||context.cards.find(n=>n.id===p.target_id);
  const destination=context.nodes.find(n=>n.id===p.destination_id)||context.columns.find(n=>n.id===p.destination_id);
  const targetNeeded=!["plan","create_task","create_idea","review_note"].includes(p.type);
  const actual=p.type === "record_activity"; const planned=p.type === "plan";
  const categoryRequired=needsTaskCategory(p,context.nodes);
  const categories=context.nodes.filter(n=>n.kind === "list");
  const categoryMissing=categoryRequired && !categories.some(n=>n.id===p.destination_id);
  const mismatch=Boolean(actual && p.target_id && (!item || p.title!==item.title));
  function selectTask(id:string,title:string){try{setP(selectProposalTask(p,id,title));setActionError("");}catch(e){setActionError(e instanceof Error?e.message:"Could not select task.");}}
  async function submit(verb:string){setActionError("");try{await onAction(action,verb,p);if(verb==="edit")setEditing(false);}catch(e){setActionError(e instanceof Error?e.message:"Could not save this proposal.");}}
  return <article className={`voice-action ${action.status !== "pending"?"is-resolved":""}`}>
    <div className="voice-row"><strong>{tr(actual ? "Actual activity · " : planned ? "Future plan · " : "")}{tr(actionLabels[p.type])}</strong><span className="voice-badge">{tr(action.status)}</span></div>
    <p className="voice-action-title">{sample(p.title, p.target_id) || (item ? sample(item.title, item.id) : "") || (p.type === "review_note"?tr("Thoughts for the day"):tr("Choose the referenced task"))}</p>
    {destination && <p>{tr("To: ")}{sample(destination.title, destination.id)}</p>}
    {p.from_date && <p>{tr("From ")}{tr(p.from_date)} {tr(p.from_time)}</p>}{p.date && <p>{tr(p.type === "move_schedule"?"To ":"")}{tr(p.date)} {tr(p.time)}</p>}
    {(actual || planned) && <p>{tr(p.end_time ? `Until ${p.end_time} · ` : "")}{tr(p.approximate ? "About " : "")}{tr(p.duration_min ? `${p.duration_min}${p.duration_max !== p.duration_min ? `–${p.duration_max}` : ""} min` : "Duration not specified")}</p>}
    {actual && <p><strong>{tr(completionLabels[p.completion || "ongoing"])}</strong> · {tr(p.target_id ? "Existing task" : "Create task and record activity together")}</p>}
    {planned && <p>{tr("Goes to Planning board")}{tr(destination ? "" : " · Plans inbox")}{tr(". Does not count as something you have done.")}</p>}
    {p.evidence && <blockquote className="voice-evidence">{p.evidence}</blockquote>}
    {p.notes && <p className="voice-note">{p.notes}</p>}{p.reason && <p className="voice-muted">{p.reason}</p>}
    {p.needs_clarification && action.status === "pending" && <p className="voice-warning">{tr("Needs your clarification before approval.")}</p>}
    {categoryRequired && action.status === "pending" && <div className="voice-fields"><label>{tr("Which category does “")}{p.title || tr("this task")}{tr("” belong to? (required)")}<select required disabled={busy} value={p.destination_id} onChange={e=>set("destination_id",e.target.value)}><option value="">{tr("Choose a category…")}</option>{categories.map(n=><option key={n.id} value={n.id}>{sample(n.title, n.id)}</option>)}</select></label>{categoryMissing && <p className="voice-warning">{tr("Choose a category before approving this task.")}</p>}{!categories.length && <p>{tr("Create a category on the ")}<Link href="/">{tr("board")}</Link>{tr(", then refresh this inbox to choose it.")}</p>}</div>}
    {actionError && <p role="alert" className="voice-warning">{tr(actionError)}</p>}
    {mismatch && action.status === "pending" && <div className="voice-warning"><p>{tr("The proposal “")}{p.title}{tr("” links to ")}{item ? `“${sample(item.title, item.id)}”` : tr("a task no longer available")}{tr(". Confirm the task or choose a new activity in Edit.")}</p>{item && <button disabled={busy} onClick={()=>{selectTask(p.target_id,item.title);setEditing(true);}}>{tr("Use existing task “")}{sample(item.title, item.id)}”</button>}</div>}
    {editing && <div className="voice-fields">
      <label>{tr("Action")}<select value={p.type} onChange={e=>setP(old=>({...old,type:e.target.value as Proposal["type"],end_time:old.end_time||"",evidence:old.evidence||"",duration_min:old.duration_min||0,duration_max:old.duration_max||0,approximate:old.approximate||false,completion:old.completion||"ongoing"}))}>{actionTypes.map(t=><option key={t} value={t}>{tr(actionLabels[t])}</option>)}</select></label>
      {targetNeeded && <label>{tr(p.type === "move_idea"?"Planning idea":"Task")}<select value={p.target_id} onChange={e=>{const id=e.target.value;selectTask(id,(p.type === "move_idea"?context.cards:context.nodes).find(n=>n.id===id)?.title||"");}}><option value="">{tr(actual ? "Create a new task for this activity" : "Choose…")}</option>{(p.type === "move_idea"?context.cards:context.nodes.filter(n=>n.kind === "item")).map(n=><option key={n.id} value={n.id}>{sample(n.title, n.id)}</option>)}</select></label>}
      {["plan","create_idea","move_idea"].includes(p.type) && <label>{tr("Destination")}<select value={p.destination_id} onChange={e=>set("destination_id",e.target.value)}><option value="">{tr(planned ? "Plans inbox" : "Choose planning area…")}</option>{context.columns.map(n=><option key={n.id} value={n.id}>{sample(n.title, n.id)}</option>)}</select></label>}
      {(["plan","create_task","create_idea"].includes(p.type) || (actual && !p.target_id)) && <label>{tr("Title")}<input value={p.title} onChange={e=>set("title",e.target.value)} maxLength={100}/></label>}
      {["record_activity","plan","create_task","create_idea","task_note","review_note"].includes(p.type) && <label>{tr("Notes")}<textarea value={p.notes} onChange={e=>set("notes",e.target.value)} maxLength={4000}/></label>}
      {["record_activity","plan","schedule","move_schedule","review_note"].includes(p.type) && <label>{tr("Date")}<input type="date" value={p.date} onChange={e=>set("date",e.target.value)}/></label>}
      {["record_activity","plan","schedule","move_schedule"].includes(p.type) && <label>{tr("Time")}<input type="time" step={actual||planned?60:900} value={p.time} onChange={e=>set("time",e.target.value)}/></label>}
      {["move_schedule","cancel_schedule"].includes(p.type) && <><label>{tr("Original date")}<input type="date" value={p.from_date} onChange={e=>set("from_date",e.target.value)}/></label><label>{tr("Original time")}<input type="time" min="05:00" max="21:45" step={900} value={p.from_time} onChange={e=>set("from_time",e.target.value)}/></label></>}
      {(actual || planned) && <><label>{tr("End time")}<input type="time" step={60} value={p.end_time||""} onChange={e=>set("end_time",e.target.value)}/></label><label>{tr("Duration, minutes")}<input type="number" min={0} max={1440} value={p.duration_min||0} onChange={e=>{const n=Number(e.target.value);setP(old=>({...old,duration_min:n,duration_max:Math.max(n,old.duration_max||0)}));}}/></label><label>{tr("Up to, minutes")}<input type="number" min={0} max={1440} value={p.duration_max||0} onChange={e=>setP(old=>({...old,duration_max:Number(e.target.value)}))}/></label><label className="voice-checkbox"><input type="checkbox" checked={Boolean(p.approximate)} onChange={e=>set("approximate",e.target.checked)}/>{tr("Times or duration are approximate")}</label></>}
      {actual && <label>{tr("Completion")}<select value={p.completion||"ongoing"} onChange={e=>set("completion",e.target.value)}>{Object.entries(completionLabels).map(([key,label])=><option key={key} value={key}>{tr(label)}</option>)}</select></label>}
      {p.needs_clarification && <label className="voice-checkbox"><input type="checkbox" disabled={mismatch} checked={!p.needs_clarification} onChange={e=>set("needs_clarification",!e.target.checked)}/>{tr("I have resolved the ambiguity above")}</label>}
    </div>}
    {action.status === "pending" && <div className="voice-buttons"><button disabled={busy} onClick={()=>{setEditing(!editing);if(editing)setP(action.proposal);}}>{tr(editing?"Cancel edit":"Edit")}</button>{editing && <button disabled={busy} onClick={()=>void submit("edit")}>{tr("Save proposal")}</button>}<button disabled={busy} onClick={()=>void submit("reject")}>{tr("Reject")}</button><button className="voice-primary" disabled={busy||p.needs_clarification||mismatch||categoryMissing} onClick={()=>void submit("approve")}>{tr("Approve")}</button></div>}
  </article>;
}
function CaptureCard({capture:c,actions,context,busy,run,onAction,configured,showResolved}:{capture:Capture;actions:VoiceAction[];context:Context;busy:boolean;run:(url:string,body:unknown)=>Promise<void>;onAction:(a:VoiceAction,v:string,p:Proposal)=>Promise<void>;configured:boolean;showResolved:boolean}) {
  const { tr } = useI18n();
  const [transcript,setTranscript]=useState(c.transcript);
  const processing=Boolean(c.processing);
  const canRegenerate=!actions.some(a=>a.status === "approved") && Boolean(c.transcript);
  const stale=["transcribing","interpreting"].includes(c.status)&&!processing;
  return <section className="voice-capture">
    <div className="voice-row"><div><h2>{c.filename}</h2><p className="voice-muted">{tr(c.local_date)} · {tr(c.timezone)}</p></div><span className="voice-badge">{tr(stale?"Interrupted — retry needed":statusLabels[c.status]||c.status)}</span></div>
    {c.interpretation_model && <p className="voice-muted">{tr("Interpreted with ")}{tr(c.interpretation_model)}</p>}
    {canRegenerate && <div className="voice-buttons"><button disabled={busy||processing||!configured} onClick={()=>{if(window.confirm(tr("Replace the pending proposals using the saved transcript? Your board will not change until you approve.")))void run(`/api/voice-captures/${c.id}`,{action:"regenerate"}).catch(()=>{});}}>{tr("Re-analyze transcript")}</button></div>}
    {(c.interpretation_version||0) < 3 && actions.some(a=>a.status === "pending") && <p className="voice-warning">{tr("These proposals use the older interpretation. Re-analyze to identify whole-recording reflections before creating task updates.")}</p>}
    {c.error && <p className="voice-warning">{tr(c.error)}</p>}
    {actions.length===0 && <div className="voice-buttons"><button disabled={busy||processing} aria-label={tr(`Delete ${c.filename} from inbox`)} onClick={()=>{if(window.confirm(tr(`Delete “${c.filename}” from your inbox? Any saved transcript will be deleted. Your original audio file will stay on your device.`)))void run(`/api/voice-captures/${c.id}`,{action:"delete"}).catch(()=>{});}}>{tr("Delete recording")}</button></div>}
    {!c.transcript && <p>{tr("The audio stays in Files on your device. Re-upload the same file to retry transcription, or enter the transcript below.")}</p>}
    <details open={actions.length===0}><summary>{tr("Transcript ")}{c.transcript?tr("· saved"):tr("· not yet saved")}</summary><textarea className="voice-transcript" aria-label={tr(`Transcript for ${c.filename}`)} value={transcript} maxLength={20000} readOnly={actions.length>0||processing} onChange={e=>setTranscript(e.target.value)} placeholder={tr("You can enter or correct the transcript here.")}/>
      {actions.length===0 && <div className="voice-buttons"><button disabled={busy||processing||!transcript.trim()||transcript===c.transcript} onClick={()=>void run(`/api/voice-captures/${c.id}`,{action:"save_transcript",transcript}).catch(()=>{})}>{tr("Save transcript")}</button><button disabled={busy||processing||!c.transcript||!configured||transcript!==c.transcript} onClick={()=>void run(`/api/voice-captures/${c.id}`,{action:"interpret"}).catch(()=>{})}>{tr(c.status === "interpretation_failed"?"Retry interpretation":"Prepare proposals")}</button></div>}
      {actions.length>0 && <p className="voice-muted">{tr("The transcript is preserved. Edit individual proposals below to correct the intended changes.")}</p>}
    </details>
    {c.transcript && <ModelComparison captureId={c.id} disabled={busy||processing||!configured} canAdopt={canRegenerate} onAdopt={run}/>}
    {c.status === "ready" && !actions.some(a=>a.status!=="superseded") && <p>{tr("No actionable changes were found in this transcript.")}</p>}
    {actions.filter(a=>a.status==="pending"||(showResolved&&a.status!=="superseded")).map(a=><ActionEditor key={a.id+JSON.stringify(a.proposal)+a.status} action={a} context={context} busy={busy} onAction={onAction}/>)}
  </section>;
}
export default function VoiceInbox(){
  const { tr } = useI18n();
  const [inbox,setInbox]=useState<Inbox|null>(null);const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [queue,setQueue]=useState<QueuedAudio[]>([]);const [date,setDate]=useState("");const [timezone,setTimezone]=useState("");const [filter,setFilter]=useState("pending");
  const load=useCallback(async()=>{setInbox(await api("/api/voice-captures"));},[]);
  useEffect(()=>{let active=true;void api("/api/voice-captures").then(data=>{if(active){setInbox(data);setDate(localDay());setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!queue.length)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[queue.length]);
  useEffect(()=>{if(!inbox?.captures.some(c=>c.processing))return;const id=setInterval(()=>void load().catch(()=>{}),5000);return()=>clearInterval(id);},[inbox,load]);
  function addFiles(selected:File[]){
    if(!selected.length)return;
    setQueue(current=>[...current,...selected.map(file=>({id:crypto.randomUUID(),file,playUrl:URL.createObjectURL(file),requestId:crypto.randomUUID(),date:date||localDay(),timezone:timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,status:"waiting" as const,progress:0,error:""}))]);
    setMessage(`${selected.length} ${selected.length===1?"audio":"audios"} added to the queue.`);setError("");
  }
  function updateQueued(id:string,changes:Partial<QueuedAudio>){setQueue(current=>current.map(item=>item.id===id?{...item,...changes}:item));}
  function removeQueued(id:string){setQueue(current=>{const item=current.find(entry=>entry.id===id);if(item)URL.revokeObjectURL(item.playUrl);return current.filter(entry=>entry.id!==id);});}
  async function run(url:string,body:unknown){setBusy(true);setError("");setMessage("");try{await api(url,body);await load();setMessage("Saved.");}catch(e){setError(e instanceof Error?e.message:"Could not save.");throw e;}finally{setBusy(false);}}
  async function onAction(a:VoiceAction,verb:string,p:Proposal){await run(`/api/voice-actions/${a.id}`,{action:verb,proposal:p,expected_proposal:JSON.stringify(a.proposal)});if(verb === "approve")setMessage("Approved and applied. Your board is updated.");}
  async function processQueue(){
    const waiting=queue.filter(item=>item.status!=="uploading"&&item.status!=="processing"&&item.file.size<=MAX_DIRECT_UPLOAD);
    if(!waiting.length)return;setBusy(true);setError("");setMessage(`Processing ${waiting.length} ${waiting.length===1?"audio":"audios"}…`);
    let completed=0,failed=0;
    for(const item of waiting){
      try{
        const total=Math.ceil(item.file.size/AUDIO_CHUNK_BYTES);
        updateQueued(item.id,{status:"uploading",progress:0,error:""});
        await api("/api/voice-uploads",{upload_id:item.requestId,filename:item.file.name,content_type:item.file.type||"application/octet-stream",size:item.file.size,total_chunks:total,local_date:item.date,timezone:item.timezone});
        for(let part=0;part<total;part++){
          await api(`/api/voice-uploads/${item.requestId}/${part}`,item.file.slice(part*AUDIO_CHUNK_BYTES,(part+1)*AUDIO_CHUNK_BYTES));
          updateQueued(item.id,{progress:Math.round((part+1)/total*100)});
        }
        updateQueued(item.id,{status:"processing",progress:100});
        const result=await api(`/api/voice-uploads/${item.requestId}/complete`,{});
        if(!result.transcript_saved)throw new Error(result.error||"Transcription has not finished. Keep this recording and retry.");
        completed++;removeQueued(item.id);
      }catch(e){failed++;updateQueued(item.id,{status:"error",error:e instanceof Error?e.message:"Processing failed. Keep this recording and retry."});}
    }
    try{await load();}catch{}setFilter("pending");setBusy(false);
    setMessage(completed?`${completed} ${completed===1?"audio is":"audios are"} ready to review below.${failed?` ${failed} still ${failed===1?"needs":"need"} attention.`:""}`:"");
    if(failed&&!completed)setError(`${failed} ${failed===1?"audio could":"audios could"} not be processed. The ${failed===1?"recording is":"recordings are"} still in your queue.`);
  }
  const processable=queue.filter(item=>item.file.size<=MAX_DIRECT_UPLOAD&&!['uploading','processing'].includes(item.status)).length;
  const pending=inbox?.actions.filter(a=>a.status === "pending").length||0;
  const captures=inbox?.captures.filter(c=>filter === "all"||inbox.actions.some(a=>a.capture_id===c.id&&a.status === "pending")||(!inbox.actions.some(a=>a.capture_id===c.id)&&c.status!=="ready"))||[];
  return <main className="page-shell"><header className="topbar"><Link className="wordmark" href="/">{tr("Personal Daily")}</Link><LanguageToggle /><Link className="voice-nav" href="/">{tr("Back to board")}</Link></header>
    <div className="voice-shell"><div className="voice-row voice-heading"><div><p className="eyebrow">{tr("Capture, then review")}</p><h1>{tr("Voice Inbox")}</h1></div><span className="voice-badge">{tr(`${pending} pending ${pending===1?"change":"changes"}`)}</span></div>
    <p className="voice-intro">{tr("Future plans go to your Planning board. Things you have done go to your daily activity record. Review each proposal before applying it.")}</p>
    {error&&<p role="alert" className="voice-warning">{tr(error)}</p>}{message&&<p role="status" className="voice-success">{tr(message)}</p>}
    {inbox&&!inbox.ai_configured&&<p className="voice-warning">{tr("AI processing is not connected yet. Add an OpenAI API key in the site’s runtime settings to enable transcription and proposals. Your existing board works as usual.")}</p>}
    <section className="voice-upload"><h2>{tr("Record or choose audio")}</h2><p>{tr("Add as many recordings as you need, then process the whole queue when you are ready. Audio is uploaded temporarily and deleted after its transcript is saved.")}</p>
      <VoiceRecorder disabled={busy} onReady={file=>addFiles([file])}/>
      <div className="voice-or" aria-hidden="true"><span>{tr("or choose files")}</span></div>
      <label className="voice-file">{tr("Audio files · up to 10 MB each")}<input type="file" multiple accept=".m4a,.mp3,.mp4,.mpeg,.mpga,.wav,.webm,.ogg,.flac" disabled={busy} onChange={e=>{addFiles(Array.from(e.target.files||[]));e.target.value="";}}/></label>
      <div className="voice-fields"><label>{tr("Default recording date")}<input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy}/></label><label>{tr("Default recording timezone")}<input value={timezone} onChange={e=>setTimezone(e.target.value)} disabled={busy}/></label></div><p className="voice-muted">{tr("New items use these defaults. You can adjust each queued audio before processing.")}</p>
      {queue.length>0&&<div className="voice-queue"><div className="voice-row"><h3>{tr(queue.length)}{tr(" queued ")}{tr(queue.length===1?"audio":"audios")}</h3><span className="voice-muted">{tr("Kept in this tab until processed")}</span></div>{queue.map((item,index)=>{const tooLarge=item.file.size>MAX_DIRECT_UPLOAD;return <article className="voice-recording-ready" key={item.id}>
        <div className="voice-row"><div><strong>{tr(index+1)}. {item.file.name}</strong><span className="voice-file-size">{tr((item.file.size/1024/1024).toFixed(2))}{tr(" MB")}</span></div><button disabled={busy} onClick={()=>removeQueued(item.id)} aria-label={tr(`Remove ${item.file.name} from queue`)}>{tr("Remove")}</button></div>
        <audio controls src={item.playUrl} aria-label={tr(`Play ${item.file.name}`)}/><a className="voice-download" href={item.playUrl} download={item.file.name}>{tr("Download a copy")}</a>
        <div className="voice-fields"><label>{tr("Recording date")}<input type="date" value={item.date} disabled={busy} onChange={e=>updateQueued(item.id,{date:e.target.value})}/></label><label>{tr("Timezone")}<input value={item.timezone} disabled={busy} onChange={e=>updateQueued(item.id,{timezone:e.target.value})}/></label></div>
        {item.status==="uploading"&&<p role="status" className="voice-muted">{tr("Uploading · ")}{tr(item.progress)}%</p>}{item.status==="processing"&&<p role="status" className="voice-muted">{tr("Transcribing and preparing changes…")}</p>}{item.error&&<p role="alert" className="voice-warning">{tr(item.error)}</p>}{tooLarge&&<p role="alert" className="voice-warning">{tr("This file exceeds the 10 MB limit. Keep this copy and remove it before processing the queue.")}</p>}
      </article>;})}</div>}
      <button className="voice-primary voice-process-all" disabled={busy||!processable||!inbox?.ai_configured} onClick={()=>void processQueue()}>{tr(busy?"Processing queue… keep this page open":`Process ${processable||"all"} ${processable===1?"audio":"audios"}`)}</button>
    </section>
    <ShortcutSetup/>
    <div className="voice-row voice-list-heading"><div className="voice-buttons"><button aria-pressed={filter === "pending"} onClick={()=>setFilter("pending")}>{tr("Needs attention")}</button><button aria-pressed={filter === "all"} onClick={()=>setFilter("all")}>{tr("All recordings")}</button></div><button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>{tr("Refresh")}</button></div>
    {!inbox?<p role="status">{tr("Loading your inbox…")}</p>:captures.length===0?<div className="voice-empty"><h2>{tr(filter === "pending"?"Nothing waiting for review":"No recordings yet")}</h2><p>{tr("Upload a recording when you have an update. You’ll see its transcript and proposed changes here.")}</p></div>:captures.map(c=><CaptureCard key={c.id+c.transcript} capture={c} actions={inbox.actions.filter(a=>a.capture_id===c.id)} context={inbox.context} busy={busy} run={run} onAction={onAction} configured={inbox.ai_configured} showResolved={filter==="all"}/>)}
    </div></main>;
}
