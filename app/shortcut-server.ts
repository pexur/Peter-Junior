import { env } from "cloudflare:workers";
import { getD1 } from "../db";
import { localContext, VoiceError } from "./voice-server";
import { MAX_AUDIO_BYTES, processAudio, stagingKey, validAudioFilename, validUploadId } from "./voice-upload-server";

export const SHORTCUT_CHUNK_BYTES = 192 * 1024;
export const SHORTCUT_BASE64_CHARS = 256 * 1024;
const DIRECT_LIMIT = 850 * 1024;

export async function shortcutOwner(request: Request) {
  if (!env.SHORTCUT_UPLOAD_TOKEN || !env.SHORTCUT_OWNER_ID) throw new VoiceError("Shortcut uploads are not configured.", 503);
  const supplied = request.headers.get("x-next-up-token") || "";
  if (!supplied || supplied.length > 256) throw new VoiceError("Invalid upload token.", 401);
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a,b] = await Promise.all([digest(supplied),digest(env.SHORTCUT_UPLOAD_TOKEN)]);
  let difference = 0; for (let i=0;i<a.length;i++) difference |= a[i]^b[i];
  if (difference) throw new VoiceError("Invalid upload token.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new VoiceError("Use your configured Shortcut to upload.",403);
  return env.SHORTCUT_OWNER_ID;
}

async function boundedBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0)>limit) throw new VoiceError("Upload request is too large. Use the chunked Shortcut flow for files up to 10 MB.",413);
  if (!request.body) throw new VoiceError("An upload body is required.");
  const reader=request.body.getReader(), chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new VoiceError("Upload request is too large. Use the chunked Shortcut flow for files up to 10 MB.",413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function uploadId(value: unknown) {
  if(typeof value!=="string" || value.length>80 || !validUploadId(value))throw new VoiceError("Supply a stable request_id; reuse it when retrying this recording.");
  return `shortcut-${value}`;
}
function textField(body:Record<string,unknown>,key:string,label:string,defaultValue?:string) {
  const raw=body[key];
  if(raw===undefined&&defaultValue!==undefined)return defaultValue;
  if(typeof raw!=="string")throw new VoiceError(`${label} must be sent as Text; received ${raw===undefined?"a missing value":raw===null?"null":typeof raw}.`);
  return raw.trim();
}
function contextFields(body:Record<string,unknown>) {
  const date=textField(body,"local_date","local_date"),timezone=textField(body,"timezone","timezone");
  try{return localContext(date,timezone);}
  catch(error){
    if(error instanceof VoiceError)throw new VoiceError(`${error.message} Personal Daily received local_date ${JSON.stringify(date.slice(0,50))} as Text and timezone ${JSON.stringify(timezone.slice(0,100))}.`,error.status,error.retryable);
    throw error;
  }
}
function reply(value: unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}});}
function receipt(c:{id:string;status:string;transcript:string}){
  return {capture_id:c.id,status:c.status,transcript_saved:Boolean(c.transcript),review_url:"/voice",keep_local_copy:true};
}
type Upload={filename:string;content_type:string;size:number;total_chunks:number;local_date:string;timezone:string};

