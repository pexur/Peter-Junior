import { getD1 } from "../../../db";

const categoryNames: Record<string, string[]> = {
  Work: ["work", "工作"], Workout: ["workout", "健身"],
  Relax: ["relax", "放松"], Study: ["study", "学习"], Chores: ["chores", "chore", "家务"],
};
const categoryTitle = (title: string) => Object.entries(categoryNames).find(([, names]) => names.includes(title.trim().toLowerCase()))?.[0] || title.trim();

type NodeRow = { estimated_minutes: number | null; mode: "" | "work" | "relax"; work_type: "" | "execution" | "research"; focused: number; id: string; parent_id: string | null; title: string; kind: "item" | "list"; position: number; is_draft: number; notes: string; did_at: string | null; created_at: string };
type HistoryRow = { occurred_date: string | null; occurred_time: string | null; id: number; action: "category_added" | "item_added" | "item_renamed" | "chosen" | "item_did" | "item_done" | "item_removed"; item_title: string | null; category_name: string | null; created_at: string };
type ReviewRow = { starred: number; date: string; notes: string; updated_at: string };

async function readState(focusId?: string) {
  const db = getD1();
  const [nodeResult, historyResult, reviewResult] = await Promise.all([
    db.prepare("SELECT id, parent_id, title, kind, position, is_draft, notes, did_at, created_at, mode, work_type, focused, estimated_minutes FROM nodes WHERE status = 'active' ORDER BY position, created_at").all<NodeRow>(),
    db.prepare("SELECT id, action, item_title, category_name, created_at, occurred_date, occurred_time FROM history ORDER BY id DESC LIMIT 500").all<HistoryRow>(),
    db.prepare("SELECT date, notes, starred, updated_at FROM daily_reviews WHERE starred = 1 OR date IN (SELECT date FROM daily_reviews ORDER BY date DESC LIMIT 365) ORDER BY date DESC").all<ReviewRow>(),
  ]);
  return {
    nodes: nodeResult.results.map((node) => ({ estimatedMinutes: node.estimated_minutes, mode: node.mode, workType: node.work_type, focused: Boolean(node.focused), id: node.id, parentId: node.parent_id, title: node.title, kind: node.kind, position: node.position, isDraft: Boolean(node.is_draft), notes: node.notes, didAt: node.did_at, createdAt: node.created_at })),
    history: historyResult.results.map((entry) => ({ id: entry.id, occurredDate: entry.occurred_date, occurredTime: entry.occurred_time, action: entry.action, itemTitle: entry.item_title, categoryName: entry.category_name, createdAt: entry.created_at })),
    reviews: reviewResult.results.map((review) => ({ date: review.date, notes: review.notes, starred: Boolean(review.starred), updatedAt: review.updated_at })),
    ...(focusId ? { focusId } : {}),
  };
}

async function parentName(parentId: string | null) {
  if (!parentId) return null;
  const db = getD1();
  const parent = await db.prepare("SELECT title FROM nodes WHERE id = ?").bind(parentId).first<{ title: string }>();
  return parent?.title || null;
}

async function nextPosition(parentId: string | null) {
  const db = getD1();
  const row = parentId
    ? await db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM nodes WHERE parent_id = ? AND status = 'active'").bind(parentId).first<{ position: number }>()
    : await db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM nodes WHERE parent_id IS NULL AND status = 'active'").first<{ position: number }>();
  return Number(row?.position ?? 0) + 1;
}

