import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { AUDIO_CHUNK_BYTES, stagingKey, validUploadId } from "../../../../voice-upload-server";
import { failure, owner, VoiceError } from "../../../../voice-server";

export async function PUT(request:Request,{params}:{params:Promise<{id:string;part:string}>}) {
  try {
    const user=owner(request),{id,part:rawPart}=await params,part=Number(rawPart);
    if(!validUploadId(id)||!Number.isInteger(part)||part<0) throw new VoiceError("Invalid upload part.");
    const row=await getD1().prepare("SELECT owner_id,size,total_chunks FROM voice_uploads WHERE id = ? AND owner_id = ?").bind(id,user).first<{owner_id:string;size:number;total_chunks:number}>();
    if(!row||part>=row.total_chunks) throw new VoiceError("Upload not found or part is invalid.",404);
    const expected=Math.min(AUDIO_CHUNK_BYTES,row.size-part*AUDIO_CHUNK_BYTES);
    const declared=Number(request.headers.get("content-length")||0);
    if(declared&&declared!==expected) throw new VoiceError("This upload part is incomplete. Retry it.",400,true);
    const bytes=await request.arrayBuffer();
    if(bytes.byteLength!==expected) throw new VoiceError("This upload part is incomplete. Retry it.",400,true);
    await env.BUCKET.put(stagingKey(user,id,part),bytes,{httpMetadata:{contentType:"application/octet-stream"}});
    return Response.json({uploaded:part});
  }catch(error){return failure(error);}
}
