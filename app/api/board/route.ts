import { getD1 } from "../../../db";

type ColumnRow = { id: string; title: string; position: number; created_at: string };
type CardRow = { id: string; column_id: string; title: string; notes: string; sub_tag: string; position: number; created_at: string };

async function readBoard(mutation?: ReturnType<ReturnType<typeof getD1>["prepare"]>) {
  const db = getD1();
  const reads = [
    db.prepare("SELECT id, title, position, created_at FROM planning_columns WHERE status = 'active' ORDER BY position, created_at"),
    db.prepare("SELECT c.id, c.column_id, c.title, c.notes, c.sub_tag, c.position, c.created_at FROM planning_cards c WHERE c.status = 'active' ORDER BY c.position, c.created_at"),
  ];
  // Execute the write and its snapshot together in one database round trip.
  const results = await db.batch(mutation ? [mutation, ...reads] : reads);
  const [columnResult, cardResult] = results.slice(mutation ? 1 : 0);
  return {
    columns: (columnResult.results as ColumnRow[]).map((column) => ({ id: column.id, title: column.title, position: column.position, createdAt: column.created_at })),
    cards: (cardResult.results as CardRow[]).map((card) => ({ id: card.id, columnId: card.column_id, title: card.title, notes: card.notes, subTag: card.sub_tag, position: card.position, createdAt: card.created_at })),
  };
}

function validId(value: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

async function nextPosition(table: "planning_columns" | "planning_cards", columnId?: string) {
  const db = getD1();
  const row = columnId
    ? await db.prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM ${table} WHERE column_id = ? AND status = 'active'`).bind(columnId).first<{ position: number }>()
    : await db.prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM ${table} WHERE status = 'active'`).first<{ position: number }>();
  return Number(row?.position ?? 0) + 1;
}

