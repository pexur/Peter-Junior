"use client";
import { useI18n } from "./i18n/provider";


import { useEffect, useRef, useState } from "react";
import type { ListNode } from "./list-state";
import { LIST_ITEM_MIME } from "./planning-board";
import { clockTime, dayTimes, DAY_START, DAY_END, groupDaySlots, minutesOf, type BlockChange, type DayBlock, type DaySlot } from "./day-blocks";

const ROW = 28;
const durationLabel = (value: number) => value < 60 ? `${value} min` : `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}m` : ""}`;
type Gesture = { block: DayBlock; mode: "move" | "resize"; y: number; scroll: number; start: number; duration: number; changed: boolean };

export function DailyTimeline({ slots, date, today, nodes, armedId, busy, loading, status, onChange, onDate, onArm }: {
  slots: DaySlot[]; date: string; today: string; nodes: ListNode[]; armedId: string | null; busy: boolean; loading: boolean; status: string;
  onChange: (change: BlockChange) => Promise<boolean>; onDate: (date: string) => void; onArm: (id: string | null) => void;
}) {
  const { tr, sample } = useI18n();
  const blocks = groupDaySlots(slots);
  const [duration, setDuration] = useState(30);
  const [startTime, setStartTime] = useState("09:00");
  const [editing, setEditing] = useState<string | null>(null);
  const [dropTime, setDropTime] = useState<string | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = nodes.filter(n => n.kind === "item" && !n.isDraft);
  const selectedBlock = blocks.find(b => b.start === editing);
  const disabled = busy || loading;
  useEffect(() => {
    if (loading) return;
    const first = groupDaySlots(slots)[0];
    const hour = date === today ? Math.max(5, Math.min(20, new Date().getHours() - 1)) : first ? Math.max(5, Math.floor(minutesOf(first.start) / 60) - 1) : 8;
    if (scrollRef.current) scrollRef.current.scrollTop = (hour * 60 - DAY_START) / 15 * ROW;
    // Position once when this day finishes loading, not after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loading, today]);
  function begin(event: React.PointerEvent<HTMLDivElement>, block: DayBlock, mode: Gesture["mode"]) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { block, mode, y: event.clientY, scroll: scrollRef.current?.scrollTop ?? 0, start: minutesOf(block.start), duration: block.duration, changed: false };
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current; const container = scrollRef.current;
    if (!current || !container) return;
    const rect = container.getBoundingClientRect();
    if (event.clientY < rect.top + 40) container.scrollTop -= ROW / 2;
    if (event.clientY > rect.bottom - 40) container.scrollTop += ROW / 2;
    const delta = Math.round((event.clientY - current.y + container.scrollTop - current.scroll) / ROW) * 15;
    current.start = current.mode === "move" ? Math.max(DAY_START, Math.min(DAY_END - current.block.duration, minutesOf(current.block.start) + delta)) : minutesOf(current.block.start);
    current.duration = current.mode === "resize" ? Math.max(15, Math.min(DAY_END - current.start, current.block.duration + delta)) : current.block.duration;
    current.changed ||= Math.abs(event.clientY - current.y) > 5;
    setPreview({ ...current });
  }
  function end(event: React.PointerEvent<HTMLDivElement>) {
    const current = gesture.current; if (!current) return;
    gesture.current = null; setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.changed) { setEditing(current.block.start); return; }
    if (current.start !== minutesOf(current.block.start) || current.duration !== current.block.duration) void onChange({ action: "replaceRange", time: clockTime(current.start), duration: current.duration, sourceTime: current.block.start, sourceDuration: current.block.duration });
  }
  function cancel() { gesture.current = null; setPreview(null); }
  async function add(time: string, itemId = armedId) {
    if (!itemId || disabled) return;
    if (await onChange({ action: "fillRange", time, duration, itemId })) setEditing(null);
  }
  function changeDay(offset: number) {
    const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + offset);
    onDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`);
  }
  return <section className="daily-planner" aria-label={tr("Daily timeline")} aria-busy={disabled}>
    <div className="planner-heading"><div><p className="eyebrow">{tr("Make room for your tasks")}</p><h2>{tr("Daily view")}</h2></div><span>{tr(durationLabel(slots.length * 15))}</span></div>
    <div className="planner-day"><button disabled={disabled || Boolean(preview)} onClick={() => changeDay(-1)} aria-label={tr("Previous timeline day")}>←</button><input type="date" aria-label={tr("Timeline date")} value={date} disabled={disabled || Boolean(preview)} onChange={e => { if (e.target.value) onDate(e.target.value); }} /><button disabled={disabled || Boolean(preview)} onClick={() => changeDay(1)} aria-label={tr("Next timeline day")}>→</button><button disabled={disabled} onClick={() => onDate(today)}>{tr("Today")}</button></div>
    <p className="planner-help">{tr("Drop a thing, drag to move, pull the bottom edge to resize. Time is recorded in 15-minute steps.")}</p>
    <form className="planner-add" onSubmit={e => { e.preventDefault(); void add(startTime); }}>
      <select aria-label={tr("Activity to schedule")} value={armedId || ""} disabled={disabled} onChange={e => onArm(e.target.value || null)}><option value="">{tr("Choose a thing, or drag one here…")}</option>{items.map(n => <option key={n.id} value={n.id}>{sample(n.title, n.id)}</option>)}</select>
      <div><label>{tr("Start")}<select aria-label={tr("New block start")} value={startTime} onChange={e => setStartTime(e.target.value)}>{dayTimes.map(t => <option key={t}>{tr(t)}</option>)}</select></label><label>{tr("Duration")}<select aria-label={tr("New block duration")} value={duration} onChange={e => setDuration(Number(e.target.value))}>{[15,30,45,60,90,120,180,240].map(n => <option key={n} value={n}>{tr(durationLabel(n))}</option>)}</select></label><button type="submit" disabled={disabled || !armedId}>{tr("+ Add block")}</button></div>
    </form>
    {selectedBlock && <BlockEditor key={`${date}-${selectedBlock.start}-${selectedBlock.duration}`} block={selectedBlock} busy={disabled} onClose={() => setEditing(null)} onChange={async change => { const ok = await onChange(change); if (ok) setEditing(null); return ok; }} />}
    <p className="planner-status" role="status">{tr(loading ? "Loading this day…" : status || (armedId ? "Click an empty time to place the selected thing." : "Adjacent entries for the same activity join into one block."))}</p>
    <div className="planner-scroll" ref={scrollRef} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTime(null); }}>
      <div className="planner-grid" style={{ height: dayTimes.length * ROW }}>
        {dayTimes.map(t => <button key={t} className={`planner-slot ${t.endsWith(":00") ? "is-hour" : ""} ${dropTime === t ? "is-drop-target" : ""}`} style={{ top: (minutesOf(t) - DAY_START) / 15 * ROW, height: ROW }} disabled={disabled} aria-label={tr(`Add selected activity at ${t}`)} onClick={() => { setStartTime(t); void add(t); }} onDragOver={e => { if (!disabled && e.dataTransfer.types.includes(LIST_ITEM_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropTime(t); const box=scrollRef.current?.getBoundingClientRect(); if (box && scrollRef.current) { if(e.clientY > box.bottom-40) scrollRef.current.scrollTop+=ROW/2; if(e.clientY < box.top+40) scrollRef.current.scrollTop-=ROW/2; } } }} onDrop={e => { e.preventDefault(); setDropTime(null); void add(t, e.dataTransfer.getData(LIST_ITEM_MIME)); }}><time>{tr(t.endsWith(":00") ? t : `:${t.slice(3)}`)}</time><span>{tr(dropTime === t ? `+ ${durationLabel(duration)}` : "")}</span></button>)}
        {blocks.map(block => <div key={block.start} className={`planner-block ${editing === block.start ? "is-editing" : ""} ${preview?.block.start === block.start ? "is-moving" : ""}`} style={{ top: (minutesOf(block.start) - DAY_START) / 15 * ROW + 1, height: block.duration / 15 * ROW - 2 }} tabIndex={disabled ? -1 : 0} role="button" aria-label={tr(`${sample(block.title, block.itemId)}, ${block.start} to ${clockTime(minutesOf(block.start) + block.duration)}, ${durationLabel(block.duration)}. Open to edit time.`)} onKeyDown={e => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(block.start); } }} onPointerDown={e => begin(e, block, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
          <strong>{sample(block.title, block.itemId)}</strong>{block.duration > 15 && <small>{tr(block.start)}–{tr(clockTime(minutesOf(block.start) + block.duration))} · {tr(durationLabel(block.duration))}</small>}{block.duration >= 45 && <span>{block.category}</span>}
          <div className="block-resize" role="slider" tabIndex={disabled ? -1 : 0} aria-label={tr(`Duration of ${sample(block.title, block.itemId)}`)} aria-valuemin={15} aria-valuemax={DAY_END-minutesOf(block.start)} aria-valuenow={block.duration} aria-valuetext={tr(durationLabel(block.duration))} onPointerDown={e => begin(e, block, "resize")} onKeyDown={e => { e.stopPropagation(); if (!disabled && ["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); const next=block.duration+(e.key==="ArrowDown"?15:-15); if(next>=15 && minutesOf(block.start)+next<=DAY_END) void onChange({action:"replaceRange",time:block.start,duration:next,sourceTime:block.start,sourceDuration:block.duration}); } }}>═</div>
        </div>)}
        {preview && <div className="block-preview" style={{ top: (preview.start-DAY_START)/15*ROW, height:preview.duration/15*ROW }}><strong>{tr(clockTime(preview.start))}–{tr(clockTime(preview.start+preview.duration))}</strong><span>{tr(durationLabel(preview.duration))}</span></div>}
      </div>
    </div>
    <p className="planner-footnote">{tr("5 AM–10 PM · Click a block for exact times. Existing activities are never overwritten.")}</p>
  </section>;
}

function BlockEditor({ block, busy, onClose, onChange }: { block: DayBlock; busy: boolean; onClose: () => void; onChange: (change: BlockChange) => Promise<boolean> }) {
  const { tr, sample } = useI18n();
  const [time, setTime] = useState(block.start); const [duration, setDuration] = useState(block.duration); const [removing, setRemoving] = useState(false);
  return <form className="block-editor" onSubmit={e => { e.preventDefault(); void onChange({ action: "replaceRange", time, duration, sourceTime: block.start, sourceDuration: block.duration }); }}><div><strong>{sample(block.title, block.itemId)}</strong><button type="button" aria-label={tr("Close time editor")} onClick={onClose}>×</button></div><div><label>{tr("Start")}<select aria-label={tr("Block start time")} value={time} onChange={e => setTime(e.target.value)}>{dayTimes.map(t => <option key={t}>{tr(t)}</option>)}</select></label><label>{tr("Minutes")}<input aria-label={tr("Block duration in minutes")} type="number" min={15} max={DAY_END-minutesOf(time)} step={15} value={duration} onChange={e => setDuration(Number(e.target.value))} /></label><button disabled={busy} type="submit">{tr("Save")}</button></div><button type="button" className="block-remove" disabled={busy} onClick={() => { if (!removing) setRemoving(true); else void onChange({action:"clearRange",time:block.start,duration:block.duration,sourceTime:block.start,sourceDuration:block.duration}); }}>{tr(removing ? "Confirm remove entire block" : "Remove block…")}</button>{removing && <button type="button" onClick={() => setRemoving(false)}>{tr("Cancel")}</button>}</form>;
}
