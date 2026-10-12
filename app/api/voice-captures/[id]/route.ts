import { getD1 } from "../../../../db";
import { capture, failure, interpret, owner, VoiceError } from "../../../voice-server";
export async function POST(request: Request, { params }: {params:Promise<{id:string}>}) {
  try {
    const user=owner(request); const {id}=await params; const c=await capture(id,user);
    if (Number(request.headers.get("content-length") || 0)>25000) throw new VoiceError("Transcript is too long.",413);
    const data=await request.json() as {action?:string;transcript?:string};
    if(data.action === "delete") {
      const db=getD1();
      const eligible="SELECT id FROM voice_captures WHERE id = ? AND owner_id = ? AND lease_until < ? AND NOT EXISTS (SELECT 1 FROM voice_actions WHERE capture_id = voice_captures.id) AND NOT EXISTS (SELECT 1 FROM voice_comparisons WHERE capture_id = voice_captures.id AND lease_until >= ?)";
      const now=Date.now();
      const results=await db.batch([
        db.prepare(`DELETE FROM voice_comparisons WHERE capture_id IN (${eligible})`).bind(id,user,now,now),
        db.prepare(`DELETE FROM voice_captures WHERE id IN (${eligible})`).bind(id,user,now,now),
      ]);
      if(!results[1].meta.changes) throw new VoiceError("This recording is processing or has proposals and cannot be deleted.",409);
      return Response.json({capture_id:c.id,deleted:true});
    } else if(data.action === "save_transcript") {
      if(typeof data.transcript !== "string" || !data.transcript.trim() || data.transcript.length>20000) throw new VoiceError("Enter a transcript under 20,000 characters.");
      const db=getD1();
      const result=await db.prepare("UPDATE voice_captures SET transcript = ?, status = 'transcribed', error = '', lease = NULL, lease_until = 0 WHERE id = ? AND owner_id = ? AND lease_until < ? AND NOT EXISTS (SELECT 1 FROM voice_actions WHERE capture_id = ?)").bind(data.transcript.trim(),id,user,Date.now(),id).run();
      if(!result.meta.changes) throw new VoiceError("This recording is processing or already has proposals. Edit its individual proposals instead.",409);
    } else if(data.action === "interpret" || data.action === "regenerate") { await interpret(id,user,data.action === "regenerate"); }
    else throw new VoiceError("Unknown capture action.");
    return Response.json({capture_id:c.id,status:(await capture(id,user)).status});
  }catch(error){return failure(error);}
}