export async function GET() {
  try { return Response.json(await readBoard()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load the planning board." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { action?: string; id?: string; cardId?: string; columnId?: string; targetColumnId?: string; targetParentId?: string | null; nodeId?: string; title?: string; notes?: string; subTag?: string; direction?: "up" | "down" };
    const db = getD1();

    if (payload.action === "createColumn") {
      const id = payload.id ?? "";
      const title = payload.title?.trim().slice(0, 60) || "New area";
      if (!validId(id)) return Response.json({ error: "A valid column is required." }, { status: 400 });
      await db.prepare("INSERT INTO planning_columns (id, title, position) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(id, title, await nextPosition("planning_columns")).run();
    } else if (payload.action === "updateColumn") {
      const title = payload.title?.trim().slice(0, 60) ?? "";
      if (!payload.columnId || !title) return Response.json({ error: "A column needs a name." }, { status: 400 });
      await db.prepare("UPDATE planning_columns SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").bind(title, payload.columnId).run();
    } else if (payload.action === "moveColumn") {
      const columns = (await db.prepare("SELECT id, position FROM planning_columns WHERE status = 'active' ORDER BY position, created_at").all<{ id: string; position: number }>()).results;
      const index = columns.findIndex((column) => column.id === payload.columnId);
      const otherIndex = payload.direction === "up" ? index - 1 : index + 1;
      if (index >= 0 && otherIndex >= 0 && otherIndex < columns.length) {
        await db.batch([
          db.prepare("UPDATE planning_columns SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(columns[otherIndex].position, columns[index].id),
          db.prepare("UPDATE planning_columns SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(columns[index].position, columns[otherIndex].id),
        ]);
      }
    } else if (payload.action === "removeColumn") {
      if (!payload.columnId) return Response.json({ error: "A column is required." }, { status: 400 });
      await db.batch([
        db.prepare("UPDATE planning_columns SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.columnId),
        db.prepare("UPDATE planning_cards SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE column_id = ? AND status = 'active'").bind(payload.columnId),
      ]);
    } else if (payload.action === "createCard") {
      const id = payload.id ?? "";
      const title = payload.title?.trim().slice(0, 200) ?? "";
      if (!validId(id) || !payload.columnId || !title) return Response.json({ error: "Give the idea a title." }, { status: 400 });
      const board = await readBoard(db.prepare(`
        INSERT INTO planning_cards (id, column_id, title, notes, sub_tag, position)
        SELECT ?, id, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM planning_cards WHERE column_id = ? AND status = 'active')
        FROM planning_columns WHERE id = ? AND status = 'active'
        ON CONFLICT(id) DO NOTHING
      `).bind(id, title, (payload.notes ?? "").trim().slice(0, 20000), (payload.subTag ?? "").trim().slice(0, 60).toLowerCase(), payload.columnId, payload.columnId));
      if (!board.cards.some((card) => card.id === id)) return Response.json({ error: "That planning area or idea no longer exists. Reload the board before trying again." }, { status: 409 });
      return Response.json(board);
    } else if (payload.action === "updateCard") {
      const title = payload.title?.trim().slice(0, 200) ?? "";
      if (!payload.cardId || !title) return Response.json({ error: "Give the idea a title." }, { status: 400 });
      const board = await readBoard(db.prepare(`UPDATE planning_cards SET title = ?, notes = ?, sub_tag = COALESCE(?, sub_tag), column_id = COALESCE(?, column_id), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'active' AND (? IS NULL OR EXISTS (SELECT 1 FROM planning_columns WHERE id = ? AND status = 'active'))
        RETURNING id`).bind(title, (payload.notes ?? "").trim().slice(0, 20000), payload.subTag === undefined ? null : payload.subTag.trim().slice(0, 60).toLowerCase(), payload.columnId ?? null, payload.cardId, payload.columnId ?? null, payload.columnId ?? null));
      if (!board.cards.some(card => card.id === payload.cardId && (!payload.columnId || card.columnId === payload.columnId))) return Response.json({ error: "That idea or main tag no longer exists." }, { status: 409 });
      return Response.json(board);
    } else if (payload.action === "moveCard") {
      if (!payload.cardId) return Response.json({ error: "An idea is required." }, { status: 400 });
      const card = await db.prepare("SELECT id, column_id, position FROM planning_cards WHERE id = ? AND status = 'active'").bind(payload.cardId).first<{ id: string; column_id: string; position: number }>();
      if (!card) return Response.json({ error: "That idea no longer exists." }, { status: 404 });
      if (payload.targetColumnId && payload.targetColumnId !== card.column_id) {
        const column = await db.prepare("SELECT id FROM planning_columns WHERE id = ? AND status = 'active'").bind(payload.targetColumnId).first<{ id: string }>();
        if (!column) return Response.json({ error: "That planning column no longer exists." }, { status: 404 });
        await db.prepare("UPDATE planning_cards SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(payload.targetColumnId, await nextPosition("planning_cards", payload.targetColumnId), card.id).run();
      } else if (payload.direction) {
        const cards = (await db.prepare("SELECT id, position FROM planning_cards WHERE column_id = ? AND status = 'active' ORDER BY position, created_at").bind(card.column_id).all<{ id: string; position: number }>()).results;
        const index = cards.findIndex((entry) => entry.id === card.id);
        const otherIndex = payload.direction === "up" ? index - 1 : index + 1;
        if (index >= 0 && otherIndex >= 0 && otherIndex < cards.length) await db.batch([
          db.prepare("UPDATE planning_cards SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(cards[otherIndex].position, cards[index].id),
          db.prepare("UPDATE planning_cards SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(cards[index].position, cards[otherIndex].id),
        ]);
      }
    } else if (payload.action === "completeCard") {
      if (!payload.cardId) return Response.json({ error: "An idea is required." }, { status: 400 });
      await db.prepare("UPDATE planning_cards SET status='done', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(payload.cardId).run();
    } else if (payload.action === "removeCard") {
      if (!payload.cardId) return Response.json({ error: "An idea is required." }, { status: 400 });
      await db.prepare("UPDATE planning_cards SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").bind(payload.cardId).run();
    } else if (payload.action === "promoteCard") {
      const cardId = payload.cardId ?? "";
      const nodeId = payload.nodeId ?? "";
      if (!cardId || !validId(nodeId)) return Response.json({ error: "An idea and destination are required." }, { status: 400 });
      const card = await db.prepare("SELECT id, title, notes FROM planning_cards WHERE id = ? AND status = 'active'").bind(cardId).first<{ id: string; title: string; notes: string }>();
      if (!card) return Response.json({ error: "That idea has already moved or been removed." }, { status: 409 });
      const parentId = payload.targetParentId || null;
      let categoryName: string | null = null;
      if (parentId) {
        const parent = await db.prepare("SELECT id, title FROM nodes WHERE id = ? AND kind = 'list' AND status = 'active'").bind(parentId).first<{ id: string; title: string }>();
        if (!parent) return Response.json({ error: "Drop the idea onto an active list." }, { status: 400 });
        categoryName = parent.title;
      }
      const positionRow = parentId
        ? await db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM nodes WHERE parent_id = ? AND status = 'active'").bind(parentId).first<{ position: number }>()
        : await db.prepare("SELECT COALESCE(MAX(position), 0) AS position FROM nodes WHERE parent_id IS NULL AND status = 'active'").first<{ position: number }>();
      const statements = [
        db.prepare("UPDATE planning_cards SET status = 'promoted', promoted_node_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'").bind(nodeId, card.id),
        db.prepare("INSERT INTO nodes (id, parent_id, title, notes, kind, position, is_draft) SELECT ?, ?, title, notes, 'item', ?, 0 FROM planning_cards WHERE id = ? AND promoted_node_id = ?").bind(nodeId, parentId, Number(positionRow?.position ?? 0) + 1, card.id, nodeId),
        db.prepare("INSERT INTO history (action, item_title, category_name) SELECT 'item_added', title, ? FROM planning_cards WHERE id = ? AND promoted_node_id = ?").bind(categoryName, card.id, nodeId),
      ];
      if (parentId) statements.push(db.prepare("UPDATE nodes SET kind = 'list', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(parentId));
      const results = await db.batch(statements);
      if (!results[0].meta.changes) return Response.json({ error: "That idea has already moved or been removed." }, { status: 409 });
    } else {
      return Response.json({ error: "Unknown board action." }, { status: 400 });
    }

    return Response.json(await readBoard());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the planning board." }, { status: 500 });
  }
}
