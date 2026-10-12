"use client";
import { useI18n } from "../i18n/provider";

import {useEffect,useState} from "react";
import {comparisonModels, completionLabels, type Comparison} from "../voice-types";
async function request(url:string,body?:unknown) {
  const response=await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  if(!response.headers.get("content-type")?.includes("application/json")) throw new Error("Sign in again, then refresh the saved results.");
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load comparison.");return data;
}
export default function ModelComparison({captureId,disabled,canAdopt,onAdopt}:{captureId:string;disabled:boolean;canAdopt:boolean;onAdopt:(url:string,body:unknown)=>Promise<void>}) {
  const { tr } = useI18n();
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>(["gpt-4.1","gpt-5.6-sol","gpt-6-astra"]),[runs,setRuns]=useState<Comparison[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [now,setNow]=useState(0);
  useEffect(()=>{
    if(!open) return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[open]);
  const url=`/api/voice-captures/${captureId}/comparison`;
  async function load(){setRuns((await request(url)).comparisons);}
  async function execute(){setBusy(true);setError("");try{setRuns((await request(url,{action:"compare",models:selected})).comparisons);}catch(e){setError(e instanceof Error?e.message:"Comparison failed.");try{await load();}catch{}}finally{setBusy(false);}}
  async function adopt(run:Comparison,model:string){setBusy(true);setError("");try{await onAdopt(url,{action:"adopt",comparison_id:run.id,model});await load();}catch(e){setError(e instanceof Error?e.message:"Could not select result.");}finally{setBusy(false);}}
  return <div className="voice-comparison"><button aria-expanded={open} disabled={busy} onClick={()=>{setOpen(!open);if(!open)void load().catch(e=>setError(e.message));}}>{tr("Compare models")}</button>
    {open&&<section aria-label={tr("Model comparison")}><h3>{tr("One transcript. Different interpretations.")}</h3><p>{tr("Each selected model gets the same transcript, task context and instructions. Comparing makes paid API calls. It does not change your board.")}</p>
      <div className="comparison-models">{comparisonModels.map(m=><label key={m.id}><input type="checkbox" checked={selected.includes(m.id)} disabled={busy} onChange={e=>setSelected(old=>e.target.checked?[...old,m.id]:old.filter(x=>x!==m.id))}/><strong>{tr(m.label)}</strong><small>{tr(m.id)}<br/>${tr(m.input)}{tr(" input / $")}{tr(m.output)}{tr(" output per 1M tokens")}</small></label>)}</div>
      <p className="voice-muted">{tr("USD · Standard API · rates checked September 8, 2026. Sol currently has promotional pricing. Reasoning: low for 5.6 / Astra; not applicable to 4.1. Estimates include reported cached input and reasoning output; your API bill is authoritative. ")}<a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">{tr("Official prices")}</a></p>
      <div className="voice-buttons"><button className="voice-primary" disabled={disabled||busy||selected.length<2||runs.some(r=>r.lease_until>now)} onClick={()=>void execute()}>{tr(busy?"Comparing…":"Run selected models")}</button><button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>{tr("Refresh saved results")}</button></div>
      {error&&<p role="alert" className="voice-warning">{tr(error)}</p>}
      <p className="voice-muted">{tr("Compare: plan vs actual · start/end and duration · correct task/book · progress vs completion. One run is a sample, not a reliable model ranking.")}</p>
      {runs.map(run=><section key={run.id} className="comparison-run"><h4>{tr(run.created_at)}{tr(" UTC")}{tr(run.adopted_model?` · Selected ${run.adopted_model}`:"")}</h4>
        {!run.results.length&&<p role="status">{tr(run.lease_until>now?"Models are running. Refresh to retrieve saved results.":"This run was interrupted before results were saved. You can start a new comparison.")}</p>}
        <div className="comparison-grid">{run.results.map(result=><article key={result.requested_model} className="comparison-result"><h4>{tr(comparisonModels.find(m=>m.id===result.requested_model)?.label||result.requested_model)}</h4><small>{tr(result.model||result.requested_model)}</small>
          {result.error?<p className="voice-warning">{tr(result.error)}</p>:<><p>{tr(((result.elapsed_ms||0)/1000).toFixed(1))}{tr(" s · ")}{tr(result.estimated_usd==null?"Cost unavailable":`≈ $${result.estimated_usd.toFixed(5)}`)}</p><p className="voice-muted">{tr(result.usage?`${result.usage.prompt_tokens.toLocaleString()} input · ${result.usage.completion_tokens.toLocaleString()} output tokens (${result.usage.completion_tokens_details?.reasoning_tokens||0} reasoning)` : "Token usage unavailable")}</p>
            <p>{tr(result.actions?.length||0)}{tr(" proposals · ")}{tr(result.actions?.filter(p=>p.needs_clarification).length||0)}{tr(" need clarification")}</p>
            {!result.actions?.length&&<p>{tr("No actionable changes found.")}</p>}
            {result.actions?.map((p,i)=><div className="comparison-proposal" key={i}><span className="voice-badge">{tr(p.type==="plan"?"Future plan":p.type==="record_activity"?"Actual activity":p.type)}</span><h5>{p.title||tr("Daily note")}</h5><p>{tr(p.date)} {tr(p.time||"Time unspecified")}{tr(p.end_time?`–${p.end_time}`:"")}</p><p>{tr(p.approximate?"About ":"")}{tr(p.duration_min?`${p.duration_min}${p.duration_max!==p.duration_min?`–${p.duration_max}`:""} minutes`:"Duration unspecified")}</p>{p.type==="record_activity"&&<p>{tr(completionLabels[p.completion||"ongoing"])} · {tr(p.target_id?"Matched existing task":"New task")}</p>}{p.notes&&<p>{p.notes}</p>}{p.evidence&&<blockquote className="voice-evidence">{p.evidence}</blockquote>}{p.reason&&<p className={p.needs_clarification?"voice-warning":"voice-muted"}>{p.reason}</p>}</div>)}
            <button disabled={disabled||busy||!canAdopt||Boolean(run.adopted_model)} onClick={()=>void adopt(run,result.requested_model)}>{tr("Use these proposals for review")}</button>
          </>}
        </article>)}</div>
      </section>)}
      {runs.length>0&&<p className="voice-muted">{tr("Selecting a result replaces pending proposals only. Review and approve individual changes below. Once any proposal is approved, selection is locked to prevent duplicate activity records.")}</p>}
    </section>}
  </div>;
}
