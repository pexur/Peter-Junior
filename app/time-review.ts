export type PlannedTime = { date: string; itemTitle: string; categoryName: string | null };
export type ActualSlot = { date: string; time: string; itemId: string | null; itemTitle: string; categoryName: string | null };
export type RecordedTime = { date: string; itemId?: string | null; title: string; categoryName: string | null; startTime: string; endTime: string; durationMin: number; durationMax: number };
export type LegacyTime = { date: string; itemTitle: string | null; categoryName: string | null };
export type CategoryNode = { id: string; parentId: string | null; title: string };

export type TimeAllocation = {
  category: string;
  plannedMinutes: number;
  actualMinMinutes: number;
  actualMaxMinutes: number;
};

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

export function weekRange(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  const start = addDays(date, -mondayOffset);
  return { start, end: addDays(start, 6) };
}

function sessionMinutes(session: RecordedTime) {
  let min = Math.max(0, Number(session.durationMin) || 0);
  let max = Math.max(min, Number(session.durationMax) || 0);
  if (!max && /^\d{2}:\d{2}$/.test(session.startTime) && /^\d{2}:\d{2}$/.test(session.endTime)) {
    const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    min = max = Math.max(0, clock(session.endTime) - clock(session.startTime));
  }
  // An activity without a usable duration still represents one legacy-sized block.
  if (!max) min = max = 15;
  return { min, max };
}

function categoryName(category: string | null) {
  return category?.trim() || "Uncategorized";
}

export function mainCategory(itemId: string | null, fallback: string | null, nodes: CategoryNode[]) {
  if (!itemId) return fallback;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(itemId);
  let highestParent: CategoryNode | undefined;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    highestParent = parent;
    current = parent;
  }
  return highestParent?.title.trim() || fallback;
}

function slotCoveredBySession(slot: ActualSlot, session: RecordedTime) {
  if (slot.date !== session.date || !session.startTime || !session.endTime) return false;
  const sameItem = slot.itemId && session.itemId
    ? slot.itemId === session.itemId
    : slot.itemTitle.trim().toLocaleLowerCase() === session.title.trim().toLocaleLowerCase();
  return Boolean(sameItem && slot.time >= session.startTime && slot.time < session.endTime);
}

export function summarizeTime(
  start: string,
  end: string,
  planned: PlannedTime[],
  recorded: RecordedTime[],
  actualSlots: ActualSlot[],
  legacy: LegacyTime[],
) {
  const totals = new Map<string, TimeAllocation>();
  const row = (category: string | null) => {
    const key = categoryName(category);
    const current = totals.get(key) ?? { category: key, plannedMinutes: 0, actualMinMinutes: 0, actualMaxMinutes: 0 };
    totals.set(key, current);
    return current;
  };
  const inside = (date: string) => date >= start && date <= end;

  planned.filter((entry) => inside(entry.date)).forEach((entry) => { row(entry.categoryName).plannedMinutes += 15; });

  const recordedHistoryMatches = new Map<string, number>();
  recorded.filter((entry) => inside(entry.date)).forEach((entry) => {
    const duration = sessionMinutes(entry);
    const total = row(entry.categoryName);
    total.actualMinMinutes += duration.min;
    total.actualMaxMinutes += duration.max;
    const match = `${entry.date}\u0000${entry.title.trim().toLocaleLowerCase()}`;
    recordedHistoryMatches.set(match, (recordedHistoryMatches.get(match) ?? 0) + 1);
  });

  const relevantSessions = recorded.filter((entry) => inside(entry.date));
  actualSlots.filter((entry) => inside(entry.date)).forEach((entry) => {
    // Voice activities also create timeline blocks. The session already carries
    // the authoritative duration, so those generated blocks must not add time.
    if (relevantSessions.some((session) => slotCoveredBySession(entry, session))) return;
    const total = row(entry.categoryName);
    total.actualMinMinutes += 15;
    total.actualMaxMinutes += 15;
  });

  legacy.filter((entry) => inside(entry.date)).forEach((entry) => {
    const match = `${entry.date}\u0000${(entry.itemTitle ?? "").trim().toLocaleLowerCase()}`;
    const duplicateCount = recordedHistoryMatches.get(match) ?? 0;
    if (duplicateCount) {
      recordedHistoryMatches.set(match, duplicateCount - 1);
      return;
    }
    const total = row(entry.categoryName);
    total.actualMinMinutes += 15;
    total.actualMaxMinutes += 15;
  });

  return [...totals.values()].sort((a, b) =>
    Math.max(b.plannedMinutes, b.actualMaxMinutes) - Math.max(a.plannedMinutes, a.actualMaxMinutes)
      || a.category.localeCompare(b.category),
  );
}

export function buildTimeReview(date: string, planned: PlannedTime[], recorded: RecordedTime[], actualSlots: ActualSlot[], legacy: LegacyTime[]) {
  const week = weekRange(date);
  return {
    day: summarizeTime(date, date, planned, recorded, actualSlots, legacy),
    week: summarizeTime(week.start, week.end, planned, recorded, actualSlots, legacy),
    weekStart: week.start,
    weekEnd: week.end,
  };
}
