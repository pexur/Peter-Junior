import { getD1 } from "../../../db";
import { AUDIO_CHUNK_BYTES, MAX_AUDIO_BYTES, validAudioFilename, validUploadId } from "../../voice-upload-server";
import { failure, localContext, owner, VoiceError } from "../../voice-server";

export async function POST(request: Request) {
  try {
    const user = owner(request);
    if (Number(request.headers.get("content-length") || 0) > 25000) throw new VoiceError("Upload details are too large.", 413);
    const body = await request.json() as { upload_id?:string; filename?:string; content_type?:string; size?:number; total_chunks?:number; local_date?:string; timezone?:string };
    const id=String(body.upload_id||""),filename=String(body.filename||"").slice(0,200),contentType=String(body.content_type||"application/octet-stream").slice(0,100);
    const size=Number(body.size),total=Math.ceil(size/AUDIO_CHUNK_BYTES),local=localContext(String(body.local_date||""),String(body.timezone||""));
    if(!validUploadId(id)) throw new VoiceError("Use a valid upload ID.");
    if(!validAudioFilename(filename)) throw new VoiceError("Use an M4A, MP3, MP4, MPEG, MPGA, WAV, WebM, OGG, or FLAC recording.",415);
    if(!Number.isInteger(size)||size<1||size>MAX_AUDIO_BYTES) throw new VoiceError("Choose a non-empty audio file under 10 MB.",413);
    if(body.total_chunks!==total||total<1||total>20) throw new VoiceError("The upload was divided incorrectly. Retry from the saved recording.");
    const db=getD1();
    await db.prepare("INSERT OR IGNORE INTO voice_uploads (id,owner_id,filename,content_type,size,total_chunks,local_date,timezone) VALUES (?,?,?,?,?,?,?,?)").bind(id,user,filename,contentType,size,total,local.date,local.timezone).run();
    const row=await db.prepare("SELECT filename,content_type,size,total_chunks,local_date,timezone FROM voice_uploads WHERE id = ? AND owner_id = ?").bind(id,user).first<Record<string,unknown>>();
    if(!row||row.filename!==filename||row.content_type!==contentType||Number(row.size)!==size||Number(row.total_chunks)!==total||row.local_date!==local.date||row.timezone!==local.timezone) throw new VoiceError("This upload ID belongs to different audio. Record again or choose the original file.",409);
    return Response.json({upload_id:id,total_chunks:total,chunk_bytes:AUDIO_CHUNK_BYTES});
  } catch(error) { return failure(error); }
}
