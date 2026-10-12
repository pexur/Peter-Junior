"use client";
import { useI18n } from "./i18n/provider";

import { useState } from "react";
import type { ListNode } from "./list-state";

export function formatEstimate(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest} min`;
}
export function isWorkCategory(id: string | null, nodes: ListNode[]) {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) return false;
    if (node.mode === "work" || /^(work|工作)$/i.test(node.title.trim())) return true;
    id = node.parentId;
  }
  return false;
}
export function TimeEstimateEditor({node, busy, onSave}: {node: ListNode; busy: boolean; onSave: (minutes: number) => Promise<boolean>}) {
  const { tr, sample } = useI18n();
  const [minutes, setMinutes] = useState(String(node.estimatedMinutes ?? ""));
  return <form className="time-estimate-editor" onSubmit={async e => {e.preventDefault(); await onSave(Number(minutes));}}>
    <label>{tr("Time needed (minutes)")}<input aria-label={tr(`Time needed for ${sample(node.title, node.id)}`)} type="number" min="1" max="525600" step="1" required value={minutes} onChange={e=>setMinutes(e.target.value)} disabled={busy}/></label>
    <button disabled={busy || !minutes || Number(minutes) === node.estimatedMinutes}>{tr("Save time")}</button>
  </form>;
}
