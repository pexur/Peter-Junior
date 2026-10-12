import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyMutation } from "../app/list-state.ts";

const item = {
  id: "85eab1cd-2772-430c-9685-0b55b065857b",
  parentId: null,
  title: "Last item",
  kind: "item",
  position: 1,
  isDraft: false,
  notes: "",
  didAt: null,
  createdAt: "2026-08-28T00:00:00.000Z",
};

test("did it keeps the item active and marks it", () => {
  const next = applyMutation({ nodes: [item], history: [], reviews: [] }, { action: "didNode", id: item.id });

  assert.equal(next.nodes.length, 1);
  assert.equal(next.nodes[0].id, item.id);
  assert.ok(next.nodes[0].didAt);
});

test("complete keeps its existing removal behavior", () => {
  const next = applyMutation({ nodes: [item], history: [], reviews: [] }, { action: "doneNode", id: item.id });

  assert.deepEqual(next.nodes, []);
});

test("daily reviews and removable activity events use durable storage", async () => {
  const [route, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /payload\.action === "saveReview"/);
  assert.match(route, /ON CONFLICT\(date\) DO UPDATE/);
  assert.match(route, /payload\.action === "removeHistory"/);
  assert.match(route, /DELETE FROM history WHERE id = \?/);
  assert.match(schema, /sqliteTable\("daily_reviews"/);
  assert.match(migration, /CREATE TABLE `daily_reviews`/);
});

test("the durable did-it state is wired through the database and activity record", async () => {
  const [route, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /UPDATE nodes SET focused = 0, did_at = CURRENT_TIMESTAMP/);
  assert.match(route, /VALUES \('item_did', \?, \?\)/);
  assert.match(schema, /didAt: text\("did_at"\)/);
  assert.match(migration, /`did_at` text/);
});

test("the daily timeline is durable and replaces the did-it control", async () => {
  const [page, route, schema, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/slots/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /DailyTimeline/);
  assert.match(page, /Thoughts for the day[\s\S]*What I did/);
  assert.match(await readFile(new URL("../app/day-blocks.ts", import.meta.url), "utf8"), /dayTimes = Array\.from/);
  assert.match(await readFile(new URL("../app/things-library.tsx", import.meta.url), "utf8"), /draggable/);
  assert.doesNotMatch(page, /className="did-button"/);
  assert.match(route, /INSERT OR IGNORE INTO daily_slots/);
  assert.match(route, /DELETE FROM daily_slots/);
  assert.match(schema, /sqliteTable\("daily_slots"/);
  assert.match(migration, /CREATE TABLE `daily_slots`/);
});

test("planning notes follow an idea into the active item model", () => {
  const next = applyMutation({ nodes: [item], history: [], reviews: [] }, { action: "updateNode", id: item.id, title: item.title, notes: "Read chapter one first" });
  assert.equal(next.nodes[0].notes, "Read chapter one first");
});

test("the planning board is durable and promotion is an atomic move", async () => {
  const [page, component, route, schema, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/planning-board.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/board/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_initial.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PlanningBoard/);
  assert.match(component, /Planning board/);
  assert.match(component, /Move to Tasks/);
  assert.match(component, /application\/x-next-up-planning-card/);
  assert.match(await readFile(new URL("../app/daily-timeline.tsx", import.meta.url), "utf8"), /LIST_ITEM_MIME/);
  assert.match(await readFile(new URL("../app/things-library.tsx", import.meta.url), "utf8"), /BOARD_CARD_MIME/);
  assert.match(route, /UPDATE planning_cards SET status = 'promoted'/);
  assert.match(route, /INSERT INTO nodes[\s\S]*SELECT \?, \?, title, notes/);
  assert.match(route, /await db\.batch\(statements\)/);
  assert.match(schema, /sqliteTable\("planning_columns"/);
  assert.match(schema, /sqliteTable\("planning_cards"/);
  assert.match(schema, /notes: text\("notes"\)/);
  assert.match(migration, /CREATE TABLE `planning_columns`/);

});

test("voice capture queues multiple local audios before batch processing", async () => {
  const [page, recorder] = await Promise.all([
    readFile(new URL("../app/voice/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/voice/recorder.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type QueuedAudio/);
  assert.match(page, /type="file" multiple/);
  assert.match(page, /setQueue\(current=>\[\.\.\.current/);
  assert.match(page, /async function processQueue/);
  assert.match(page, /for\(const item of waiting\)/);
  assert.match(page, /removeQueued\(item\.id\)/);
  assert.match(recorder, /Added to queue/);
});
