import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Drizzle schema — the typed mirror of drizzle/migrations/*.sql.
 *
 * The SQL migrations remain the source of truth for constraints (checks,
 * partial unique indexes) that Drizzle cannot fully express. This file exists
 * for query typing; it does not replace them.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const accountStatusEnum = pgEnum("account_status", [
  "pending",
  "approved",
  "inactive",
  "rejected",
]);

export const menuDayStatusEnum = pgEnum("menu_day_status", [
  "draft",
  "published",
  "locked",
  "sent_to_provider",
  "settled",
]);

export const orderStatusEnum = pgEnum("order_status", ["active", "cancelled"]);

export const cancellationStatusEnum = pgEnum("cancellation_status", [
  "pending",
  "approved",
  "rejected",
]);

export const settlementStatusEnum = pgEnum("settlement_status", [
  "preview",
  "committed",
  "voided",
]);

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "paid", "waived"]);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    accountStatus: accountStatusEnum("account_status").notNull().default("pending"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("people_email_key").on(table.email),
    index("people_status_idx").on(table.accountStatus),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionToken: text("session_token").notNull().unique(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (table) => [index("sessions_person_idx").on(table.personId)],
);

export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    ipHash: text("ip_hash"),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_attempts_email_idx").on(table.email, table.attemptedAt)],
);

// ---------------------------------------------------------------------------
// Menu days and rounds
// ---------------------------------------------------------------------------

export const menuDays = pgTable(
  "menu_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dateKey: date("date_key").notNull().unique(),
    status: menuDayStatusEnum("status").notNull().default("draft"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    title: text("title"),
    deadlineJobId: text("deadline_job_id"),
    reminderJobId: text("reminder_job_id"),
    createdBy: uuid("created_by").references(() => people.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("menu_days_status_deadline_idx").on(table.status, table.deadlineAt)],
);

export const orderRounds = pgTable(
  "order_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuDayId: uuid("menu_day_id")
      .notNull()
      .references(() => menuDays.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    reason: text("reason"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => people.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("order_rounds_day_number_key").on(table.menuDayId, table.roundNumber),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuDayId: uuid("menu_day_id")
      .notNull()
      .references(() => menuDays.id, { onDelete: "cascade" }),
    orderRoundId: uuid("order_round_id")
      .notNull()
      .references(() => orderRounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    unitPricePaise: bigint("unit_price_paise", { mode: "number" }).notNull(),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("menu_items_round_idx").on(table.orderRoundId)],
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuDayId: uuid("menu_day_id")
      .notNull()
      .references(() => menuDays.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    currentRoundId: uuid("current_round_id")
      .notNull()
      .references(() => orderRounds.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull().default("active"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One effective order per person per day — the structural guard against
  // double-billing after a re-poll.
  (table) => [uniqueIndex("orders_day_person_key").on(table.menuDayId, table.personId)],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPricePaiseSnapshot: bigint("unit_price_paise_snapshot", { mode: "number" }).notNull(),
    itemNameSnapshot: text("item_name_snapshot").notNull(),
  },
  (table) => [uniqueIndex("order_lines_order_item_key").on(table.orderId, table.menuItemId)],
);

export const orderRevisions = pgTable(
  "order_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderRoundId: uuid("order_round_id").references(() => orderRounds.id, {
      onDelete: "set null",
    }),
    lines: jsonb("lines").notNull(),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
    changedBy: uuid("changed_by").references(() => people.id, { onDelete: "set null" }),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("order_revisions_order_idx").on(table.orderId, table.createdAt)],
);

export const cancellationRequests = pgTable(
  "cancellation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    reason: text("reason"),
    status: cancellationStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => people.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("cancellation_status_idx").on(table.status, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export const settlementRuns = pgTable(
  "settlement_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: settlementStatusEnum("status").notNull().default("preview"),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull().default(0),
    providerBillPaise: bigint("provider_bill_paise", { mode: "number" }),
    notes: text("notes"),
    generatedBy: uuid("generated_by").references(() => people.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => [index("settlement_runs_period_idx").on(table.periodStart, table.periodEnd)],
);

export const settlementLines = pgTable(
  "settlement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementRunId: uuid("settlement_run_id")
      .notNull()
      .references(() => settlementRuns.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    markedBy: uuid("marked_by").references(() => people.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("settlement_lines_run_person_key").on(table.settlementRunId, table.personId),
    index("settlement_lines_person_idx").on(table.personId),
  ],
);

export const settledDays = pgTable(
  "settled_days",
  {
    settlementRunId: uuid("settlement_run_id")
      .notNull()
      .references(() => settlementRuns.id, { onDelete: "cascade" }),
    menuDayId: uuid("menu_day_id")
      .notNull()
      .references(() => menuDays.id, { onDelete: "restrict" }),
  },
  // A day belongs to at most one committed run: no double-billing, and gaps
  // are detectable.
  (table) => [uniqueIndex("settled_days_one_run_per_day").on(table.menuDayId)],
);

// ---------------------------------------------------------------------------
// Push and audit
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    isActive: boolean("is_active").notNull().default(true),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("push_subscriptions_person_idx").on(table.personId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_entity_idx").on(table.entityType, table.entityId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const peopleRelations = relations(people, ({ many }) => ({
  orders: many(orders),
  sessions: many(sessions),
}));

export const menuDaysRelations = relations(menuDays, ({ many }) => ({
  rounds: many(orderRounds),
  items: many(menuItems),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  menuDay: one(menuDays, { fields: [orders.menuDayId], references: [menuDays.id] }),
  person: one(people, { fields: [orders.personId], references: [people.id] }),
  lines: many(orderLines),
}));

export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
  menuItem: one(menuItems, { fields: [orderLines.menuItemId], references: [menuItems.id] }),
}));

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type MenuDay = typeof menuDays.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type SettlementRun = typeof settlementRuns.$inferSelect;
export type AccountStatus = (typeof accountStatusEnum.enumValues)[number];
