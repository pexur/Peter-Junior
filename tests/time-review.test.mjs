import assert from "node:assert/strict";
import test from "node:test";

import { buildTimeReview, summarizeTime, weekRange } from "../app/time-review.ts";

test("weekRange uses the Monday-through-Sunday week containing the selected date", () => {
  assert.deepEqual(weekRange("2026-09-10"), { start: "2026-09-07", end: "2026-09-13" });
  assert.deepEqual(weekRange("2026-09-13"), { start: "2026-09-07", end: "2026-09-13" });
});

test("time review aggregates planned slots and recorded duration by category", () => {
  const review = buildTimeReview(
    "2026-09-10",
    [
      { date: "2026-09-10", itemTitle: "Boulder", categoryName: "Climbing" },
      { date: "2026-09-10", itemTitle: "Boulder", categoryName: "Climbing" },
      { date: "2026-09-11", itemTitle: "French lesson", categoryName: "French" },
    ],
    [{ date: "2026-09-10", title: "Boulder", categoryName: "Climbing", startTime: "18:00", endTime: "19:00", durationMin: 45, durationMax: 60 }],
    [],
    [],
  );
  assert.deepEqual(review.day, [{ category: "Climbing", plannedMinutes: 30, actualMinMinutes: 45, actualMaxMinutes: 60 }]);
  assert.equal(review.week.find((row) => row.category === "French")?.plannedMinutes, 15);
});

test("matching voice history is not double counted and legacy did-it records count as 15 minutes", () => {
  const rows = summarizeTime(
    "2026-09-10",
    "2026-09-10",
    [],
    [{ date: "2026-09-10", title: "Gym", categoryName: "Health", startTime: "", endTime: "", durationMin: 60, durationMax: 60 }],
    [],
    [
      { date: "2026-09-10", itemTitle: "Gym", categoryName: null },
      { date: "2026-09-10", itemTitle: "Walk", categoryName: "Health" },
    ],
  );
  assert.deepEqual(rows, [{ category: "Health", plannedMinutes: 0, actualMinMinutes: 75, actualMaxMinutes: 75 }]);
});

test("manual timeline blocks count as actual time and voice-created blocks are not double counted", () => {
  const slots = ["10:00", "10:15", "10:30", "10:45"].map((time) => ({ date: "2026-09-10", time, itemId: "gym", itemTitle: "Gym", categoryName: "Health" }));
  const recorded = [{ date: "2026-09-10", itemId: "gym", title: "Gym", categoryName: "Health", startTime: "10:00", endTime: "11:00", durationMin: 60, durationMax: 60 }];
  assert.deepEqual(summarizeTime("2026-09-10", "2026-09-10", [], recorded, slots, []), [
    { category: "Health", plannedMinutes: 0, actualMinMinutes: 60, actualMaxMinutes: 60 },
  ]);
  assert.deepEqual(summarizeTime("2026-09-10", "2026-09-10", [], [], slots.slice(0, 2), []), [
    { category: "Health", plannedMinutes: 0, actualMinMinutes: 30, actualMaxMinutes: 30 },
  ]);
});

test("nested tasks roll up to their top-level category", async () => {
  const { mainCategory } = await import("../app/time-review.ts");
  const nodes = [
    { id: "work", parentId: null, title: "工作" },
    { id: "listen", parentId: "work", title: "Listen app" },
    { id: "task", parentId: "listen", title: "Fix transcript" },
  ];
  assert.equal(mainCategory("task", "Listen app", nodes), "工作");
});

test("missing categories from every time source share the Uncategorized total", () => {
  const date = "2026-09-10";
  const rows = summarizeTime(date, date,
    [{ date, itemTitle: "Plan", categoryName: null }],
    [{ date, title: "Session", categoryName: null, startTime: "", endTime: "", durationMin: 20, durationMax: 30 }],
    [{ date, time: "12:00", itemId: null, itemTitle: "Manual", categoryName: null }],
    [{ date, itemTitle: "Legacy", categoryName: null }],
  );
  assert.deepEqual(rows, [{ category: "Uncategorized", plannedMinutes: 15, actualMinMinutes: 50, actualMaxMinutes: 60 }]);
});
