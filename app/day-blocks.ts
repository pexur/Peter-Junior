export type DaySlot = { date: string; time: string; itemId: string | null; itemTitle: string; categoryName: string | null; createdAt: string };
export type DayBlock = { start: string; duration: number; slots: DaySlot[]; itemId: string | null; title: string; category: string | null };
export type BlockChange = { action: "fillRange" | "replaceRange" | "clearRange"; time: string; duration: number; itemId?: string; sourceTime?: string; sourceDuration?: number };
export const DAY_START = 5 * 60;
export const DAY_END = 22 * 60;
export const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
export const clockTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const dayTimes = Array.from({ length: (DAY_END - DAY_START) / 15 }, (_, index) => clockTime(DAY_START + index * 15));
export function rangeTimes(start: string, duration: number): string[] | null {
  if (!/^\d{2}:(00|15|30|45)$/.test(start) || !Number.isInteger(duration) || duration < 15 || duration % 15 || minutesOf(start) < DAY_START || minutesOf(start) + duration > DAY_END) return null;
  return Array.from({ length: duration / 15 }, (_, i) => clockTime(minutesOf(start) + i * 15));
}
export function groupDaySlots(slots: DaySlot[]): DayBlock[] {
  const blocks: DayBlock[] = [];
  for (const slot of [...slots].sort((a, b) => a.time.localeCompare(b.time))) {
    const last = blocks.at(-1);
    if (last && minutesOf(last.start) + last.duration === minutesOf(slot.time) && last.itemId === slot.itemId && last.title === slot.itemTitle && last.category === slot.categoryName) {
      last.duration += 15; last.slots.push(slot);
    } else blocks.push({ start: slot.time, duration: 15, itemId: slot.itemId, title: slot.itemTitle, category: slot.categoryName, slots: [slot] });
  }
  return blocks;
}
export function slotsSnapshot(slots: DaySlot[]) {
  return JSON.stringify([...slots].sort((a, b) => a.time.localeCompare(b.time)).map(s => ({ time: s.time, itemId: s.itemId, itemTitle: s.itemTitle, categoryName: s.categoryName, createdAt: s.createdAt })));
}
