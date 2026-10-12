import { parseProposal, validDate, validTime, activitySlots, clockMinutes } from "./voice-types";
// Each approval is one D1 transaction. Its unique token gates every write, so
// repeated approvals and concurrent requests cannot apply the same action twice.
export async function approve(db: D1Database, actionId: string, user: string, edited: unknown, expected: string) {
  const p = parseProposal(edited);
  if(p.needs_clarification) throw new Error("Resolve the highlighted ambiguity and confirm the proposal first.");
  const token=crypto.randomUUID();
  const conditions:string[]=[]; const values:unknown[]=[];
  const requireCondition=(sql:string, ...args:unknown[])=>{conditions.push(sql);values.push(...args);};
  const gate="EXISTS (SELECT 1 FROM voice_actions WHERE id = ? AND applied_token = ? AND status = 'applying')";
  const ops:D1PreparedStatement[]=[];
  const write=(sql:string,...args:unknown[])=>ops.push(db.prepare(sql).bind(...args,actionId,token));
  const date=(v:string)=>{if(!validDate(v)) throw new Error("Choose a valid date.");};
  const time=(v:string)=>{if(!validTime(v)) throw new Error("Choose a 15-minute time from 05:00 to 21:45.");};
  type Node={id:string;title:string;notes:string;parent_id:string|null;kind:string;did_at:string|null};
  let node:Node|null=null;
  if(["complete_task","did_task","task_note","schedule","move_schedule","cancel_schedule"].includes(p.type)){
    node=await db.prepare("SELECT id,title,notes,parent_id,kind,did_at FROM nodes WHERE id = ? AND status = 'active' AND is_draft = 0 AND kind = 'item'").bind(p.target_id).first<Node>();
    if(!node) throw new Error("Choose an active task.");
    if(p.title !== node.title) throw new Error("The task title changed or was not identified exactly. Edit and reselect the task before approving.");
    requireCondition("EXISTS (SELECT 1 FROM nodes WHERE id = ? AND title = ? AND notes = ? AND parent_id IS ? AND kind = 'item' AND status = 'active' AND is_draft = 0 AND did_at IS ?)",node.id,node.title,node.notes,node.parent_id,node.did_at);
    requireCondition("NOT EXISTS (SELECT 1 FROM nodes WHERE parent_id = ? AND status = 'active')",node.id);
  }
  const parent = node?.parent_id ? await db.prepare("SELECT title FROM nodes WHERE id = ?").bind(node.parent_id).first<{title:string}>():null;
  const activity=(kind:string,title:string,category:string|null)=>write(`INSERT INTO history (action,item_title,category_name) SELECT ?,?,? WHERE ${gate}`,kind,title,category);
  switch(p.type){
    case "record_activity": {
      date(p.date); if(!p.title) throw new Error("Give the activity a name.");
      const times=activitySlots(p);
      let target = p.target_id ? await db.prepare("SELECT id,title,status,kind,is_draft,parent_id FROM nodes WHERE id = ? AND status IN ('active','done')").bind(p.target_id).first<{id:string;title:string;status:string;kind:string;is_draft:number;parent_id:string|null}>() : null;
      if(p.target_id && (!target || target.kind!=="item" || target.is_draft)) throw new Error("The task changed. Reselect the correct task, or create a new activity.");
      if(target && target.title!==p.title) throw new Error(`The proposal “${p.title}” links to “${target.title}”. Use the existing task button or reselect the task in Edit, then confirm the ambiguity.`);
      if(!p.target_id) {
        // Multiple sessions for a task newly named in the same recording share a
        // single item, even when the finishing session is approved first.
        target=await db.prepare("SELECT n.id,n.title,n.status,n.kind,n.is_draft,n.parent_id FROM nodes n JOIN activity_sessions s ON s.item_id = n.id JOIN voice_actions a ON a.id = s.action_id WHERE a.capture_id = (SELECT capture_id FROM voice_actions WHERE id = ?) AND s.title = ? AND n.status IN ('active','done') LIMIT 1").bind(actionId,p.title).first();
      }
      const categoryId=target?.parent_id || p.destination_id;
      if(!categoryId) throw new Error("Choose a category for this task before approving.");
      const category=await db.prepare("SELECT title FROM nodes WHERE id = ? AND kind = 'list' AND status = 'active' AND is_draft = 0").bind(categoryId).first<{title:string}>();
      if(!category) throw new Error("Choose an active category for this task before approving.");
      requireCondition("EXISTS (SELECT 1 FROM nodes WHERE id = ? AND title = ? AND kind = 'list' AND status = 'active' AND is_draft = 0)",categoryId,category.title);
      const itemId=target?.id || crypto.randomUUID();
      if(target) {
        requireCondition("EXISTS (SELECT 1 FROM nodes WHERE id = ? AND title = ? AND status IN ('active','done') AND kind = 'item' AND is_draft = 0)",itemId,p.title);
        requireCondition("NOT EXISTS (SELECT 1 FROM nodes WHERE parent_id = ? AND status = 'active')",itemId);
        requireCondition("EXISTS (SELECT 1 FROM nodes WHERE id = ? AND parent_id IS ?)",itemId,target.parent_id);
        if(!target.parent_id) write(`UPDATE nodes SET parent_id = ?, position = (SELECT COALESCE(MAX(position),0)+1 FROM nodes WHERE parent_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,categoryId,categoryId,itemId);
      } else {
        // A concurrent approval for another new session must be reviewed again
        // rather than creating a second task with the same name.
        requireCondition("NOT EXISTS (SELECT 1 FROM activity_sessions s JOIN voice_actions a ON a.id = s.action_id WHERE a.capture_id = (SELECT capture_id FROM voice_actions WHERE id = ?) AND s.title = ?)",actionId,p.title);
        write(`INSERT INTO nodes (id,parent_id,title,notes,status,kind,is_draft,position) SELECT ?,?,?,?,? ,'item',0,(SELECT COALESCE(MAX(position),0)+1 FROM nodes WHERE parent_id = ?) WHERE ${gate}`,itemId,categoryId,p.title,p.notes,p.completion==="completed"?"done":"active",categoryId);
      }
      for(const t of times) requireCondition("NOT EXISTS (SELECT 1 FROM daily_slots WHERE date = ? AND time = ? AND (item_id IS NULL OR item_id <> ?))",p.date,t,itemId);
      // Unanchored/approximate ranges still get a durable daily record without
      // inventing times or occupying a whole uncertain window.
      let min=p.duration_min||0, max=p.duration_max||0;
      if(p.time && p.end_time && !min && !max) min=max=clockMinutes(p.end_time)-clockMinutes(p.time);
      write(`INSERT INTO activity_sessions (id,action_id,item_id,title,date,start_time,end_time,duration_min,duration_max,approximate,completion,notes,evidence) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,crypto.randomUUID(),actionId,itemId,p.title,p.date,p.time,p.end_time||"",min,max,Number(p.approximate),p.completion,p.notes,p.evidence||"");
      for(const t of times) write(`INSERT OR IGNORE INTO daily_slots (date,time,item_id,item_title,category_name) SELECT ?,?,?,?,? WHERE ${gate}`,p.date,t,itemId,p.title,category.title);
      if(p.completion==="completed") write(`UPDATE nodes SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,itemId);
      write(`INSERT INTO history (action,item_title,category_name,occurred_date,occurred_time) SELECT ?,?,?,?,? WHERE ${gate}`,p.completion==="completed"?"item_done":"item_did",p.title,category.title,p.date,p.end_time||p.time||null);
      break;
    }
    case "plan": {
      if(!p.title) throw new Error("Give the future plan a name.");
      if(p.date)date(p.date); if(p.time)clockMinutes(p.time); if(p.end_time)clockMinutes(p.end_time);
      const column=p.destination_id || "voice-plans-inbox";
      if(p.destination_id)requireCondition("EXISTS (SELECT 1 FROM planning_columns WHERE id = ? AND status = 'active')",column);
      else {
        requireCondition("NOT EXISTS (SELECT 1 FROM planning_columns WHERE id = ? AND status <> 'active')",column);
        write(`INSERT OR IGNORE INTO planning_columns (id,title,position) SELECT ?,'Plans inbox',(SELECT COALESCE(MAX(position),0)+1 FROM planning_columns) WHERE ${gate}`,column);
      }
      const timing=[p.date,[p.time,p.end_time].filter(Boolean).join("–"),p.duration_min?`${p.approximate?"About ":""}${p.duration_min}${p.duration_max!==p.duration_min?`–${p.duration_max}`:""} min`:""].filter(Boolean).join(" · ");
      const notes=[timing,p.notes].filter(Boolean).join("\n");
      if(notes.length>4000)throw new Error("Plan notes are too long.");
      write(`INSERT INTO planning_cards (id,column_id,title,notes,position) SELECT ?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM planning_cards WHERE column_id = ? AND status = 'active') WHERE ${gate}`,crypto.randomUUID(),column,p.title,notes,column);
      break;
    }

    case "create_task": {
      if(!p.title) throw new Error("Enter a task title.");
      if(!p.destination_id) throw new Error("Choose a category for this task before approving.");
      requireCondition("EXISTS (SELECT 1 FROM nodes WHERE id = ? AND kind = 'list' AND status = 'active' AND is_draft = 0)",p.destination_id);
      write(`INSERT INTO nodes (id,parent_id,title,notes,kind,position,is_draft) SELECT ?,?,?,?,'item',(SELECT COALESCE(MAX(position),0)+1 FROM nodes WHERE parent_id IS ? AND status = 'active'),0 WHERE ${gate}`,crypto.randomUUID(),p.destination_id||null,p.title,p.notes,p.destination_id||null);
      const category=await db.prepare("SELECT title FROM nodes WHERE id = ?").bind(p.destination_id).first<{title:string}>();
      activity("item_added",p.title,category?.title||null); break;
    }
    case "complete_task":
      write(`UPDATE nodes SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,p.target_id); activity("item_done",node!.title,parent?.title||null); break;
    case "did_task":
      write(`UPDATE nodes SET did_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,p.target_id); activity("item_did",node!.title,parent?.title||null); break;
    case "task_note":
      if(!p.notes) throw new Error("Enter a note.");
      if(node!.notes.length+p.notes.length+2>4000) throw new Error("The combined task note exceeds 4,000 characters. Shorten this note.");
      write(`UPDATE nodes SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,p.notes,p.notes,p.target_id); break;
    case "schedule": case "move_schedule": case "cancel_schedule": {
      if(p.type !== "cancel_schedule") {
        date(p.date);time(p.time);
        requireCondition("NOT EXISTS (SELECT 1 FROM daily_slots WHERE date = ? AND time = ?)",p.date,p.time);
      }
      if(p.type !== "schedule") {
        date(p.from_date);time(p.from_time);
        requireCondition("EXISTS (SELECT 1 FROM daily_slots WHERE date = ? AND time = ? AND item_id = ?)",p.from_date,p.from_time,p.target_id);
        write(`DELETE FROM daily_slots WHERE date = ? AND time = ? AND item_id = ? AND ${gate}`,p.from_date,p.from_time,p.target_id);
      }
      if(p.type !== "cancel_schedule") write(`INSERT INTO daily_slots (date,time,item_id,item_title,category_name) SELECT ?,?,?,?,? WHERE ${gate}`,p.date,p.time,p.target_id,node!.title,parent?.title||null);
      break;
    }
    case "create_idea": case "move_idea": {
      if(!p.destination_id) throw new Error("Choose a planning area.");
      requireCondition("EXISTS (SELECT 1 FROM planning_columns WHERE id = ? AND status = 'active')",p.destination_id);
      if(p.type === "create_idea") {
        if(!p.title) throw new Error("Enter an idea title.");
        write(`INSERT INTO planning_cards (id,column_id,title,notes,position) SELECT ?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM planning_cards WHERE column_id = ? AND status = 'active') WHERE ${gate}`,crypto.randomUUID(),p.destination_id,p.title,p.notes,p.destination_id);
      } else {
        requireCondition("EXISTS (SELECT 1 FROM planning_cards WHERE id = ? AND title = ? AND status = 'active')",p.target_id,p.title);
        write(`UPDATE planning_cards SET column_id = ?, position = (SELECT COALESCE(MAX(position),0)+1 FROM planning_cards WHERE column_id = ? AND status = 'active'), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ${gate}`,p.destination_id,p.destination_id,p.target_id);
      } break;
    }
    case "review_note": {
      date(p.date); if(!p.notes) throw new Error("Enter a review note.");
      requireCondition("COALESCE((SELECT length(notes) FROM daily_reviews WHERE date = ?),0) + ? <= 4000",p.date,p.notes.length+2);
      write(`INSERT INTO daily_reviews (date,notes) SELECT ?,? WHERE ${gate} ON CONFLICT(date) DO UPDATE SET notes = CASE WHEN daily_reviews.notes = '' THEN excluded.notes ELSE daily_reviews.notes || char(10) || excluded.notes END, updated_at = CURRENT_TIMESTAMP`,p.date,p.notes); break;
    }
  }
  const claim=db.prepare(`UPDATE voice_actions SET status = 'applying', applied_token = ?, proposal = ? WHERE id = ? AND proposal = ? AND status = 'pending' AND capture_id IN (SELECT id FROM voice_captures WHERE owner_id = ? AND lease_until < ?) ${conditions.map(x=>`AND (${x})`).join(" ")}`).bind(token,JSON.stringify(p),actionId,expected,user,Date.now(),...values);
  const results=await db.batch([claim,...ops,db.prepare("UPDATE voice_actions SET status = 'approved' WHERE id = ? AND applied_token = ? AND status = 'applying'").bind(actionId,token)]);
  if(!results[0].meta.changes) throw new Error("This proposal or its destination changed. Refresh and review again; occupied times are never overwritten.");
}
