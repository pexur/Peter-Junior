export type ListNode = {
  mode?: "" | "work" | "relax";
  workType?: "" | "execution" | "research";
  focused?: boolean;
  estimatedMinutes?: number | null;
  id: string;
  parentId: string | null;
  title: string;
  kind: "item" | "list";
  position: number;
  isDraft: boolean;
  notes: string;
  didAt: string | null;
  createdAt: string;
};

export type HistoryEntry = {
  occurredDate?: string | null;
  occurredTime?: string | null;
  id: number;
  action: "category_added" | "item_added" | "item_renamed" | "chosen" | "item_did" | "item_done" | "item_removed";
  itemTitle: string | null;
  categoryName: string | null;
  createdAt: string;
};

export type DailyReview = {
  starred: boolean;
  date: string;
  notes: string;
  updatedAt: string;
};

export type AppState = {
  nodes: ListNode[];
  history: HistoryEntry[];
  reviews: DailyReview[];
  focusId?: string;
};

export type Mutation = { action: "tagNode" | "startNode" | "pauseNode" | "createNode" | "updateNode" | "moveNode" | "didNode" | "doneNode" | "removeNode" | "chooseNode" | "removeCategory"; id: string; title?: string; notes?: string; parentId?: string | null; afterId?: string | null; kind?: "item" | "list"; confirmTitle?: string; estimatedMinutes?: number | null; mode?: "" | "work" | "relax"; workType?: "" | "execution" | "research" };

export function applyMutation(state: AppState, change: Mutation): AppState {
  let nodes = state.nodes.map((node) => ({ ...node }));
  const node = nodes.find((row) => row.id === change.id);
  if (change.action === "createNode" || (change.action === "moveNode" && node)) {
    const parentId = change.parentId || null;
    const siblings = nodes.filter((row) => row.parentId === parentId);
    const after = siblings.find((row) => row.id === change.afterId);
    const position = after ? after.position + 1 : Math.max(0, ...siblings.map((row) => row.position)) + 1;
    if (after) siblings.filter((row) => row.position >= position).forEach((row) => { row.position += 1; });
    if (change.action === "createNode") nodes.push({ id: change.id, parentId, title: change.title?.trim().slice(0, 200) || "", kind: change.kind || "item", position, isDraft: !change.title?.trim(), notes: "", mode: change.mode || "", workType: change.workType || "", estimatedMinutes: change.estimatedMinutes ?? null, focused: false, didAt: null, createdAt: new Date().toISOString() });
    else Object.assign(node!, { parentId, position });
    const parent = nodes.find((row) => row.id === parentId);
    if (parent) parent.kind = "list";
  } else if (node && change.action === "updateNode") {
    const title = (change.title || "").trim().slice(0, 200);
    if (title) Object.assign(node, { title, isDraft: false, ...(change.notes !== undefined ? { notes: change.notes.slice(0, 20000) } : {}) });
    // Blank drafts survive title updates; removal is an explicit action.
  } else if (node && change.action === "tagNode") {
    if (change.mode !== undefined) node.mode = change.mode;
    if (change.workType !== undefined) node.workType = change.workType;
    if (change.estimatedMinutes !== undefined) node.estimatedMinutes = change.estimatedMinutes;
  } else if (node && change.action === "startNode") {
    nodes.forEach(row => { row.focused = row.id === node.id; });
  } else if (node && change.action === "pauseNode") {
    node.focused = false;
  } else if (node && change.action === "removeCategory") {
    const position = Math.max(0, ...nodes.filter(row => row.parentId === node.parentId).map(row => row.position)) + 1;
    nodes.forEach(row => { if (row.parentId === node.id) { row.parentId = node.parentId; row.position += position; } });
    nodes = nodes.filter(row => row.id !== node.id);
  } else if (node && change.action === "didNode") {
    node.didAt = new Date().toISOString();
    node.focused = false;
  } else if (node && (change.action === "doneNode" || change.action === "removeNode")) {
    const removed = new Set([node.id]);
    // Draft removal deletes just the draft, matching the API.
    if (!(node.isDraft && change.action === "removeNode")) {
      let previousSize = 0;
      while (previousSize !== removed.size) {
        previousSize = removed.size;
        nodes.forEach((row) => { if (row.parentId && removed.has(row.parentId)) removed.add(row.id); });
      }
    }
    nodes = nodes.filter((row) => !removed.has(row.id));
  }
  return { nodes, history: state.history, reviews: state.reviews };
}

// One request at a time preserves create → rename → nest ordering. Reapply
// pending edits over each acknowledgement so old responses never undo new UI.
export class ListMutationQueue {
  private confirmed: AppState = { nodes: [], history: [], reviews: [] };
  private pending: { change: Mutation; resolve: (state: AppState) => void; reject: (error: unknown) => void }[] = [];
  current: AppState = this.confirmed;
  private send: (change: Mutation) => Promise<AppState>;
  private publish: (state: AppState, pending: number) => void;
  constructor(send: (change: Mutation) => Promise<AppState>, publish: (state: AppState, pending: number) => void) {
    this.send = send;
    this.publish = publish;
  }
  reset(state: AppState) { this.confirmed = state; this.render(); }
  private render() {
    this.current = this.pending.reduce((state, entry) => applyMutation(state, entry.change), this.confirmed);
    this.publish(this.current, this.pending.length);
  }
  enqueue(change: Mutation): Promise<AppState> {
    const promise = new Promise<AppState>((resolve, reject) => { this.pending.push({ change, resolve, reject }); });
    this.render();
    if (this.pending.length === 1) void this.flush();
    return promise;
  }
  private async flush() {
    while (this.pending.length) {
      const entry = this.pending[0];
      try {
        this.confirmed = await this.send(entry.change);
        this.pending.shift();
        this.render();
        entry.resolve(this.confirmed);
      } catch (error) {
        // Do not send dependent operations after a failed create or move.
        const cancelled = this.pending.splice(0);
        this.render();
        cancelled.forEach((item) => item.reject(error));
        return;
      }
    }
  }
}
