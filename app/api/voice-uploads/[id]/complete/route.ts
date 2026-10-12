import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { processAudio, stagingKey, validUploadId } from "../../../../voice-upload-server";
import { failure, owner, VoiceError } from "../../../../voice-server";

type UploadRow={owner_id:string;filename:string;content_type:string;size:number;total_chunks:number;local_date:string;timezone:string};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=owner(request),{id}=await params;if(!validUploadId(id))throw new VoiceError("Invalid upload ID.");
    const row=await getD1().prepare("SELECT owner_id,filename,content_type,size,total_chunks,local_date,timezone FROM voice_uploads WHERE id = ? AND owner_id = ?").bind(id,user).first<UploadRow>();
    if(!row)throw new VoiceError("Upload not found. Start it again from the saved recording.",404);
    const keys=Array.from({length:row.total_chunks},(_,part)=>stagingKey(user,id,part));
    const objects=await Promise.all(keys.map(key=>env.BUCKET.get(key)));
    if(objects.some(object=>!object))throw new VoiceError("Some upload parts are missing. Retry the upload.",409,true);
    const chunks=await Promise.all(objects.map(object=>object!.arrayBuffer()));
    if(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0)!==row.size)throw new VoiceError("The uploaded audio is incomplete. Retry from the local copy.",409,true);
    const result=await processAudio(user,new File(chunks,row.filename,{type:row.content_type}),id,row.local_date,row.timezone);
    if(result.transcript_saved) {
      await env.BUCKET.delete(keys);
      await getD1().prepare("DELETE FROM voice_uploads WHERE id = ? AND owner_id = ?").bind(id,user).run();
    }
    return Response.json(result);
  }catch(error){return failure(error);}
}