export async function handleShortcut(request: Request) {
  const user=await shortcutOwner(request);
  if(!request.headers.get("content-type")?.includes("application/json")){
    const id=uploadId(request.headers.get("x-request-id"));
    const bytes=await boundedBytes(request,DIRECT_LIMIT);
    const file=new File([bytes],request.headers.get("x-filename")||"recording.m4a",{type:request.headers.get("content-type")||"audio/mp4"});
    const result=await processAudio(user,file,id,request.headers.get("x-local-date")||"",request.headers.get("x-timezone")||"");
    return reply({...result,keep_local_copy:true});
  }
  let body:Record<string,unknown>;
  try{body=JSON.parse(new TextDecoder().decode(await boundedBytes(request,SHORTCUT_BASE64_CHARS+8192)));}
  catch(error){if(error instanceof VoiceError)throw error;throw new VoiceError("Use a valid JSON request body.");}
  if(!body||typeof body!=="object"||Array.isArray(body))throw new VoiceError("Use a JSON object.");
  if(body.action==="check")return reply({ready:true,max_audio_bytes:MAX_AUDIO_BYTES,base64_chunk_chars:SHORTCUT_BASE64_CHARS});
  const id=uploadId(body.request_id),db=getD1();
  if(body.action==="start"){
    const suppliedTotal=Number(body.total_chunks),suppliedSize=Number(body.size),usesPartCount=body.total_chunks!==undefined;
    const maxParts=Math.ceil(MAX_AUDIO_BYTES/SHORTCUT_CHUNK_BYTES);
    if(usesPartCount&&(!Number.isInteger(suppliedTotal)||suppliedTotal<1||suppliedTotal>maxParts))throw new VoiceError(`total_chunks must be a Number from 1 to ${maxParts}. Use Count on Parts.`);
    if(!usesPartCount&&(!Number.isInteger(suppliedSize)||suppliedSize<1||suppliedSize>MAX_AUDIO_BYTES))throw new VoiceError("Choose a non-empty recording up to 10 MB.",413);
    const size=usesPartCount?0:suppliedSize,filename=textField(body,"filename","filename","recording.m4a").slice(0,200),contentType=textField(body,"content_type","content_type","audio/mp4").slice(0,100);
    if(!validAudioFilename(filename))throw new VoiceError("Use a supported audio file such as M4A, MP3, or WAV.",415);
    const local=contextFields(body),total=usesPartCount?suppliedTotal:Math.ceil(size/SHORTCUT_CHUNK_BYTES);
    await db.prepare("INSERT OR IGNORE INTO voice_uploads (id,owner_id,filename,content_type,size,total_chunks,local_date,timezone) VALUES (?,?,?,?,?,?,?,?)").bind(id,user,filename,contentType,size,total,local.date,local.timezone).run();
    const row=await db.prepare("SELECT filename,content_type,size,total_chunks,local_date,timezone FROM voice_uploads WHERE id=? AND owner_id=?").bind(id,user).first<Upload>();
    if(!row||row.filename!==filename||row.size!==size||row.content_type!==contentType||row.local_date!==local.date||row.timezone!==local.timezone||row.total_chunks!==total)throw new VoiceError("This request_id belongs to different audio or recording details. Use the original details or a new ID.",409);
    return reply({upload_started:true,total_chunks:total,base64_chunk_chars:SHORTCUT_BASE64_CHARS});
  }
  if(body.action!=="chunk"&&body.action!=="complete")throw new VoiceError("Use action check, start, chunk, or complete.");
  // A lost successful completion response can be retried without another paid call.
  const row=await db.prepare("SELECT filename,content_type,size,total_chunks,local_date,timezone FROM voice_uploads WHERE id=? AND owner_id=?").bind(id,user).first<Upload>();
  if(body.action==="complete"&&!row){
    const c=await db.prepare("SELECT id,status,transcript FROM voice_captures WHERE owner_id=? AND request_id=?").bind(user,id).first<{id:string;status:string;transcript:string}>();
    if(c?.transcript)return reply(receipt(c));
  }
  if(!row)throw new VoiceError("Upload not found. Start again using your saved recording.",404);
  if(body.action==="chunk"){
    const part=Number(body.part);
    if(!Number.isInteger(part)||part<1||part>row.total_chunks)throw new VoiceError("Invalid part number. Parts start at 1.");
    const data=body.data;
    if(typeof data!=="string"||data.length>SHORTCUT_BASE64_CHARS||!data.length||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new VoiceError("Use Base64 with line breaks disabled and split into 262144-character parts.");
    let binary:string;try{binary=atob(data);}catch{throw new VoiceError("Invalid Base64 audio.");}
    const expected=row.size?Math.min(SHORTCUT_CHUNK_BYTES,row.size-(part-1)*SHORTCUT_CHUNK_BYTES):part<row.total_chunks?SHORTCUT_CHUNK_BYTES:null;
    if((expected!==null&&binary.length!==expected)||(expected===null&&(binary.length<1||binary.length>SHORTCUT_CHUNK_BYTES)))throw new VoiceError("Audio part has the wrong size. Keep the original file and retry.");
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    await env.BUCKET.put(stagingKey(user,id,part-1),bytes.buffer,{httpMetadata:{contentType:"application/octet-stream"}});
    return reply({uploaded:true,part});
  }
  const keys=Array.from({length:row.total_chunks},(_,part)=>stagingKey(user,id,part));
  const objects=await Promise.all(keys.map(key=>env.BUCKET.get(key)));
  if(objects.some(object=>!object))throw new VoiceError("Some audio parts are missing. Retry from the saved recording.",409,true);
  const chunks=await Promise.all(objects.map(object=>object!.arrayBuffer()));
  const assembledSize=chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0);
  if((row.size&&assembledSize!==row.size)||assembledSize<1||assembledSize>MAX_AUDIO_BYTES)throw new VoiceError("The recording is incomplete or larger than 10 MB. Retry the upload.",409,true);
  const result=await processAudio(user,new File(chunks,row.filename,{type:row.content_type}),id,row.local_date,row.timezone);
  if(result.transcript_saved){await env.BUCKET.delete(keys);await db.prepare("DELETE FROM voice_uploads WHERE id=? AND owner_id=?").bind(id,user).run();}
  return reply({...result,keep_local_copy:true});
}
