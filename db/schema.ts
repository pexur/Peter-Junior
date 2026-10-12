import { sql } from "drizzle-orm";
import { uniqueIndex, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => categories.id),
  title: text("title").notNull(),
  status: text("status", { enum: ["active", "done", "removed"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_items_category_status").on(table.categoryId, table.status)]);

export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  occurredDate: text("occurred_date"),
  occurredTime: text("occurred_time"),
  itemTitle: text("item_title"),
  categoryName: text("category_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_history_created_at").on(table.createdAt, table.id)]);

export const dailyReviews = sqliteTable("daily_reviews", {
  starred: integer("starred").notNull().default(0),
  date: text("date").primaryKey(),
  notes: text("notes").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailySlots = sqliteTable("daily_slots", {
  date: text("date").notNull(),
  time: text("time").notNull(),
  itemId: text("item_id"),
  itemTitle: text("item_title").notNull(),
  categoryName: text("category_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.date, table.time] })]);

export const planningColumns = sqliteTable("planning_columns", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  position: integer("position").notNull().default(0),
  status: text("status", { enum: ["active", "removed"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_planning_columns_status_position").on(table.status, table.position)]);

export const planningCards = sqliteTable("planning_cards", {
  subTag: text("sub_tag").notNull().default(""),
  id: text("id").primaryKey(),
  columnId: text("column_id").notNull().references(() => planningColumns.id),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  position: integer("position").notNull().default(0),
  status: text("status", { enum: ["active", "promoted", "done", "removed"] }).notNull().default("active"),
  promotedNodeId: text("promoted_node_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_planning_cards_column_status_position").on(table.columnId, table.status, table.position)]);

export const nodes = sqliteTable("nodes", {
  estimatedMinutes: integer("estimated_minutes"),
  mode: text("mode").notNull().default(""),
  workType: text("work_type").notNull().default(""),
  focused: integer("focused", { mode: "boolean" }).notNull().default(false),
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  title: text("title").notNull().default(""),
  kind: text("kind", { enum: ["item", "list"] }).notNull().default("item"),
  status: text("status", { enum: ["active", "done", "removed"] }).notNull().default("active"),
  position: integer("position").notNull().default(0),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  notes: text("notes").notNull().default(""),
  didAt: text("did_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_nodes_parent_status_position").on(table.parentId, table.status, table.position),
  index("idx_nodes_status_kind").on(table.status, table.kind),
]);

export const voiceCaptures = sqliteTable("voice_captures", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  requestId: text("request_id").notNull(),
  checksum: text("checksum").notNull(),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("uploaded"),
  interpretationModel: text("interpretation_model").notNull().default(""),
  interpretationVersion: integer("interpretation_version").notNull().default(1),
  transcript: text("transcript").notNull().default(""),
  error: text("error").notNull().default(""),
  retryable: integer("retryable").notNull().default(0),
  lease: text("lease"),
  leaseUntil: integer("lease_until").notNull().default(0),
  localDate: text("local_date").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("idx_voice_owner_request").on(t.ownerId, t.requestId), uniqueIndex("idx_voice_owner_checksum").on(t.ownerId, t.checksum), index("idx_voice_owner_created").on(t.ownerId, t.createdAt)]);

export const voiceActions = sqliteTable("voice_actions", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => voiceCaptures.id),
  proposal: text("proposal").notNull(),
  status: text("status").notNull().default("pending"),
  appliedToken: text("applied_token"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_voice_actions_capture").on(t.captureId)]);

export const activitySessions = sqliteTable("activity_sessions", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  itemId: text("item_id").notNull(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull().default(""),
  endTime: text("end_time").notNull().default(""),
  durationMin: integer("duration_min").notNull().default(0),
  durationMax: integer("duration_max").notNull().default(0),
  approximate: integer("approximate").notNull().default(0),
  completion: text("completion").notNull(),
  notes: text("notes").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, t => [uniqueIndex("idx_activity_action").on(t.actionId),index("idx_activity_date").on(t.date)]);

export const voiceComparisons = sqliteTable("voice_comparisons", {
  id: text("id").primaryKey(),
  captureId: text("capture_id").notNull().references(() => voiceCaptures.id),
  snapshot: text("snapshot").notNull(),
  results: text("results").notNull().default("[]"),
  leaseUntil: integer("lease_until").notNull().default(0),
  adoptedModel: text("adopted_model").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, t => [index("idx_comparisons_capture").on(t.captureId)]);

export const voiceUploads = sqliteTable("voice_uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  totalChunks: integer("total_chunks").notNull(),
  localDate: text("local_date").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, t => [index("idx_voice_uploads_owner_created").on(t.ownerId,t.createdAt)]);