export async function GET() {
  try { return Response.json(await readState()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load the list." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { action?: string; id?: string; title?: string; parentId?: string | null; afterId?: string | null; date?: string; notes?: string; eventId?: number; starred?: boolean; kind?: "item" | "list"; confirmTitle?: string; estimatedMinutes?: number | null; mode?: string; workType?: string };
    const db = getD1();

    if (payload.estimatedMinutes !== undefined && payload.estimatedMinutes !== null && (!Number.isSafeInteger(payload.estimatedMinutes) || payload.estimatedMinutes <= 0 || payload.estimatedMinutes > 525600)) return Response.json({ error: "Time needed must be a whole number of minutes between 1 and 525600." }, { status: 400 });

    if (payload.mode !== undefined && !["", "work", "relax"].includes(payload.mode)) return Response.json({ error: "Invalid task mode." }, { status: 400 });
    if (payload.workType !== undefined && !["", "execution", "research"].includes(payload.workType)) return Response.json({ error: "Invalid work type." }, { status: 400 });

    if (payload.action === "ensureCategories") {
      const categories = Object.keys(categoryNames);
      // Tombstones prevent removed defaults from being recreated. Match both
      // languages before seeding, including legacy empty categories typed as items.
      await db.batch(categories.map((title, index) => {
        const aliases = categoryNames[title];
        return db.prepare(`INSERT OR IGNORE INTO nodes (id, parent_id, title, kind, position, is_draft, status) SELECT ?, NULL, ?, 'list', ?, 0, CASE WHEN EXISTS (SELECT 1 FROM nodes WHERE parent_id IS NULL AND lower(trim(title)) IN (${aliases.map(() => "?").join(",")})) THEN 'removed' ELSE 'active' END`).bind(`default-category-${index}`, title, index + 1, ...aliases);
      }));
      for (const title of categories) {
        const aliases = categoryNames[title];
        const matches = await db.prepare(`SELECT id, notes FROM nodes WHERE parent_id IS NULL AND status = 'active' AND lower(trim(title)) IN (${aliases.map(() => "?").join(",")}) ORDER BY CASE WHEN id LIKE 'default-category-%' THEN 1 ELSE 0 END, created_at, id`).bind(...aliases).all<{ id: string; notes: string }>();
        const [keeper, ...duplicates] = matches.results;
        if (!keeper) continue;
        const statements = [];
        for (const duplicate of duplicates) {
          // Move direct children only: nested groups, IDs, notes and records survive.
          statements.push(db.prepare("UPDATE nodes SET parent_id = ?, position = position + (SELECT COALESCE(MAX(position), 0) FROM nodes WHERE parent_id = ?) WHERE parent_id = ?").bind(keeper.id, keeper.id, duplicate.id));
          if (duplicate.notes) statements.push(db.prepare("UPDATE nodes SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || char(10) || ? END WHERE id = ? AND EXISTS (SELECT 1 FROM nodes WHERE id = ? AND status = 'active')").bind(duplicate.notes, duplicate.notes, keeper.id, duplicate.id));
          statements.push(db.prepare("UPDATE nodes SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(duplicate.id));
        }
        statements.push(db.prepare("UPDATE nodes SET title = ?, kind = 'list', is_draft = 0 WHERE id = ?").bind(title, keeper.id));
        await db.batch(statements);
      }
      return Response.json(await readState());
    }

    if (payload.starred !== undefined && typeof payload.starred !== "boolean") return Response.json({ error: "Starred must be true or false." }, { status: 400 });

    if (payload.action === "setReviewStar") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "") || typeof payload.starred !== "boolean") return Response.json({ error: "A review date and starred state are required." }, { status: 400 });
      const result = await db.prepare("UPDATE daily_reviews SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE date = ? AND trim(notes) <> ''").bind(Number(payload.starred), payload.date).run();
      if (!result.meta.changes) return Response.json({ error: "That thought no longer exists." }, { status: 404 });
      return Response.json(await readState());
    }

    if (payload.action === "saveReview") {
      const date = payload.date ?? "";
      const notes = (payload.notes ?? "").trim().slice(0, 4000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "A valid review date is required." }, { status: 400 });
      if (!notes && payload.starred) return Response.json({ error: "Write a thought before starring it." }, { status: 400 });
      if (notes && payload.starred !== undefined) {
        await db.prepare("INSERT INTO daily_reviews (date, notes, starred, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, starred = excluded.starred, updated_at = CURRENT_TIMESTAMP").bind(date, notes, Number(payload.starred)).run();
      } else if (notes) {
        await db.prepare("INSERT INTO daily_reviews (date, notes, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, updated_at = CURRENT_TIMESTAMP").bind(date, notes).run();
      } else {
        await db.prepare("DELETE FROM daily_reviews WHERE date = ?").bind(date).run();
      }
      return Response.json(await readState());
    }

    if (payload.action === "removeHistory") {
      if (!Number.isInteger(payload.eventId) || Number(payload.eventId) <= 0) return Response.json({ error: "A valid activity event is required." }, { status: 400 });
      await db.prepare("DELETE FROM history WHERE id = ?").bind(payload.eventId).run();
      return Response.json(await readState());
    }

    if (payload.action === "createNode") {
      const parentId = payload.parentId || null;
      if (parentId) {
        const parent = await db.prepare("SELECT id FROM nodes WHERE id = ? AND status = 'active'").bind(parentId).first<{ id: string }>();
        if (!parent) return Response.json({ error: "That parent row no longer exists." }, { status: 404 });
      }
      let position = await nextPosition(parentId);
      if (payload.afterId) {
        const after = await db.prepare("SELECT parent_id, position FROM nodes WHERE id = ? AND status = 'active'").bind(payload.afterId).first<{ parent_id: string | null; position: number }>();
        if (after && after.parent_id === parentId) {
          position = after.position + 1;
          if (parentId) await db.prepare("UPDATE nodes SET position = position + 1 WHERE parent_id = ? AND status = 'active' AND position >= ?").bind(parentId, position).run();
          else await db.prepare("UPDATE nodes SET position = position + 1 WHERE parent_id IS NULL AND status = 'active' AND position >= ?").bind(position).run();
        }
      }
      const id = payload.id || crypto.randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Invalid row ID." }, { status: 400 });
      let title = payload.title?.trim().slice(0, 200) || "";
      const kind = payload.kind === "list" ? "list" : "item";
      if (kind === "list" && !parentId) title = categoryTitle(title);
      if (kind === "list" && title) {
        const duplicate = await db.prepare("SELECT id FROM nodes WHERE parent_id IS ? AND status = 'active' AND kind = 'list' AND lower(trim(title)) = lower(?)").bind(parentId, title).first();
        if (duplicate) return Response.json({ error: "That category already exists. Choose a different name." }, { status: 409 });
      }
      const statements = [db.prepare("INSERT INTO nodes (id, parent_id, title, kind, position, is_draft, mode, work_type, estimated_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, parentId, title, kind, position, title ? 0 : 1, payload.mode || "", payload.workType || "", payload.estimatedMinutes ?? null)];
      if (title) statements.push(db.prepare("INSERT INTO history (action, item_title, category_name) VALUES ('item_added', ?, ?)").bind(title, await parentName(parentId)));
      if (parentId) statements.push(db.prepare("UPDATE nodes SET kind = 'list', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(parentId));
      await db.batch(statements);
      return Response.json(await readState(id));
    }

    if (!payload.id) return Response.json({ error: "A row is required." }, { status: 400 });
    const node = await db.prepare("SELECT id, parent_id, title, kind, is_draft, notes FROM nodes WHERE id = ? AND status = 'active'").bind(payload.id).first<{ id: string; parent_id: string | null; title: string; kind: "item" | "list"; is_draft: number; notes: string }>();
    if (!node) return Response.json({ error: "That row no longer exists." }, { status: 404 });

    if (["tagNode", "startNode", "pauseNode"].includes(payload.action || "")) {
      if (node.kind !== "item" || node.is_draft) return Response.json({ error: "Choose an active task." }, { status: 400 });
      if (payload.action === "tagNode") {
        await db.prepare("UPDATE nodes SET mode = COALESCE(?, mode), work_type = COALESCE(?, work_type), estimated_minutes = CASE WHEN ? THEN ? ELSE estimated_minutes END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.mode ?? null, payload.workType ?? null, payload.estimatedMinutes !== undefined ? 1 : 0, payload.estimatedMinutes ?? null, node.id).run();
      } else if (payload.action === "startNode") {
        await db.batch([
          db.prepare("UPDATE nodes SET focused = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE focused = 1 OR id = ?").bind(node.id, node.id),
          db.prepare("INSERT INTO history (action, item_title, category_name) VALUES ('chosen', ?, ?)").bind(node.title, await parentName(node.parent_id)),
        ]);
      } else await db.prepare("UPDATE nodes SET focused = 0 WHERE id = ?").bind(node.id).run();
      return Response.json(await readState());
    }

    if (payload.action === "removeCategory") {
      if (node.kind !== "list" || payload.confirmTitle !== node.title) return Response.json({ error: "Type the category name to confirm deletion." }, { status: 400 });
      const position = await nextPosition(node.parent_id);
      await db.batch([
        db.prepare("UPDATE nodes SET parent_id = ?, position = position + ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ?").bind(node.parent_id, position, node.id),
        db.prepare("UPDATE nodes SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(node.id),
        db.prepare("INSERT INTO history (action, item_title, category_name) VALUES ('item_removed', ?, ?)").bind(node.title, await parentName(node.parent_id)),
      ]);
      return Response.json(await readState());
    }

    if (node.kind === "list" && payload.action === "doneNode") return Response.json({ error: "Complete individual items, not categories." }, { status: 400 });
    if (node.kind === "list" && payload.action === "removeNode") {
      if (payload.confirmTitle !== node.title) return Response.json({ error: "Type the category name to confirm removal." }, { status: 400 });
      const child = await db.prepare("SELECT id FROM nodes WHERE parent_id = ? AND status = 'active' LIMIT 1").bind(node.id).first();
      if (child) return Response.json({ error: "Move or remove the contents before deleting this category." }, { status: 400 });
    }

    if (payload.action === "updateNode") {
      let title = payload.title?.trim().slice(0, 200) ?? node.title;
      if (node.kind === "list" && !node.parent_id) title = categoryTitle(title);
      if (node.kind === "list" && title) {
        const duplicate = await db.prepare("SELECT id FROM nodes WHERE parent_id IS ? AND status = 'active' AND kind = 'list' AND id <> ? AND lower(trim(title)) = lower(?)").bind(node.parent_id, node.id, title).first();
        if (duplicate) return Response.json({ error: "That category already exists. Choose a different name." }, { status: 409 });
      }
      const notes = payload.notes === undefined ? node.notes : payload.notes.trim().slice(0, 20000);
      if (!title && node.is_draft) {
        // Empty title updates are not delete commands. This also protects
        // drafts (and their children) from stale blur/save requests.
        return Response.json(await readState());
      } else if (!title) {
        return Response.json({ error: "A row needs a name." }, { status: 400 });
      } else if (title !== node.title || notes !== node.notes || node.is_draft) {
        const context = await parentName(node.parent_id);
        const action = node.is_draft ? "item_added" : "item_renamed";
        const statements = [db.prepare("UPDATE nodes SET title = ?, notes = ?, is_draft = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(title, notes, node.id)];
        if (title !== node.title || node.is_draft) statements.push(db.prepare("INSERT INTO history (action, item_title, category_name) VALUES (?, ?, ?)").bind(action, title, context));
        await db.batch(statements);
      }
    } else if (payload.action === "moveNode") {
      const parentId = payload.parentId || null;
      if (parentId === node.id) return Response.json({ error: "A row cannot contain itself." }, { status: 400 });
      let ancestorId = parentId;
      let guard = 0;
      while (ancestorId && guard < 100) {
        if (ancestorId === node.id) return Response.json({ error: "A row cannot move inside one of its children." }, { status: 400 });
        const ancestor = await db.prepare("SELECT parent_id FROM nodes WHERE id = ? AND status = 'active'").bind(ancestorId).first<{ parent_id: string | null }>();
        if (!ancestor) return Response.json({ error: "That destination no longer exists." }, { status: 404 });
        ancestorId = ancestor.parent_id;
        guard += 1;
      }
      let position = await nextPosition(parentId);
      if (payload.afterId) {
        const after = await db.prepare("SELECT parent_id, position FROM nodes WHERE id = ? AND status = 'active'").bind(payload.afterId).first<{ parent_id: string | null; position: number }>();
        if (after && after.parent_id === parentId) {
          position = after.position + 1;
          if (parentId) await db.prepare("UPDATE nodes SET position = position + 1 WHERE parent_id = ? AND status = 'active' AND position >= ?").bind(parentId, position).run();
          else await db.prepare("UPDATE nodes SET position = position + 1 WHERE parent_id IS NULL AND status = 'active' AND position >= ?").bind(position).run();
        }
      }
      const statements = [db.prepare("UPDATE nodes SET parent_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(parentId, position, node.id)];
      if (parentId) statements.push(db.prepare("UPDATE nodes SET kind = 'list', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(parentId));
      await db.batch(statements);
    } else if (["didNode", "doneNode", "removeNode", "chooseNode"].includes(payload.action ?? "")) {
      const context = await parentName(node.parent_id);
      if (payload.action === "chooseNode") {
        if (node.kind !== "item" || node.is_draft) return Response.json({ error: "Only active items can be chosen." }, { status: 400 });
        await db.prepare("INSERT INTO history (action, item_title, category_name) VALUES ('chosen', ?, ?)").bind(node.title, context).run();
      } else if (payload.action === "didNode") {
        if (node.kind !== "item" || node.is_draft) return Response.json({ error: "Only active items can be marked as did it." }, { status: 400 });
        await db.batch([
          db.prepare("UPDATE nodes SET focused = 0, did_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(node.id),
          db.prepare("INSERT INTO history (action, item_title, category_name) VALUES ('item_did', ?, ?)").bind(node.title, context),
        ]);
      } else if (node.is_draft && payload.action === "removeNode") {
        await db.prepare("DELETE FROM nodes WHERE id = ? AND is_draft = 1").bind(node.id).run();
      } else {
        const status = payload.action === "doneNode" ? "done" : "removed";
        const historyAction = payload.action === "doneNode" ? "item_done" : "item_removed";
        await db.batch([
          db.prepare("WITH RECURSIVE subtree(id) AS (SELECT id FROM nodes WHERE id = ? UNION ALL SELECT child.id FROM nodes child JOIN subtree parent ON child.parent_id = parent.id) UPDATE nodes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM subtree)").bind(node.id, status),
          db.prepare("INSERT INTO history (action, item_title, category_name) VALUES (?, ?, ?)").bind(historyAction, node.title, context),
        ]);
      }
    } else {
      return Response.json({ error: "Unknown action." }, { status: 400 });
    }

    return Response.json(await readState());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the list." }, { status: 500 });
  }
}
