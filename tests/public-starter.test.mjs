import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('fresh public setup has aligned categories, fictional plans, and no personal records', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await readFile(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
    const seed = await readFile(new URL('../db/seed.sql', import.meta.url), 'utf8');
    db.exec(seed);
    const expected = ['Work', 'Workout', 'Relax', 'Study', 'Chores'];
    assert.deepEqual(db.prepare('SELECT title FROM nodes WHERE parent_id IS NULL ORDER BY position').all().map(r => r.title), expected);
    assert.deepEqual(db.prepare('SELECT title FROM planning_columns ORDER BY position').all().map(r => r.title), expected);
    assert.deepEqual(db.prepare("SELECT title FROM nodes WHERE parent_id='default-category-3' ORDER BY position").all().map(r => r.title), ['Finance', 'Word', 'Politics']);
    const count = db.prepare('SELECT count(*) n FROM planning_cards').get().n;
    assert.ok(db.prepare("SELECT count(*) n FROM planning_cards WHERE column_id='default-work'").get().n > count / 2);
    for (const table of ['history', 'daily_reviews', 'daily_slots', 'activity_sessions', 'voice_captures', 'voice_actions', 'voice_uploads', 'voice_comparisons']) {
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, `${table} starts empty`);
    }
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'roadmap_%'").get().n, 0);
    db.exec("UPDATE planning_cards SET title='My edited plan' WHERE id='sample-plan-0'");
    db.exec("UPDATE nodes SET status='removed' WHERE id='sample-work-0-task-0'");
    db.exec(seed);
    assert.equal(db.prepare('SELECT count(*) n FROM planning_cards').get().n, count);
    assert.equal(db.prepare("SELECT title FROM planning_cards WHERE id='sample-plan-0'").get().title, 'My edited plan');
    assert.equal(db.prepare("SELECT status FROM nodes WHERE id='sample-work-0-task-0'").get().status, 'removed');
  } finally { db.close(); }
});
