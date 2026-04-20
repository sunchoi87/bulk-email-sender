import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export const projects = pgTable("email_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  senderName: text("sender_name").notNull().default("Sun Choi"),
  globalBcc: text("global_bcc").default(""),
  subject: text("subject").default(""),
  body: text("body").default(""),
  signature: text("signature").default(""),
  customFieldNames: jsonb("custom_field_names").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const recipients = pgTable("email_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name").default(""),
  company: text("company").default(""),
  bcc: text("bcc").default(""),
  customFields: jsonb("custom_fields")
    .$type<Record<string, string>>()
    .default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sendHistory = pgTable("email_send_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name").default(""),
  subject: text("subject").notNull(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});
