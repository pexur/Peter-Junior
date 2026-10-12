"use client";
import { useI18n } from "./i18n/provider";


import { useRef, useState } from "react";

export const BOARD_CARD_MIME = "application/x-next-up-planning-card";
export const LIST_ITEM_MIME = "application/x-next-up-list-item";

export type PlanningColumn = { id: string; title: string; position: number; createdAt: string };
export type PlanningCard = { id: string; columnId: string; title: string; notes: string; subTag?: string; position: number; createdAt: string };
export type BoardState = { columns: PlanningColumn[]; cards: PlanningCard[]; error?: string };
export type BoardAction = { action: string; id?: string; cardId?: string; columnId?: string; targetColumnId?: string; title?: string; notes?: string; subTag?: string; direction?: "up" | "down" };
type Draft = { title: string; notes: string; columnId: string; subTag: string };
const emptyDraft: Draft = { title: "", notes: "", columnId: "", subTag: "" };
const workTags = ["project beacon", "project atlas", "project willow", "team"];

type Props = {
  board: BoardState; collapsed: boolean; status: string; armedCardId: string | null;
  onCollapsedChange: (collapsed: boolean) => void;
  onAction: (payload: BoardAction) => Promise<boolean>;
  onArmCard: (card: PlanningCard | null) => void;
};

