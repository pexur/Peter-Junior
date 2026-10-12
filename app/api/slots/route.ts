import { rangeTimes, type DaySlot } from "../../day-blocks";
import { getD1 } from "../../../db";
import { buildTimeReview, mainCategory, weekRange, type ActualSlot, type CategoryNode, type LegacyTime, type PlannedTime, type RecordedTime } from "../../time-review";

type SlotRow = {
  date: string;
  time: string;
  item_id: string | null;
  item_title: string;
  category_name: string | null;
  created_at: string;
};

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string) {
  if (!/^\d{2}:(00|15|30|45)$/.test(value)) return false;
  const [hour] = value.split(":").map(Number);
  return hour >= 5 && hour < 22;
}

function validTimezoneOffset(value: unknown) {
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= -840 && offset <= 840 ? offset : 0;
}

async function readSlots(date: string, timezoneOffset = 0) {
  const db = getD1();
  const week = weekRange(date);
  const localTimeModifier = `${timezoneOffset > 0 ? "-" : "+"}${Math.abs(timezoneOffset)} minutes`;
  const [slotResult, countResult, activityResult, reviewSlotResult, reviewActivityResult, legacyResult, nodeResult] = await Promise.all([
    db.prepare("SELECT date, time, item_id, item_title, category_name, created_at FROM daily_slots WHERE date = ? ORDER BY time").bind(date).all<SlotRow>(),
    db.prepare("SELECT date, COUNT(*) AS count FROM daily_slots GROUP BY date ORDER BY date DESC LIMIT 365").all<{ date: string; count: number }>(),
    db.prepare("SELECT * FROM activity_sessions WHERE date = ? ORDER BY start_time, created_at").bind(date).all(),
    db.prepare("SELECT date, time, item_id, item_title, category_name FROM daily_slots WHERE date BETWEEN ? AND ? ORDER BY date, time").bind(week.start, week.end).all<{ date: string; time: string; item_id: string | null; item_title: string; category_name: string | null }>(),
    db.prepare("SELECT s.date, s.item_id, s.title, s.start_time, s.end_time, s.duration_min, s.duration_max, parent.title AS category_name FROM activity_sessions s LEFT JOIN nodes item ON item.id = s.item_id LEFT JOIN nodes parent ON parent.id = item.parent_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.start_time, s.created_at").bind(week.start, week.end).all<{ date: string; item_id: string; title: string; start_time: string; end_time: string; duration_min: number; duration_max: number; category_name: string | null }>(),
    db.prepare("SELECT COALESCE(occurred_date, date(created_at, ?)) AS date, item_title, category_name FROM history WHERE action = 'item_did' AND COALESCE(occurred_date, date(created_at, ?)) BETWEEN ? AND ? ORDER BY id").bind(localTimeModifier, localTimeModifier, week.start, week.end).all<{ date: string; item_title: string | null; category_name: string | null }>(),
    db.prepare("SELECT id, parent_id, title, kind FROM nodes").all<{ id: string; parent_id: string | null; title: string; kind: string }>(),
  ]);
  const categoryNodes: CategoryNode[] = nodeResult.results.map((row) => ({ id: row.id, parentId: row.parent_id, title: row.title }));
  // The timeline is a completion log: dragging an item into a 15-minute block
  // records actual time. Expected targets will come from explicit planning data,
  // rather than reclassifying completed blocks as plans.
  const planned: PlannedTime[] = [];
  const actualSlots: ActualSlot[] = reviewSlotResult.results.map((row) => ({ date: row.date, time: row.time, itemId: row.item_id, itemTitle: row.item_title, categoryName: mainCategory(row.item_id, row.category_name, categoryNodes) }));
  const recorded: RecordedTime[] = reviewActivityResult.results.map((row) => ({ date: row.date, itemId: row.item_id, title: row.title, categoryName: mainCategory(row.item_id, row.category_name, categoryNodes), startTime: row.start_time, endTime: row.end_time, durationMin: Number(row.duration_min), durationMax: Number(row.duration_max) }));
  const itemIdsByTitle = new Map<string, string[]>();
  nodeResult.results.filter((node) => node.kind === "item").forEach((node) => {
    const key = node.title.trim().toLocaleLowerCase();
    itemIdsByTitle.set(key, [...(itemIdsByTitle.get(key) ?? []), node.id]);
  });
  const legacy: LegacyTime[] = legacyResult.results.map((row) => {
    const matches = itemIdsByTitle.get((row.item_title ?? "").trim().toLocaleLowerCase()) ?? [];
    return { date: row.date, itemTitle: row.item_title, categoryName: mainCategory(matches.length === 1 ? matches[0] : null, row.category_name, categoryNodes) };
  });
  return {
    activities: activityResult.results,
    slots: slotResult.results.map((slot) => ({ date: slot.date, time: slot.time, itemId: slot.item_id, itemTitle: slot.item_title, categoryName: slot.category_name, createdAt: slot.created_at })),
    counts: countResult.results.map((row) => ({ date: row.date, count: Number(row.count) })),
    timeReview: buildTimeReview(date, planned, recorded, actualSlots, legacy),
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? "";
    if (!validDate(date)) return Response.json({ error: "A valid date is required." }, { status: 400 });
    return Response.json(await readSlots(date, validTimezoneOffset(params.get("timezoneOffset"))));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the day schedule." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { action?: string; date?: string; time?: string; itemId?: string; timezoneOffset?: number; duration?: number; sourceTime?: string; sourceDuration?: number; expectedSlots?: string };
    const date = payload.date ?? "";
    const time = payload.time ?? "";
    if (!validDate(date) || !validTime(time)) return Response.json({ error: "A valid day and 15-minute time are required." }, { status: 400 });
    const db = getD1();

    if (["fillRange", "replaceRange", "clearRange"].includes(payload.action ?? "")) {
      const target = rangeTimes(time, payload.duration ?? 0);
      const source = payload.action === "fillRange" ? [] : rangeTimes(payload.sourceTime ?? "", payload.sourceDuration ?? 0);
      if (!target || !source || typeof payload.expectedSlots !== "string" || payload.expectedSlots.length > 100000) return Response.json({ error: "Choose a duration in 15-minute steps between 5 AM and 10 PM." }, { status: 400 });
      const current = await readSlots(date, validTimezoneOffset(payload.timezoneOffset));
      const sourceSlots = source.map(t => current.slots.find(s => s.time === t));
      if (source.length && (sourceSlots.some(s => !s) || sourceSlots.some(s => s!.itemId !== sourceSlots[0]!.itemId || s!.itemTitle !== sourceSlots[0]!.itemTitle))) return Response.json({ ...current, error: "This block changed. Check the refreshed timeline and try again." }, { status: 409 });
      let item: Pick<DaySlot, "itemId" | "itemTitle" | "categoryName"> | undefined = sourceSlots[0];
      if (payload.action === "fillRange") {
        const row = await db.prepare("SELECT id, parent_id, title FROM nodes WHERE id = ? AND kind = 'item' AND status = 'active' AND is_draft = 0").bind(payload.itemId ?? "").first<{ id: string; parent_id: string | null; title: string }>();
        if (!row) return Response.json({ error: "Choose an active item first." }, { status: 404 });
        const parent = row.parent_id ? await db.prepare("SELECT title FROM nodes WHERE id = ?").bind(row.parent_id).first<{ title: string }>() : null;
        item = { itemId: row.id, itemTitle: row.title, categoryName: parent?.title ?? null };
      }
      if (payload.action !== "clearRange" && target.some(t => current.slots.some(s => s.time === t) && !source.includes(t))) return Response.json({ ...current, error: "That block overlaps another activity. Choose a free time or a shorter duration." }, { status: 409 });
      // The first statement is an atomic compare-and-swap guard. A stale day
      // attempts a NOT NULL violation, rolling back the entire D1 batch. On a
      // matching snapshot it inserts nothing. Concurrent edits never overwrite.
      const statements = [db.prepare("INSERT INTO daily_slots (date, time, item_title) SELECT ?, '__snapshot_guard__', NULL WHERE (SELECT json_group_array(json_object('time', time, 'itemId', item_id, 'itemTitle', item_title, 'categoryName', category_name, 'createdAt', created_at)) FROM (SELECT * FROM daily_slots WHERE date = ? ORDER BY time)) <> ?").bind(date, date, payload.expectedSlots)];
      if (source.length) statements.push(db.prepare(`DELETE FROM daily_slots WHERE date = ? AND time IN (${source.map(() => "?").join(",")})`).bind(date, ...source));
      if (payload.action !== "clearRange") {
        const createdAt = sourceSlots[0]?.createdAt ?? new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const t of target) statements.push(db.prepare("INSERT INTO daily_slots (date, time, item_id, item_title, category_name, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(date, t, item!.itemId, item!.itemTitle, item!.categoryName, createdAt));
      }
      try { await db.batch(statements); }
      catch (error) {
        if (!/constraint|unique|not null/i.test(String(error))) throw error;
        return Response.json({ ...await readSlots(date, validTimezoneOffset(payload.timezoneOffset)), error: "The timeline changed. Your previous blocks are safe; check the refreshed day and try again." }, { status: 409 });
      }
      return Response.json(await readSlots(date, validTimezoneOffset(payload.timezoneOffset)));
    }

    if (payload.action === "clear") {
      await db.prepare("DELETE FROM daily_slots WHERE date = ? AND time = ?").bind(date, time).run();
      return Response.json(await readSlots(date, validTimezoneOffset(payload.timezoneOffset)));
    }

    if (payload.action !== "fill" || !payload.itemId) return Response.json({ error: "Choose an item to add to this time." }, { status: 400 });
    const item = await db.prepare("SELECT id, parent_id, title FROM nodes WHERE id = ? AND kind = 'item' AND status = 'active' AND is_draft = 0").bind(payload.itemId).first<{ id: string; parent_id: string | null; title: string }>();
    if (!item) return Response.json({ error: "That item is no longer available." }, { status: 404 });
    const parent = item.parent_id ? await db.prepare("SELECT title FROM nodes WHERE id = ?").bind(item.parent_id).first<{ title: string }>() : null;
    const result = await db.prepare("INSERT OR IGNORE INTO daily_slots (date, time, item_id, item_title, category_name) VALUES (?, ?, ?, ?, ?)").bind(date, time, item.id, item.title, parent?.title ?? null).run();
    if (!result.meta.changes) return Response.json({ error: "That time already has something in it." }, { status: 409 });
    return Response.json(await readSlots(date, validTimezoneOffset(payload.timezoneOffset)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the day schedule." }, { status: 500 });
  }
}
