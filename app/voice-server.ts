import { env } from "cloudflare:workers";
import { interpretationPrompt, proposalSchema } from "./voice-prompt";
import { getD1 } from "../db";
import { comparisonModels, parseProposal, validDate, type Capture, type ComparisonResult } from "./voice-types";
export class VoiceError extends Error { constructor(message: string, public status = 400, public retryable = false) { super(message); } }
export function owner(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new VoiceError("Sign in to Personal Daily to use the Voice Inbox.", 401);
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) throw new VoiceError("Use Personal Daily to submit this change.", 403);
  return id;
}
export function failure(error: unknown) {
  const known = error instanceof VoiceError;
  return Response.json({ error: known ? error.message : "Could not save this request. Keep your local recording and retry.", retryable: known ? error.retryable : true }, { status: known ? error.status : 500 });
}
export function configured() { return Boolean(env.OPENAI_API_KEY); }
export async function capture(id: string, user: string) {
  const row = await getD1().prepare("SELECT * FROM voice_captures WHERE id = ? AND owner_id = ?").bind(id, user).first<Capture & { owner_id: string; checksum: string; request_id: string; lease: string | null }>();
  if (!row) throw new VoiceError("Recording not found.", 404);
  return row;
}
export async function context() {
  const db = getD1();
  const [nodes, columns, cards, slots] = await Promise.all([
    db.prepare("SELECT id, title, parent_id, kind, notes FROM nodes WHERE status = 'active' AND is_draft = 0 LIMIT 1000").all(),
    db.prepare("SELECT id, title FROM planning_columns WHERE status = 'active' LIMIT 200").all(),
    db.prepare("SELECT id, column_id, title, notes FROM planning_cards WHERE status = 'active' LIMIT 1000").all(),
    db.prepare("SELECT date, time, item_id, item_title FROM daily_slots ORDER BY date DESC LIMIT 2000").all(),
  ]);
  return { nodes: nodes.results, columns: columns.results, cards: cards.results, slots: slots.results };
}
export async function provider(path: string, init: RequestInit) {
  if (!env.OPENAI_API_KEY) throw new VoiceError("AI is not connected. Configure OPENAI_API_KEY in this site's settings, then retry.", 503);
  let response: Response;
  try { response = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(120000) }); }
  catch { throw new VoiceError("The AI request timed out or lost its connection. Retry when ready.", 503, true); }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new VoiceError(response.status === 401 || response.status === 403 ? "The AI key was rejected. Check the site's AI settings." : response.status === 429 ? "The AI service is busy or its quota is exhausted. Check your quota before retrying." : `The AI service could not process this request (${response.status}).`, 502, retryable);
  }
  return response;
}
export async function lease(id: string, user: string, status: string, transcript = "", regenerate = false) {
  const token = crypto.randomUUID();
  const db = getD1();
  const result = await db.prepare("UPDATE voice_captures SET lease = ?, lease_until = ?, status = ?, error = '', retryable = 0 WHERE id = ? AND owner_id = ? AND lease_until < ? AND transcript = ? AND NOT EXISTS (SELECT 1 FROM voice_actions WHERE capture_id = ? AND (? = 0 OR status = 'approved'))").bind(token, Date.now()+180000, status, id, user, Date.now(), transcript, id, Number(regenerate)).run();
  if (!result.meta.changes) throw new VoiceError("This recording is already being processed. Refresh in a moment.", 409, true);
  return token;
}
export async function markFailed(id: string, token: string, stage: string, error: unknown) {
  const message = error instanceof VoiceError ? error.message : "Processing was interrupted. Retry this stage.";
  await getD1().prepare("UPDATE voice_captures SET status = ?, error = ?, retryable = ?, lease = NULL, lease_until = 0 WHERE id = ? AND lease = ?").bind(stage, message, error instanceof VoiceError ? Number(error.retryable) : 1, id, token).run();
}
export async function transcribe(id: string, user: string, file: File) {
  const token = await lease(id, user, "transcribing");
  try {
    const form = new FormData(); form.set("file", file); form.set("model", env.VOICE_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
    const response = await provider("audio/transcriptions", { method: "POST", body: form });
    const data = await response.json() as { text?: string };
    if (!data.text?.trim()) throw new VoiceError("No speech was found. Choose another recording or enter the transcript yourself.", 422);
    if (data.text.length > 20000) throw new VoiceError("The transcript is too long. Split the recording into shorter clips.", 422);
    const saved = await getD1().prepare("UPDATE voice_captures SET transcript = ?, status = 'transcribed', lease = NULL, lease_until = 0 WHERE id = ? AND lease = ?").bind(data.text.trim(), id, token).run();
    if (!saved.meta.changes) throw new VoiceError("Processing ownership changed. Refresh before retrying.", 409);
  } catch (error) { await markFailed(id, token, "transcription_failed", error); throw error; }
}
export async function generateProposals(c: Capture, ctx: Awaited<ReturnType<typeof context>>, model:string) {
    const started=Date.now();
    const response = await provider("chat/completions", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      model, service_tier:"default", max_completion_tokens:12000, ...(model.startsWith("gpt-6") || model.startsWith("gpt-5") ? { reasoning_effort: "low" } : {}), store:false, messages:[{role:"system",content:interpretationPrompt(c,ctx)},{role:"user",content:c.transcript}],
      response_format:{type:"json_schema",json_schema:{name:"voice_proposals",strict:true,schema:proposalSchema}}
    }) });
    const data = await response.json() as { model?:string; service_tier?:string; usage?: {prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens?:number};completion_tokens_details?:{reasoning_tokens?:number}}; choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[] };
    if (data.choices?.[0]?.finish_reason !== "stop" || !data.choices[0].message?.content) throw new VoiceError("AI could not produce a complete proposal. Edit the transcript and retry.", 422);
    const parsed = JSON.parse(data.choices[0].message.content) as { recording_mode?: unknown; actions?: unknown[] };
    if (!['reflection','actions'].includes(String(parsed.recording_mode)) || !Array.isArray(parsed.actions) || parsed.actions.length > 30) throw new VoiceError("AI returned invalid proposals. Retry interpretation.", 422, true);
    const actions = parsed.actions.map(parseProposal);
    if(parsed.recording_mode === "reflection") {
      if(actions.length!==1 || actions[0].type!=="review_note" || !actions[0].notes) throw new VoiceError("AI did not preserve this reflection as one daily note. Retry interpretation.",422,true);
      actions[0].date=c.local_date;
    } else if(actions.some(p=>p.type==="review_note")) throw new VoiceError("AI mixed reflection with task updates. Retry interpretation.",422,true);
    for(const p of actions) {
      if(p.type === "record_activity") p.destination_id=""; // The user chooses; never accept an AI-invented category.
      if(p.type === "record_activity" || p.type === "plan") {
        if(!p.evidence || !c.transcript.includes(p.evidence)) { p.needs_clarification=true; p.reason="The supporting quote could not be verified. Review against the transcript."; }
        if(p.target_id) {
          const match=ctx.nodes.find(n=>n.id===p.target_id);
          if(!match || match.title!==p.title) {p.needs_clarification=true;p.reason="The referenced task was not matched exactly. Select the correct task or create a new one.";}
        }
      }
    }
    return {actions,model:data.model||model,usage:data.usage||null,service_tier:data.service_tier||"default",elapsed_ms:Date.now()-started};
}
export async function interpret(id: string, user: string, regenerate = false) {
  const c = await capture(id, user);
  if (!c.transcript) throw new VoiceError("Re-upload the saved audio or enter a transcript first.");
  const existing = await getD1().prepare("SELECT id FROM voice_actions WHERE capture_id = ? LIMIT 1").bind(id).first();
  if (existing && !regenerate) return; // Never regenerate resolved or edited actions.
  const token = await lease(id, user, "interpreting", c.transcript, regenerate);
  try {
    const ctx = await context();
    const model=env.VOICE_INTERPRETATION_MODEL || "gpt-4.1";
    const {actions} = await generateProposals(c,ctx,model);
    const db = getD1();
    await db.batch([
      ...(regenerate ? [db.prepare("UPDATE voice_actions SET status = 'superseded' WHERE capture_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM voice_captures WHERE id = ? AND lease = ?)").bind(id,id,token)] : []),
      ...actions.map(p => db.prepare("INSERT INTO voice_actions (id, capture_id, proposal) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM voice_captures WHERE id = ? AND lease = ?)").bind(crypto.randomUUID(), id, JSON.stringify(p), id, token)),
      db.prepare("UPDATE voice_captures SET status = 'ready', interpretation_model = ?, interpretation_version = 3, error = '', lease = NULL, lease_until = 0 WHERE id = ? AND lease = ?").bind(model, id, token),
    ]);
  } catch (error) { await markFailed(id, token, "interpretation_failed", error); throw error; }
}
export function localContext(date: string, timezone: string) {
  if (!validDate(date)) throw new VoiceError("Supply the recording's local date (YYYY-MM-DD).");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new VoiceError("Supply a valid timezone, such as Asia/Shanghai."); }
  return { date, timezone };
}

