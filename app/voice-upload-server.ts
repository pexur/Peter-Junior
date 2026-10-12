import { getD1 } from "../db";
import { capture, interpret, localContext, transcribe, VoiceError } from "./voice-server";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const AUDIO_CHUNK_BYTES = 512 * 1024;

export function validUploadId(value: string) { return /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
export function validAudioFilename(value: string) { return /\.(m4a|mp3|mp4|mpeg|mpga|wav|webm|ogg|flac)$/i.test(value); }
export function stagingKey(owner: string, uploadId: string, part: number) { return `voice-staging/${owner}/${uploadId}/${part}`; }

export async function processAudio(user: string, file: File, requestId: string, localDate: string, timezone: string) {
  if (!file.size || file.size > MAX_AUDIO_BYTES) throw new VoiceError("Choose a non-empty audio file under 10 MB.", 413);
  if (!validAudioFilename(file.name)) throw new VoiceError("Use an M4A, MP3, MP4, MPEG, MPGA, WAV, WebM, OGG, or FLAC recording.", 415);
  if (!validUploadId(requestId)) throw new VoiceError("Include a stable request_id for this recording; reuse it on retries.");
  const local = localContext(localDate, timezone);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const checksum = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  const db = getD1(); const candidateId = crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO voice_captures (id, owner_id, request_id, checksum, filename, local_date, timezone) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(candidateId, user, requestId, checksum, file.name.slice(0, 200), local.date, local.timezone).run();
  const row = await db.prepare("SELECT id, checksum FROM voice_captures WHERE owner_id = ? AND request_id = ?").bind(user, requestId).first<{id:string;checksum:string}>();
  if (row && row.checksum !== checksum) throw new VoiceError("That request_id belongs to a different recording. Use a new ID.", 409);
  const match = row || await db.prepare("SELECT id, checksum FROM voice_captures WHERE owner_id = ? AND checksum = ?").bind(user, checksum).first<{id:string;checksum:string}>();
  if (!match) throw new VoiceError("Could not register this recording. Keep the local file and retry.", 503, true);
  const id = match.id;
  let c = await capture(id, user);
  if (!c.transcript) await transcribe(id, user, file);
  c = await capture(id, user);
  if (c.status !== "ready") { try { await interpret(id, user); } catch { /* durable transcript remains */ } }
  c = await capture(id, user);
  return { capture_id:id, status:c.status, transcript_saved:Boolean(c.transcript), audio_stored:false, error:c.error, review_url:"/voice" };
}
