import { getD1 } from "../../../db";
import { capture, configured, context, failure, interpret, localContext, owner, transcribe, VoiceError } from "../../voice-server";
// Leave headroom for multipart fields under the hosted request boundary.
const MAX = 850 * 1024;
export async function GET(request: Request) {
  try {
    const user = owner(request); const db = getD1();
    const [captures, actions, board] = await Promise.all([
      db.prepare("SELECT id, filename, status, transcript, error, retryable, created_at, local_date, timezone, lease_until, interpretation_model, interpretation_version FROM voice_captures WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 100").bind(user).all(),
      db.prepare("SELECT a.id, a.capture_id, a.proposal, a.status FROM voice_actions a JOIN voice_captures c ON c.id = a.capture_id WHERE c.owner_id = ? AND c.id IN (SELECT id FROM voice_captures WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 100) ORDER BY a.created_at, a.id").bind(user,user).all<{proposal:string}>(), context(),
    ]);
    return Response.json({ captures: captures.results.map(c => ({ ...c, processing: Number(c.lease_until) > Date.now() })), actions: actions.results.map(a => ({ ...a, proposal: JSON.parse(a.proposal) })), context: board, ai_configured: configured() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX + 65536) throw new VoiceError("Choose a recording under 850 KB.", 413);
  if (!request.body) throw new VoiceError("An audio file is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if(size > MAX+65536) { await reader.cancel(); throw new VoiceError("Choose a recording under 850 KB.",413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;} return bytes;
}
export async function POST(request: Request) {
  let id = ""; let user = "";
  try {
    user = owner(request);
    const bytes = await boundedBody(request);
    const type = request.headers.get("content-type") || "";
    const form = type.includes("multipart/form-data") ? await new Response(bytes, { headers:{"Content-Type":type} }).formData() : null;
    const file = form ? form.get("file") : new File([bytes], request.headers.get("x-filename") || "recording.m4a", {type:type || "audio/mp4"});
    if (!(file instanceof File) || !file.size || file.size > MAX) throw new VoiceError("Choose a non-empty audio file under 850 KB.", 413);
    if (!/\.(m4a|mp3|mp4|mpeg|mpga|wav|webm|ogg|flac)$/i.test(file.name)) throw new VoiceError("Use an M4A, MP3, MP4, MPEG, MPGA, WAV, WebM, OGG, or FLAC recording.", 415);
    const requestId = String(form?.get("request_id") || request.headers.get("x-request-id") || "");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new VoiceError("Include a stable request_id for this recording; reuse it on retries.");
    const local = localContext(String(form?.get("local_date") || request.headers.get("x-local-date") || ""), String(form?.get("timezone") || request.headers.get("x-timezone") || ""));
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const checksum = Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2,"0")).join("");
    const db = getD1(); const candidateId = crypto.randomUUID();
    await db.prepare("INSERT OR IGNORE INTO voice_captures (id, owner_id, request_id, checksum, filename, local_date, timezone) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(candidateId, user, requestId, checksum, file.name.slice(0,200), local.date, local.timezone).run();
    const row = await db.prepare("SELECT id, checksum FROM voice_captures WHERE owner_id = ? AND request_id = ?").bind(user,requestId).first<{id:string;checksum:string}>();
    if (row && row.checksum !== checksum) throw new VoiceError("That request_id belongs to a different recording. Use a new ID.",409);
    const match = row || await db.prepare("SELECT id, checksum FROM voice_captures WHERE owner_id = ? AND checksum = ?").bind(user,checksum).first<{id:string;checksum:string}>();
    if (!match) throw new VoiceError("Could not register this recording. Keep the local file and retry.",503,true);
    id = match.id;
    let c = await capture(id,user);
    if (!c.transcript) await transcribe(id,user,file);
    c = await capture(id,user);
    // The durable transcript is the acknowledgement. Interpretation can be retried
    // independently, without resending audio or claiming a durable audio upload.
    if (c.status !== "ready") { try { await interpret(id,user); } catch { /* durable transcript remains */ } }
    c = await capture(id,user);
    return Response.json({capture_id:id,status:c.status,transcript_saved:Boolean(c.transcript),audio_stored:false,error:c.error,review_url:"/voice"});
  } catch(error) {
    const result = failure(error); const body = await result.json();
    return Response.json({...body,...(id ? {capture_id:id}:{}),transcript_saved:false,audio_stored:false}, {status:result.status});
  }
}