export async function comparisons(id:string,user:string) {
  await capture(id,user);
  const rows=await getD1().prepare("SELECT id, created_at, lease_until, adopted_model, results FROM voice_comparisons WHERE capture_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10").bind(id).all();
  return rows.results.map(r=>({...r,results:JSON.parse(String(r.results))}));
}
export async function compareModels(id:string,user:string,models:unknown) {
  if(!Array.isArray(models)||models.length<2||models.length>4||new Set(models).size!==models.length||models.some(m=>!comparisonModels.some(x=>x.id===m))) throw new VoiceError("Choose two to four supported models.");
  if(!configured()) throw new VoiceError("Configure OPENAI_API_KEY first.",503);
  const c=await capture(id,user);if(!c.transcript) throw new VoiceError("Save a transcript first.");
  const ctx=await context(), db=getD1(), comparisonId=crypto.randomUUID();
  const inserted=await db.prepare("INSERT INTO voice_comparisons (id,capture_id,snapshot,lease_until) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM voice_comparisons WHERE capture_id = ? AND lease_until > ?)").bind(comparisonId,id,JSON.stringify({capture:c,context:ctx,models,prompt_version:2,pricing_date:"2026-09-08"}),Date.now()+180000,id,Date.now()).run();
  if(!inserted.meta.changes) throw new VoiceError("A comparison is still running. Refresh shortly.",409);
  // All models receive the same saved transcript, context and prompt. No board writes.
  const results:ComparisonResult[]=await Promise.all(models.map(async model=>{
    try {
      const result=await generateProposals(c,ctx,model);
      const rate=comparisonModels.find(m=>m.id===model)!;const u=result.usage;
      const cached=Math.min(u?.prompt_tokens||0,u?.prompt_tokens_details?.cached_tokens||0);
      const long=Boolean(u&&u.prompt_tokens>272000);
      const estimate=u&&result.service_tier==="default" ? ((u.prompt_tokens-cached)*rate.input*(long?2:1)+cached*rate.cached*(long?2:1)+u.completion_tokens*rate.output*(long?1.5:1))/1000000 : null;
      return {...result,requested_model:model,estimated_usd:estimate};
    }catch(e){return {requested_model:model,error:e instanceof VoiceError?e.message:"The response was invalid. Try another comparison."};}
  }));
  await db.prepare("UPDATE voice_comparisons SET results = ?, lease_until = 0 WHERE id = ?").bind(JSON.stringify(results),comparisonId).run();
  return comparisons(id,user);
}
export async function adoptComparison(id:string,user:string,comparisonId:string,model:string) {
  const c=await capture(id,user),db=getD1();
  const row=await db.prepare("SELECT snapshot,results FROM voice_comparisons WHERE id = ? AND capture_id = ? AND lease_until = 0 AND adopted_model = ''").bind(comparisonId,id).first<{snapshot:string;results:string}>();
  if(!row) throw new VoiceError("Comparison is missing, still running, or already selected.",409);
  if(JSON.parse(row.snapshot).capture.transcript!==c.transcript) throw new VoiceError("The transcript changed. Run a new comparison.",409);
  const result=(JSON.parse(row.results) as ComparisonResult[]).find(r=>r.requested_model===model&&!r.error&&r.actions);
  if(!result?.actions) throw new VoiceError("Choose a successful result.");
  const actions=result.actions.map(parseProposal),token=await lease(id,user,"interpreting",c.transcript,true);
  try {
    await db.batch([
      db.prepare("UPDATE voice_actions SET status = 'superseded' WHERE capture_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM voice_captures WHERE id = ? AND lease = ?)").bind(id,id,token),
      ...actions.map(p=>db.prepare("INSERT INTO voice_actions (id,capture_id,proposal) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM voice_captures WHERE id = ? AND lease = ?)").bind(crypto.randomUUID(),id,JSON.stringify(p),id,token)),
      db.prepare("UPDATE voice_comparisons SET adopted_model = ? WHERE id = ? AND EXISTS (SELECT 1 FROM voice_captures WHERE id = ? AND lease = ?)").bind(model,comparisonId,id,token),
      db.prepare("UPDATE voice_captures SET status = 'ready', interpretation_model = ?, interpretation_version = 3, lease = NULL, lease_until = 0 WHERE id = ? AND lease = ?").bind(result.model||model,id,token),
    ]);
  }catch(e){await markFailed(id,token,"interpretation_failed",e);throw e;}
}
