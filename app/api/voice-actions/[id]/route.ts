import { getD1 } from "../../../../db";
import { failure, owner, VoiceError } from "../../../voice-server";
import { parseProposal } from "../../../voice-types";
import { approve } from "../../../voice-approval";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const user=owner(request);const {id}=await params;const db=getD1();
    const row=await db.prepare("SELECT a.proposal,a.status FROM voice_actions a JOIN voice_captures c ON c.id = a.capture_id WHERE a.id = ? AND c.owner_id = ? AND c.lease_until < ?").bind(id,user,Date.now()).first<{proposal:string;status:string}>();
    if(!row) throw new VoiceError("Proposal not found.",404);
    const body=await request.json() as {action:string;proposal?:unknown;expected_proposal?:string};
    if(row.status !== "pending") return Response.json({status:row.status});
    if(body.expected_proposal !== row.proposal) throw new VoiceError("This proposal changed. Refresh before reviewing it.",409);
    if(body.action === "approve") {
      try { await approve(db,id,user,body.proposal??JSON.parse(row.proposal),row.proposal); }
      catch(error){throw new VoiceError(error instanceof Error?error.message:"Could not approve this proposal.",409);}
    } else if(body.action === "reject" || body.action === "edit") {
      const proposal=body.action === "edit"?JSON.stringify(parseProposal(body.proposal)):row.proposal;
      const result=await db.prepare("UPDATE voice_actions SET proposal = ?, status = ? WHERE id = ? AND status = 'pending' AND proposal = ? AND EXISTS (SELECT 1 FROM voice_captures c WHERE c.id = voice_actions.capture_id AND c.owner_id = ? AND c.lease_until < ?)").bind(proposal,body.action === "reject"?"rejected":"pending",id,row.proposal,user,Date.now()).run();
      if(!result.meta.changes) throw new VoiceError("This proposal changed. Refresh and try again.",409);
    }else throw new VoiceError("Unknown action.");
    return Response.json({status:body.action === "approve"?"approved":body.action === "reject"?"rejected":"pending"});
  }catch(error){return failure(error);}
}
