import { owner, failure, comparisons, compareModels, adoptComparison, VoiceError } from "../../../../voice-server";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {return Response.json({comparisons:await comparisons((await params).id,owner(request))});}catch(e){return failure(e);}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const user=owner(request),{id}=await params;
    const b=await request.json() as {action:string;models?:unknown;comparison_id?:string;model?:string};
    if(b.action==="compare") return Response.json({comparisons:await compareModels(id,user,b.models)});
    if(b.action==="adopt"&&b.comparison_id&&b.model) {await adoptComparison(id,user,b.comparison_id,b.model);return Response.json({ok:true});}
    throw new VoiceError("Unknown comparison action.");
  }catch(e){return failure(e);}
}
