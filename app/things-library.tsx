"use client";
import { useI18n } from "./i18n/provider";


import { useRef, useState } from "react";
import type { AppState, ListNode, Mutation } from "./list-state";
import { TimeEstimateEditor, formatEstimate } from "./time-estimate";
import { BOARD_CARD_MIME, LIST_ITEM_MIME } from "./planning-board";

const symbols: Record<string, string> = { workout: "↟", relax: "☀", study: "Aa", work: "▦", chores: "⌂" };
const sort = (nodes: ListNode[]) => [...nodes].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

export function ThingsLibrary({ nodes, loading, pending, error, mutate, onSchedule, armedCardId, onPromote, dailyView, workstationAction }: {
  dailyView: React.ReactNode;
  workstationAction?: React.ReactNode;
  nodes: ListNode[]; loading: boolean; pending: number; error: string;
  mutate: (change: Mutation) => Promise<AppState>;
  onSchedule: (node: ListNode) => void; armedCardId: string | null;
  onPromote: (id: string, parentId: string | null) => Promise<void>;
}) {
  const { tr, sample } = useI18n();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const sidecarRef = useRef<HTMLElement>(null);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  function revealPanel() {
    requestAnimationFrame(() => {
      const panel = sidecarRef.current;
      if (!panel) return;
      if (window.matchMedia("(max-width: 760px)").matches) panel.scrollIntoView({ block: "start", behavior: "instant" });
      (panel.querySelector<HTMLElement>(".thing-detail") || panel).focus({ preventScroll: true });
    });
  }
  function selectNode(id: string | null) {
    if (id) selectionTrigger.current = document.activeElement as HTMLElement | null;
    setSelectedId(id); setShowDetails(Boolean(id));
    if (id) revealPanel();
    else requestAnimationFrame(() => selectionTrigger.current?.focus());
  }
  const [drafts, setDrafts] = useState<Record<string, { title: string; notes: string }>>({});
  const [manage, setManage] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState("");
  const categories = sort(nodes.filter(n => !n.parentId && n.kind === "list"));
  const category = categories.find(n => n.id === categoryId);
  const selected = nodes.find(n => n.id === selectedId);
  const children = (parentId: string | null) => sort(nodes.filter(n => n.parentId === parentId));
  const descendants = (id: string): Set<string> => {
    const ids = new Set([id]);
    let size = 0;
    while (size !== ids.size) { size = ids.size; nodes.forEach(n => { if (n.parentId && ids.has(n.parentId)) ids.add(n.id); }); }
    return ids;
  };
  const count = (id: string) => { const ids = descendants(id); return nodes.filter(n => ids.has(n.id) && n.kind === "item" && !n.isDraft).length; };
  const path = (node: ListNode) => {
    const names: string[] = []; const seen = new Set<string>(); let id = node.parentId;
    while (id && !seen.has(id)) { seen.add(id); const parent = nodes.find(n => n.id === id); if (!parent) break; names.unshift(sample(parent.title, parent.id)); id = parent.parentId; }
    return names.join(" / ") || tr("Unsorted");
  };
  async function run(change: Mutation) {
    setLocalError("");
    try { await mutate(change); return true; } catch { return false; }
  }
  async function add(title: string, parentId: string | null, kind: "item" | "list", estimatedMinutes?: number) {
    const id = crypto.randomUUID();
    const ok = await run({ action: "createNode", id, parentId, title, kind, estimatedMinutes });
    if (ok && kind === "list") { selectNode(id); if (!parentId) setCategoryId(id); }
    return ok;
  }
  async function move(node: ListNode, parentId: string | null, afterId?: string) {
    if (parentId && descendants(node.id).has(parentId)) { setLocalError("A group cannot move inside itself."); return; }
    await run({ action: "moveNode", id: node.id, parentId, afterId });
  }
  function drop(event: React.DragEvent, parentId: string | null, afterId?: string) {
    event.preventDefault(); event.stopPropagation();
    const cardId = event.dataTransfer.getData(BOARD_CARD_MIME);
    if (cardId) { void onPromote(cardId, parentId); return; }
    const node = nodes.find(n => n.id === event.dataTransfer.getData(LIST_ITEM_MIME));
    if (node && node.id !== afterId) void move(node, parentId, afterId);
  }
  function dragOver(event: React.DragEvent) {
    if (event.dataTransfer.types.some(t => t === LIST_ITEM_MIME || t === BOARD_CARD_MIME)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; }
  }
  function itemRow(node: ListNode) {
    return <div key={node.id} className={`thing-row ${selectedId === node.id ? "is-selected" : ""}`} onDragOver={dragOver} onDrop={e => drop(e, node.parentId, node.id)}>
      <button className="thing-grip" draggable onDragStart={e => { setShowDetails(false); e.dataTransfer.setData(LIST_ITEM_MIME, node.id); e.dataTransfer.effectAllowed = "copyMove"; }} onClick={() => selectNode(node.id)} aria-label={tr(`Move ${sample(node.title, node.id) || tr("untitled item")}`)} title={tr("Drag after another item, or into a group")}>⠿</button>
      <button className="thing-check" disabled={Boolean(pending)} onClick={() => void run({ action: "doneNode", id: node.id })} aria-label={tr(`Complete ${sample(node.title, node.id)}`)}>✓</button>
      <button className="thing-select" onClick={() => selectNode(node.id)}><span>{sample(node.title, node.id) || tr("Untitled item")}</span>{node.estimatedMinutes && <small>{tr("Time needed: ")}{tr(formatEstimate(node.estimatedMinutes))}</small>}{node.notes && <small>{sample(node.notes, node.id)}</small>}</button>
      <span className="thing-arrow" aria-hidden="true">↗</span>
    </div>;
  }
  function group(node: ListNode, depth = 0): React.ReactNode {
    const members = children(node.id);
    return <section key={node.id} className={`thing-group ${depth ? "is-nested" : ""}`} onDragOver={dragOver} onDrop={e => drop(e, node.id)}>
      <div className="thing-group-heading"><button onClick={() => selectNode(node.id)}><span className="group-dot" />{sample(node.title, node.id) || tr("Untitled group")}<small>{tr(count(node.id))}</small></button><span>{tr(depth ? "Group" : "Category")}</span></div>
      {tr(members.filter(n => n.kind === "item").map(itemRow))}
      {tr(members.filter(n => n.kind === "list").map(n => group(n, depth + 1)))}
      <QuickAdd label={tr(`Add item to ${sample(node.title, node.id)}`)} placeholder={tr("+ Add an item…")} needsTime onAdd={(title, minutes) => add(title, node.id, "item", minutes)} />
      {armedCardId && <button className="library-text-button" onClick={() => void onPromote(armedCardId, node.id)}>{tr("+ Add selected idea here")}</button>}
    </section>;
  }
  const visibleRoots = category ? [category] : categoryId === "unsorted" ? [] : categories;
  const searchIds = category ? descendants(category.id) : null;
  const results = sort(nodes.filter(n => n.kind === "item" && (!searchIds || searchIds.has(n.id)) && (categoryId !== "unsorted" || !n.parentId) && `${n.title} ${n.notes} ${sample(n.title, n.id)} ${sample(n.notes, n.id)}`.toLowerCase().includes(query.toLowerCase())));
  const excluded = selected ? descendants(selected.id) : new Set<string>();
  return <>
    <div className="library-heading"><div><p className="eyebrow">{tr("A little structure. More possibility.")}</p><h1 id="list-heading">{tr("Your tasks")}<span>.</span></h1><p>{tr("Find your next task, in its own little place.")}</p></div><div className="library-category-actions">{tr(workstationAction)}<button className="library-manage add-category-button" onClick={() => { setManage(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[aria-label="${tr("New category")}"]`)?.focus()); }}>{tr("+ Add category")}</button><button className="library-manage" aria-pressed={manage} onClick={() => setManage(!manage)}>{tr(manage ? "Done organizing" : "Manage categories")}</button></div></div>
    <div className="category-tabs" aria-label={tr("Categories")}>
      <button aria-pressed={categoryId === null} className={categoryId === null ? "active" : ""} onClick={() => { setCategoryId(null); setQuery(""); }}><span className="category-symbol">✳</span><strong>{tr("All tasks")}</strong><small>{tr(nodes.filter(n => n.kind === "item").length)}</small></button>
      {categories.map((n, index) => <button key={n.id} aria-pressed={categoryId === n.id} className={categoryId === n.id ? "active" : ""} style={{ "--category-color": ["#e9b18e", "#b9b0dc", "#bdd39b", "#edce7e", "#a3c4d9", "#aabdb8", "#d7b7aa", "#c5c1b8"][index % 8] } as React.CSSProperties} onClick={() => { setCategoryId(n.id); setQuery(""); }} onDragOver={dragOver} onDrop={e => drop(e, n.id)}><span className="category-symbol">{symbols[n.title.toLowerCase()] || sample(n.title, n.id).slice(0, 2)}</span><strong>{sample(n.title, n.id)}</strong><small>{tr(count(n.id))}</small></button>)}
      <button aria-pressed={categoryId === "unsorted"} className={categoryId === "unsorted" ? "active" : ""} onClick={() => { setCategoryId("unsorted"); setQuery(""); }}><span className="category-symbol">↳</span><strong>{tr("Unsorted")}</strong><small>{tr(children(null).filter(n => n.kind === "item").length)}</small></button>
    </div>
    {manage && <section className="category-management" aria-label={tr("Manage categories")}>
      <div className="category-management-heading"><div><h2>{tr("Your categories")}</h2><p>{tr("Deleting a category keeps its items and groups in Unsorted. Nothing inside is deleted.")}</p></div><QuickAdd label="New category" placeholder={tr("Name a new category…")} onAdd={title => add(title, null, "list")} /></div>
      {categories.map(n => <div className="managed-category" key={n.id}>
        <strong>{sample(n.title, n.id)}</strong><span>{tr(count(n.id))}{tr(" tasks")}</span>
        <button onClick={() => selectNode(n.id)}>{tr("Edit")}</button>
        <button className="category-delete" onClick={() => { setDeletingId(n.id); setDeleteName(""); }}>{tr("Delete…")}</button>
        {deletingId === n.id && <form className="category-delete-confirm" onSubmit={async e => { e.preventDefault(); if ((deleteName !== n.title && deleteName !== sample(n.title, n.id))) return; if (await run({ action: "removeCategory", id: n.id, confirmTitle: n.title })) { setDeletingId(null); if (selectedId === n.id) selectNode(null); if (categoryId === n.id) setCategoryId(null); } }}><label htmlFor="delete-category-name">{tr("Type “")}{sample(n.title, n.id)}{tr("” to delete the category and keep its contents.")}</label><input id="delete-category-name" autoFocus value={deleteName} onChange={e => setDeleteName(e.target.value)} /><button disabled={Boolean(pending) || (deleteName !== n.title && deleteName !== sample(n.title, n.id))}>{tr("Delete category, keep contents")}</button><button type="button" onClick={() => setDeletingId(null)}>{tr("Cancel")}</button></form>}
      </div>)}
    </section>}

    <p className="library-status" role="status">{tr(loading ? "Loading your tasks…" : error ? "Changes need attention" : pending ? "Saving…" : "All changes saved")}</p>
    {(error || localError) && <p className="error-banner" role="alert">{tr(error || localError)}</p>}
    {!loading && <div className="library-layout"><div className="library-content">
      <div className="library-toolbar"><h2>{(category ? sample(category.title, category.id) : "") || (categoryId === "unsorted" ? tr("Unsorted") : tr("All tasks"))}</h2><button className="timeline-jump" onClick={() => { setShowDetails(false); revealPanel(); }}>{tr("Daily timeline")}</button><input type="search" aria-label={tr("Search tasks")} placeholder={tr("Find a task…")} value={query} onChange={e => setQuery(e.target.value)} /></div>
      {query ? <div className="thing-group">{results.length ? results.map(itemRow) : <p className="library-empty">{tr("Nothing matches “")}{query}”.</p>}</div> : <>
        {visibleRoots.map(root => <div className="category-section" key={root.id}>

          {tr(group(root))}
        </div>)}
        {(!category && (categoryId === "unsorted" || children(null).some(n => n.kind === "item"))) && <section className="thing-group" onDragOver={dragOver} onDrop={e => drop(e, null)}><h3>{tr("Unsorted")}</h3>{tr(children(null).filter(n => n.kind === "item").map(itemRow))}<QuickAdd label="Add unsorted item" placeholder={tr("+ Add an item…")} needsTime onAdd={(title, minutes) => add(title, null, "item", minutes)} /></section>}
        {!categories.length && categoryId !== "unsorted" && <p className="library-empty">{tr("Create your first category with Manage categories.")}</p>}
      </>}
      <p className="library-hint">{tr("Open an item to edit, move, or schedule it. You can also drag its grip to reorder.")}</p>
    </div><aside ref={sidecarRef} tabIndex={-1} className="library-sidecar" aria-label={tr("Daily timeline and item details")}>
      <div className="sidecar-tabs" role="group" aria-label={tr("Workspace panel")}><button aria-pressed={!(showDetails && selected)} onClick={() => setShowDetails(false)}>{tr("Daily timeline")}</button><button aria-pressed={Boolean(showDetails && selected)} disabled={!selected} onClick={() => { setShowDetails(true); revealPanel(); }}>{tr("Item details")}</button></div>
      {showDetails && selected ? <div className="thing-detail" role="region" tabIndex={-1} aria-label={tr("Selected item details")}> <DetailCard onEstimate={estimatedMinutes => run({action:"tagNode", id:selected.id, estimatedMinutes})} key={selected.id} draft={drafts[selected.id]} onDraft={(title, notes) => setDrafts(current => ({ ...current, [selected.id]: { title, notes } }))} node={selected} path={path(selected)} nodes={nodes} destinations={nodes.filter(n => n.kind === "list" && !excluded.has(n.id))} busy={Boolean(pending)} onSave={(title, notes) => run({ action: "updateNode", id: selected.id, title, notes })} onMove={parentId => move(selected, parentId)} onEarlier={async () => { const siblings = children(selected.parentId); const previous = siblings[siblings.findIndex(n => n.id === selected.id) - 1]; if (previous) await move(previous, selected.parentId, selected.id); }} onReorder={afterId => move(selected, selected.parentId, afterId)} onClose={() => selectNode(null)} onSchedule={() => { onSchedule(selected); setSelectedId(null); setShowDetails(false); revealPanel(); }} onAddGroup={title => add(title, selected.id, "list")} onRemove={async confirmTitle => { if (await run({ action: selected.kind === "list" ? "removeCategory" : "removeNode", id: selected.id, confirmTitle })) selectNode(null); }} /></div> : dailyView}
    </aside></div>}
  </>;
}

function QuickAdd({ label, placeholder, onAdd, needsTime = false }: { needsTime?: boolean; label: string; placeholder: string; onAdd: (title: string, minutes?: number) => Promise<boolean> }) {
  const { tr } = useI18n();
  const [minutes, setMinutes] = useState("");
  const [title, setTitle] = useState(""); const [busy, setBusy] = useState(false);
  return <form className={`thing-add ${needsTime ? "thing-add-item" : ""}`} aria-label={tr(label)} onSubmit={async e => { e.preventDefault(); if (!title.trim() || busy) return; setBusy(true); if (await onAdd(title.trim(), needsTime ? Number(minutes) : undefined)) { setTitle(""); setMinutes(""); } setBusy(false); }}><label className="thing-name-input">{needsTime && <span>{tr("Item name")}</span>}<input aria-label={tr(label)} placeholder={tr(placeholder)} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={busy} /></label>{needsTime && <label className="thing-time-input">{tr("Time needed (minutes)")}<input aria-label={tr(`Time needed for ${label}`)} type="number" required min="1" max="525600" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)} placeholder={tr("e.g. 45")} disabled={busy}/></label>}<button disabled={!title.trim() || busy} type="submit">{tr(busy ? "Adding…" : needsTime ? "Add item" : "Add")}</button></form>;
}

function DetailCard({ onEstimate, draft, onDraft, node, path, nodes, destinations, busy, onSave, onMove, onReorder, onEarlier, onClose, onSchedule, onAddGroup, onRemove }: {
  onEstimate: (minutes: number) => Promise<boolean>;
  draft?: { title: string; notes: string }; onDraft: (title: string, notes: string) => void;
  node: ListNode; path: string; nodes: ListNode[]; destinations: ListNode[]; busy: boolean;
  onSave: (title: string, notes: string) => Promise<boolean>; onMove: (parentId: string | null) => Promise<void>; onReorder: (afterId: string) => Promise<void>;
  onEarlier: () => Promise<void>; onClose: () => void; onSchedule: () => void; onAddGroup: (title: string) => Promise<boolean>; onRemove: (confirmTitle?: string) => Promise<void>;
}) {
  const { tr, sample } = useI18n();
  const [title, setTitle] = useState(draft?.title ?? node.title); const [notes, setNotes] = useState(draft?.notes ?? node.notes);
  const [confirm, setConfirm] = useState(false); const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const isGroup = node.kind === "list";
  const siblings = sort(nodes.filter(n => n.parentId === node.parentId && n.id !== node.id));
  const changed = title !== node.title || notes !== node.notes;
  return <>
    <div className="detail-top"><span>{tr(isGroup ? "Category / group" : "Your next thing")}</span><button aria-label={tr("Close details")} onClick={onClose}>×</button></div>
    <p className="detail-path">{path}</p>
    <form onSubmit={async e => { e.preventDefault(); setSaved(await onSave(title.trim(), notes)); }}>
      <label htmlFor="thing-title">{tr("Name")}</label><input id="thing-title" value={sample(title, node.id)} onChange={e => { setTitle(e.target.value); onDraft(e.target.value, notes); setSaved(false); }} maxLength={200} />
      <label htmlFor="thing-notes">{tr("Notes & links")}</label><textarea id="thing-notes" value={sample(notes, node.id)} onChange={e => { setNotes(e.target.value); onDraft(title, e.target.value); setSaved(false); }} placeholder={tr("A plan, a link, a little context…")} maxLength={20000} />
      {changed && <p className="detail-unsaved">{tr("Unsaved changes · click Save changes below.")}</p>}<button className="detail-save" disabled={busy || !title.trim() || (!changed && !node.isDraft)}>{tr(saved && !changed ? "Saved" : "Save changes")}</button>
    </form>
    {!isGroup && <TimeEstimateEditor node={node} busy={busy} onSave={onEstimate} />}
    <label htmlFor="thing-destination">{tr("Move to")}</label><select id="thing-destination" value={node.parentId || ""} disabled={busy} onChange={e => void onMove(e.target.value || null)}><option value="">{tr(isGroup ? "Top-level category" : "Unsorted")}</option>{destinations.map(n => <option key={n.id} value={n.id}>{n.parentId ? `${sample(nodes.find(p => p.id === n.parentId)?.title || tr("Group"), n.parentId)} / ` : ""}{sample(n.title, n.id)}</option>)}</select>
    {siblings.length > 0 && <><button className="library-text-button" disabled={busy || sort(nodes.filter(n => n.parentId === node.parentId))[0]?.id === node.id} onClick={() => void onEarlier()}>{tr("↑ Move up")}</button><label htmlFor="thing-order">{tr("Reorder")}</label><select id="thing-order" value="" disabled={busy} onChange={e => { if (e.target.value) void onReorder(e.target.value); }}><option value="">{tr("Place after…")}</option>{siblings.map(n => <option key={n.id} value={n.id}>{sample(n.title, n.id) || tr("Untitled item")}</option>)}</select></>}
    {isGroup ? <div className="detail-subgroup"><label>{tr("Add a subcategory")}</label><QuickAdd label={tr(`New subcategory in ${sample(node.title, node.id)}`)} placeholder={tr("Name a group…")} onAdd={onAddGroup} /></div> : <button className="detail-schedule" onClick={onSchedule}>{tr("↗ Select for daily schedule")}</button>}
    <details className="detail-danger" open={isGroup}><summary>{tr(isGroup ? "Delete category" : "More options")}</summary>{confirm ? <div><p>{tr(isGroup ? `Type “${sample(node.title, node.id)}” to delete this category. Its contents will move to ${node.parentId ? tr("the parent group") : tr("Unsorted")}.` : `Remove “${sample(node.title, node.id) || tr("Untitled item")}”?`)}</p>{isGroup && <input aria-label={tr("Confirm category name")} value={confirmation} onChange={e => setConfirmation(e.target.value)} />}<button disabled={busy || (isGroup && (confirmation !== node.title && confirmation !== sample(node.title, node.id)))} onClick={() => void onRemove(isGroup ? node.title : undefined)}>{tr("Confirm deletion")}</button><button onClick={() => setConfirm(false)}>{tr("Cancel")}</button></div> : <button onClick={() => setConfirm(true)}>{tr("Delete ")}{tr(isGroup ? "category (keep contents)" : "item")}…</button>}</details>
  </>;
}
