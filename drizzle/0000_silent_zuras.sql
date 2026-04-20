CREATE TABLE "email_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sender_name" text DEFAULT 'Sun Choi' NOT NULL,
	"global_bcc" text DEFAULT '',
	"subject" text DEFAULT '',
	"body" text DEFAULT '',
	"custom_field_names" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '',
	"company" text DEFAULT '',
	"bcc" text DEFAULT '',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text DEFAULT '',
	"subject" text NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_project_id_email_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."email_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_history" ADD CONSTRAINT "email_send_history_project_id_email_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."email_projects"("id") ON DELETE cascade ON UPDATE no action;