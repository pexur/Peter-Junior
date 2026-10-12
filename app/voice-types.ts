export const actionTypes = ["record_activity", "plan", "create_task", "complete_task", "did_task", "task_note", "schedule", "move_schedule", "cancel_schedule", "create_idea", "move_idea", "review_note"] as const;
export type ActionType = typeof actionTypes[number];
export type Proposal = { type: ActionType; end_time?: string; duration_min?: number; duration_max?: number; approximate?: boolean; completion?: "ongoing" | "session_done" | "completed"; evidence?: string; target_id: string; destination_id: string; title: string; notes: string; date: string; time: string; from_date: string; from_time: string; reason: string; needs_clarification: boolean };
export type VoiceAction = { id: string; capture_id: string; proposal: Proposal; status: string };
export type Capture = { id: string; filename: string; status: string; transcript: string; error: string; retryable: number; created_at: string; local_date: string; timezone: string; lease_until: number; processing?: boolean; interpretation_model?: string; interpretation_version?: number };
export const actionLabels: Record<ActionType, string> = { record_activity: "Record what I did", plan: "Add a future plan", create_task: "Add a task", complete_task: "Complete a task", did_task: "Record doing a task", task_note: "Add a task note", schedule: "Schedule a task", move_schedule: "Reschedule a task", cancel_schedule: "Clear a scheduled time", create_idea: "Add a planning idea", move_idea: "Move a planning idea", review_note: "Add a daily review note" };
export function validDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v; }
export function validTime(v: string) { return /^(0[5-9]|1\d|2[01]):(00|15|30|45)$/.test(v); }
export function parseProposal(value: unknown): Proposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid proposal.");
  const p = value as Record<string, unknown>;
  if (!actionTypes.includes(p.type as ActionType) || typeof p.needs_clarification !== "boolean") throw new Error("Invalid action type.");
  const result = { type: p.type, needs_clarification: p.needs_clarification } as Proposal;
  for (const key of ["target_id", "destination_id", "title", "notes", "date", "time", "from_date", "from_time", "reason"] as const) {
    if (typeof p[key] !== "string" || p[key].length > (key === "notes" || key === "reason" ? 4000 : 100)) throw new Error(`Invalid ${key}.`);
    result[key] = p[key].trim();
  }
  if (p.type === "record_activity" || p.type === "plan") {
    for (const key of ["end_time", "evidence"] as const) {
      if(typeof p[key] !== "string" || p[key].length > (key === "evidence" ? 4000 : 5)) throw new Error(`Invalid ${key}.`);
      result[key] = p[key].trim();
    }
    for (const key of ["duration_min", "duration_max"] as const) {
      if(!Number.isInteger(p[key]) || Number(p[key]) < 0 || Number(p[key]) > 1440) throw new Error(`Invalid ${key}.`);
      result[key] = Number(p[key]);
    }
    if(typeof p.approximate !== "boolean" || !["ongoing","session_done","completed"].includes(String(p.completion))) throw new Error("Choose a completion state.");
    result.approximate=p.approximate; result.completion=p.completion as Proposal["completion"];
    if(result.duration_max! < result.duration_min!) throw new Error("Duration range is reversed.");
  }
  return result;
}

export type ActivitySession = { id:string; item_id:string; title:string; date:string; start_time:string; end_time:string; duration_min:number; duration_max:number; approximate:number; completion:string; notes:string; evidence:string };
export const completionLabels = { ongoing:"Made progress · keep task open", session_done:"Done for today · keep task open", completed:"Fully completed · close task" };
export function clockMinutes(value:string) {
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== "24:00") throw new Error("Enter a valid time.");
  const [h,m]=value.split(":").map(Number);return h*60+m;
}
export function activitySlots(p:Proposal) {
  if(p.time) clockMinutes(p.time); if(p.end_time) clockMinutes(p.end_time);
  if(p.end_time && !p.time) throw new Error("An end time needs a start time.");
  if(p.time && p.end_time && clockMinutes(p.end_time)<=clockMinutes(p.time)) throw new Error("End time must follow start time. Split overnight activities by day.");
  if(!p.time || !p.end_time || p.duration_min !== p.duration_max) return [];
  const span=clockMinutes(p.end_time)-clockMinutes(p.time);
  if(p.duration_min && p.duration_min!==span) return []; // duration within a wider uncertain window
  const slots:string[]=[];
  // Only completely covered 15-minute cells; never inflate partial-cell activity.
  for(let m=Math.max(300,Math.ceil(clockMinutes(p.time)/15)*15);m+15<=Math.min(1320,clockMinutes(p.end_time));m+=15)slots.push(`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`);
  return slots;
}

export const comparisonModels = [
  {id:"gpt-4.1",label:"GPT-4.1",input:2,cached:0.5,output:8},
  {id:"gpt-5.6-terra",label:"GPT-5.6 Terra",input:2,cached:0.2,output:12},
  {id:"gpt-5.6-sol",label:"GPT-5.6 Sol",input:4,cached:0.4,output:20},
  {id:"gpt-6-astra",label:"GPT-6 Astra",input:10,cached:1,output:50},
] as const;
export type ComparisonResult = {requested_model:string;model?:string;actions?:Proposal[];error?:string;elapsed_ms?:number;estimated_usd?:number|null;usage?:{prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens?:number};completion_tokens_details?:{reasoning_tokens?:number}}|null};
export type Comparison = {id:string;created_at:string;lease_until:number;adopted_model:string;results:ComparisonResult[]};

// An explicit task selection preserves the diary wording as activity notes.
export function selectProposalTask(p: Proposal, id: string, title: string): Proposal {
  const preserve=p.type === "record_activity" && id && p.title && p.title !== title && !p.notes.includes(p.title);
  const notes=preserve ? [p.title,p.notes].filter(Boolean).join("\n") : p.notes;
  if(notes.length>4000) throw new Error("Shorten the activity notes before changing the task.");
  return {...p,target_id:id,title:id?title:p.title,notes};
}

// Category selection cannot be bypassed by dismissing other ambiguities.
export function needsTaskCategory(p: Proposal, nodes: {id:string;kind:string;parent_id?:string|null}[]) {
  return p.type === "create_task" || (p.type === "record_activity" && !nodes.some(n=>n.id===p.target_id && n.kind==="item" && n.parent_id));
}