export function PlanningBoard({ board, collapsed, status, armedCardId, onCollapsedChange, onAction, onArmCard }: Props) {
  const { tr, sample } = useI18n();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft);
  const [mainFilter, setMainFilter] = useState("");
  const [subFilter, setSubFilter] = useState("*");
  const [newTag, setNewTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const pendingSaves = useRef(new Set<string>());
  const createRequest = useRef<{ id: string; signature: string } | null>(null);
  const tagRequest = useRef<{ id: string; title: string } | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  const defaultColumn = columns[0]?.id ?? "";
  const mainCards = board.cards.filter(card => !mainFilter || card.columnId === mainFilter);
  const visibleCards = mainCards.filter(card => subFilter === "*" || (card.subTag ?? "") === subFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.position - a.position || a.id.localeCompare(b.id));
  const suggestions = (columnId: string) => [...new Set([
    ...(columns.find(column => column.id === columnId)?.title.toLowerCase() === "work" ? workTags : []),
    ...board.cards.filter(card => card.columnId === columnId).map(card => card.subTag ?? "").filter(Boolean),
  ])].sort();
  const displayTag = (tag: string) => workTags.includes(tag) ? tr(tag) : sample(tag, board.cards.find(card => card.subTag === tag)?.id);
  const filterTags = [...new Set([...columns.filter(column => !mainFilter || column.id === mainFilter).flatMap(column => suggestions(column.id))])].sort();

  async function saveOnce(key: string, save: () => Promise<void>) {
    if (pendingSaves.current.has(key)) return;
    pendingSaves.current.add(key); setSavingKeys(new Set(pendingSaves.current));
    try { await save(); } finally { pendingSaves.current.delete(key); setSavingKeys(new Set(pendingSaves.current)); }
  }
  async function addCard() {
    if (!draft.title.trim()) return;
    await saveOnce("new", async () => {
      const payload = { ...draft, columnId: draft.columnId || defaultColumn };
      const signature = JSON.stringify(payload);
      if (createRequest.current?.signature !== signature) createRequest.current = { id: crypto.randomUUID(), signature };
      if (await onAction({ action: "createCard", ...payload, id: createRequest.current.id })) {
        setDraft({ ...payload, title: "", notes: "" }); createRequest.current = null;
        setMainFilter(""); setSubFilter("*");
      }
    });
  }
  async function addTag() {
    const title = newTag.trim();
    if (!title) return;
    await saveOnce("tag", async () => {
      const existing = columns.find(column => column.title.toLowerCase() === title.toLowerCase());
      if (existing) { setDraft(current => ({ ...current, columnId: existing.id, subTag: "" })); setAddingTag(false); setNewTag(""); return; }
      if (tagRequest.current?.title !== title) tagRequest.current = { id: crypto.randomUUID(), title };
      if (await onAction({ action: "createColumn", ...tagRequest.current })) {
        const columnId = tagRequest.current.id;
        setDraft(current => ({ ...current, columnId, subTag: "" }));
        setNewTag(""); setAddingTag(false); tagRequest.current = null;
      }
    });
  }
  function tagFields(value: Draft, change: (next: Draft) => void, prefix: string) {
    const columnId = value.columnId || defaultColumn;
    return <div className="idea-tag-fields">
      <label>{tr("Main tag")}<select aria-label={tr(`${tr(prefix)} main tag`)} value={columnId} onChange={event => change({ ...value, columnId: event.target.value, subTag: "" })}>{columns.map(column => <option key={column.id} value={column.id}>{sample(column.title, column.id)}</option>)}</select></label>
      <label>{tr("Sub-tag ")}<span>{tr("optional")}</span><input aria-label={tr(`${tr(prefix)} sub-tag`)} list={`${prefix}-sub-tags`} value={displayTag(value.subTag)} onChange={event => change({ ...value, subTag: event.target.value })} maxLength={60} placeholder={tr("General")} /><datalist id={`${prefix}-sub-tags`}>{suggestions(columnId).map(tag => <option key={tag} value={displayTag(tag)} />)}</datalist></label>
    </div>;
  }

  return <section className={`planning-board ${collapsed ? "is-collapsed" : ""}`} aria-labelledby="planning-heading">
    <div className="planning-heading">
      <div><p className="eyebrow">{tr("Before it becomes a task")}</p><h1 id="planning-heading">{tr("Planning board")}</h1></div>
      <div className="planning-heading-actions"><span>{tr(board.cards.length)} {tr(board.cards.length === 1 ? "idea" : "ideas")}</span><button type="button" onClick={() => onCollapsedChange(!collapsed)} aria-expanded={!collapsed}>{tr(collapsed ? "Open board" : "Collapse")}</button></div>
    </div>
    <p className="board-status" role="status" aria-live="polite">{tr(status)}</p>
    {!collapsed && <>
      <p className="planning-intro">{tr("A little room for every idea. Tag it now, move it to Tasks when you’re ready.")}</p>
      <fieldset className="new-card-form idea-composer" disabled={savingKeys.has("new")} aria-busy={savingKeys.has("new")}>
        <div className="idea-composer-copy"><input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent?.isComposing) { event.preventDefault(); void addCard(); } }} placeholder={tr("What’s on your mind?")} maxLength={200} aria-label={tr("New idea title")} />
        <textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder={tr("Optional notes, links, or a first step…")} maxLength={20000} aria-label={tr("New idea notes")} /></div>
        <div className="idea-composer-meta">{tr(tagFields(draft, setDraft, "new"))}<button type="button" disabled={savingKeys.has("new") || !draft.title.trim() || !defaultColumn} onClick={() => void addCard()}>{tr(savingKeys.has("new") ? "Saving…" : "Add idea")}</button></div>
      </fieldset>
      <div className="idea-filters" aria-label={tr("Filter ideas")}>
        <div className="main-tag-filters"><button type="button" aria-pressed={!mainFilter} onClick={() => { setMainFilter(""); setSubFilter("*"); }}>{tr("All ideas ")}<span>{tr(board.cards.length)}</span></button>
          {columns.map(column => <button type="button" key={column.id} aria-pressed={mainFilter === column.id} onClick={() => { setMainFilter(column.id); setSubFilter("*"); }}>{sample(column.title, column.id)} <span>{tr(board.cards.filter(card => card.columnId === column.id).length)}</span></button>)}
          <button type="button" onClick={() => setAddingTag(!addingTag)} aria-expanded={addingTag}>{tr("+ Main tag")}</button>
        </div>
        {addingTag && <fieldset className="add-tag-form" disabled={savingKeys.has("tag")}><input autoFocus aria-label={tr("New main tag")} placeholder={tr("Name a main tag…")} maxLength={60} value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} /><button type="button" disabled={!newTag.trim()} onClick={() => void addTag()}>{tr("Add tag")}</button><button type="button" onClick={() => setAddingTag(false)}>{tr("Cancel")}</button></fieldset>}
        <div className="idea-filter-detail"><label>{tr("Sub-tag ")}<select aria-label={tr("Filter by sub-tag")} value={subFilter} onChange={event => setSubFilter(event.target.value)}><option value="*">{tr("All sub-tags")}</option><option value="">{tr("General (no sub-tag)")}</option>{filterTags.map(tag => <option key={tag} value={tag}>{displayTag(tag)}</option>)}</select></label><span role="status">{tr(`${visibleCards.length} pending ${visibleCards.length === 1 ? "idea" : "ideas"}`)}</span>{(mainFilter || subFilter !== "*") && <button type="button" onClick={() => { setMainFilter(""); setSubFilter("*"); }}>{tr("Clear filters")}</button>}</div>
      </div>
      <div className="idea-grid">
        {visibleCards.map(card => editingCardId === card.id ? <fieldset className="board-card is-editing" key={card.id} disabled={savingKeys.has(`edit:${card.id}`)}>
          <input aria-label={tr("Idea title")} autoFocus maxLength={200} value={sample(edit.title, editingCardId)} onChange={event => setEdit({ ...edit, title: event.target.value })} />
          <textarea aria-label={tr("Idea notes")} maxLength={20000} value={sample(edit.notes, editingCardId)} onChange={event => setEdit({ ...edit, notes: event.target.value })} />
          {tr(tagFields(edit, setEdit, "edit"))}
          <div className="card-edit-actions"><button type="button" onClick={() => setEditingCardId(null)}>{tr("Cancel")}</button><button type="button" disabled={!edit.title.trim()} onClick={() => void saveOnce(`edit:${card.id}`, async () => { if (await onAction({ action: "updateCard", cardId: card.id, ...edit })) setEditingCardId(null); })}>{tr(savingKeys.has(`edit:${card.id}`) ? "Saving…" : "Save")}</button></div>
        </fieldset> : <article className={`board-card ${!card.subTag?.trim() ? "is-uncategorized" : ""} ${armedCardId === card.id ? "is-armed" : ""}`} key={card.id} draggable onDragStart={event => { event.dataTransfer.setData(BOARD_CARD_MIME, card.id); event.dataTransfer.effectAllowed = "move"; onArmCard(card); }}>
          <div className="idea-tags"><span>{sample(columns.find(column => column.id === card.columnId)?.title ?? tr("General"), card.columnId)}</span>{card.subTag?.trim() ? <span>{sample(card.subTag, card.id)}</span> : <span className="uncategorized-tag">{tr("Uncategorized")}</span>}</div>
          <div className="board-card-title"><span aria-hidden="true">⠿</span><strong>{sample(card.title, card.id)}</strong></div>
          {card.notes && <p>{sample(card.notes, card.id)}</p>}
          <div className="board-card-actions"><button type="button" onClick={() => { setEdit({ title: card.title, notes: card.notes, columnId: card.columnId, subTag: card.subTag ?? "" }); setEditingCardId(card.id); }}>{tr("Edit")}</button><button type="button" className="promote-button" onClick={() => { onArmCard(armedCardId === card.id ? null : card); document.getElementById("tasks")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{tr(armedCardId === card.id ? "Selected" : "Move to Tasks")}</button><button type="button" aria-label={tr(`Remove ${sample(card.title, card.id)}`)} onClick={() => { if (window.confirm(tr(`Remove “${sample(card.title, card.id)}” from the board?`))) void onAction({ action: "removeCard", cardId: card.id }); }}>×</button></div>
        </article>)}
      </div>
      {!visibleCards.length && <div className="idea-empty">{tr(board.cards.length ? "No ideas match these tags. Try another filter or capture a new idea above." : "Your next idea starts here. Add a thought above and give it a tag.")}</div>}
    </>}
  </section>;
}
