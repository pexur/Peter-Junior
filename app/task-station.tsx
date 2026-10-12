"use client";
import { LanguageToggle, useI18n } from "./i18n/provider";


import { useEffect, useRef, useState } from "react";
import type { AppState, ListNode, Mutation } from "./list-state";
import { TimeEstimateEditor, formatEstimate } from "./time-estimate";
import styles from "./task-station.module.css";

export function taskContext(node: ListNode, nodes: ListNode[], display: (value: string, id: string) => string = value => value) {
  const parents: ListNode[] = []; const seen = new Set([node.id]); let id = node.parentId;
  while (id && !seen.has(id)) { seen.add(id); const parent = nodes.find(n => n.id === id); if (!parent) break; parents.unshift(parent); id = parent.parentId; }
  const root = parents[0]?.title.toLowerCase();
  const mode = node.mode || (/^(work|工作)$/.test(root || "") ? "work" : /^(relax|games|waste|放松|游戏|浪费时间)$/.test(root || "") ? "relax" : "");
  return { mode, categoryId: parents[0]?.id || null, path: parents.map(n => display(n.title, n.id)).join(" / ") || "Unsorted" };
}

export function TaskStation({ nodes, loading, pending, error, mutate, onExit }: {
  nodes: ListNode[]; loading: boolean; pending: number; error: string;
  mutate: (change: Mutation) => Promise<AppState>; onExit: () => void;
}) {
  const { tr, sample } = useI18n();
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { title: string; notes: string }>>({});
  const [query, setQuery] = useState("");
  const [exiting, setExiting] = useState(false);
  const [validationError, setValidationError] = useState("");
  const exitInFlight = useRef(false);
  const tasks = nodes.filter(n => n.kind === "item" && !n.isDraft && taskContext(n, nodes).mode === "work");
  const visible = tasks.filter(n => `${n.title} ${n.notes} ${sample(n.title, n.id)} ${sample(n.notes, n.id)} ${taskContext(n, nodes, sample).path}`.toLowerCase().includes(query.toLowerCase()));
  const busy = loading || Boolean(pending) || exiting;
  const dirty = tasks.filter(n => drafts[n.id] && (drafts[n.id].title !== n.title || drafts[n.id].notes !== n.notes));

  useEffect(() => {
    if (!checked.size && !dirty.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [checked.size, dirty.length]);

  async function save(node: ListNode) {
    const draft = drafts[node.id];
    if (!draft?.title.trim()) { setValidationError("Give the task a name before saving."); return false; }
    setValidationError("");
    try {
      await mutate({ action: "updateNode", id: node.id, title: draft.title.trim(), notes: draft.notes });
      setDrafts(current => { const next = { ...current }; delete next[node.id]; return next; });
      return true;
    } catch { return false; }
  }

  async function exit() {
    if (busy || exitInFlight.current) return;
    exitInFlight.current = true;
    setExiting(true);
    try {
      // Save detail edits before committing any of this session's checkmarks.
      for (const node of dirty) {
        if (!await save(node)) { setQuery(""); setEditing(node.id); return; }
      }
      for (const node of tasks.filter(n => checked.has(n.id))) {
        await mutate({ action: "doneNode", id: node.id });
        setChecked(current => { const next = new Set(current); next.delete(node.id); return next; });
      }
      onExit();
    } catch { /* Keep the session open so failed completions can be retried. */ }
    finally { exitInFlight.current = false; setExiting(false); }
  }

  return <section className={styles.station} aria-labelledby="station-heading">
    <header className={styles.header}><LanguageToggle />
      <div><p className={styles.eyebrow}>{tr("PERSONAL DAILY / WORKSTATION")}</p><h1 id="station-heading">{tr("Your tasks. Room to focus.")}</h1></div>
      <button disabled={busy} onClick={() => void exit()}>{tr(exiting ? "Saving and closing…" : "Turn off workstation")}</button>
    </header>
    <div className={styles.queueHeading}>
      <div><h2>{tr("Work tasks")}</h2><p>{tr(tasks.filter(n => checked.has(n.id)).length)}{tr(" of ")}{tr(tasks.length)}{tr(" checked off. Checked tasks stay here until you turn off workstation.")}</p></div>
      <input type="search" aria-label={tr("Search tasks")} placeholder={tr("Find a task…")} value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    <p className={styles.saveStatus} role="status">{tr(loading ? "Loading…" : pending || exiting ? "Saving…" : error ? "Not saved — try again" : checked.size ? "Checkmarks will be saved as completed when you turn off workstation." : "Details saved as you edit and save each task.")}</p>
    {(error || validationError) && <p className={styles.error} role="alert">{tr(validationError || error)}</p>}
    {loading ? <p className={styles.empty}>{tr("Loading your tasks…")}</p> : !visible.length ? <p className={styles.empty}>{query ? tr("No matching tasks. Try another search.") : tr("No work tasks yet. Turn off workstation to add tasks to your Work list.")}</p> :
      <div className={styles.tasks}>{visible.map(node => {
        const done = checked.has(node.id);
        const draft = drafts[node.id] || { title: node.title, notes: node.notes };
        return <article key={node.id} className={`${styles.task} ${done ? styles.completed : ""}`}>
          <input className={styles.check} type="checkbox" aria-label={tr(`Check off ${sample(node.title, node.id)}`)} checked={done} disabled={busy} onChange={() => setChecked(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} />
          <div className={styles.taskBody}>
            <p className={styles.path}>{node.parentId ? taskContext(node, nodes, sample).path : tr("Unsorted")}</p><h3>{sample(node.title, node.id)}</h3>
            {node.notes && <p className={styles.preview}>{sample(node.notes, node.id)}</p>}
            <div className={styles.metadata}>{node.estimatedMinutes && <span>{tr(formatEstimate(node.estimatedMinutes))}</span>}{done && <span>{tr("Checked off · uncheck to keep working")}</span>}</div>
          </div>
          <button aria-expanded={editing === node.id} onClick={() => setEditing(editing === node.id ? null : node.id)}>{tr("Edit task")}</button>
          {editing === node.id && <div className={styles.editor}>
            <form onSubmit={async e => { e.preventDefault(); if (await save(node)) setEditing(null); }}>
              <label>{tr("Task name")}<input required maxLength={200} value={sample(draft.title, node.id)} disabled={busy} onChange={e => setDrafts(current => ({ ...current, [node.id]: { ...draft, title: e.target.value } }))} /></label>
              <label>{tr("Details & notes")}<textarea maxLength={20000} rows={5} value={sample(draft.notes, node.id)} disabled={busy} placeholder={tr("Add steps, links, or more context…")} onChange={e => setDrafts(current => ({ ...current, [node.id]: { ...draft, notes: e.target.value } }))} /></label>
              <button disabled={busy || !draft.title.trim() || !drafts[node.id]}>{tr("Save changes")}</button>
              <button type="button" disabled={busy} onClick={() => { setDrafts(current => { const next = { ...current }; delete next[node.id]; return next; }); setEditing(null); }}>{tr("Cancel")}</button>
            </form>
            <TimeEstimateEditor node={node} busy={busy} onSave={async estimatedMinutes => { try { await mutate({ action: "tagNode", id: node.id, estimatedMinutes }); return true; } catch { return false; } }} />
          </div>}
        </article>;
      })}</div>}
  </section>;
}
