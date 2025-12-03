CREATE TABLE "dlq_items" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"node_id" text NOT NULL,
	"job_id" text,
	"job_data" jsonb,
	"error" text NOT NULL,
	"failed_at" timestamp NOT NULL,
	"attempts_made" integer NOT NULL,
	"retried" boolean DEFAULT false,
	"retried_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "state_change_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "state_change_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"execution_id" text NOT NULL,
	"change_type" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"change_notes" text
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"current_version_id" integer,
	CONSTRAINT "workflows_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
DROP INDEX "execution_id_idx";--> statement-breakpoint
DROP INDEX "workflow_id_idx";--> statement-breakpoint
DROP INDEX "parent_execution_id_idx";--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "workflow_version_id" integer;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "timeout_at" timestamp;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "timed_out" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "dlq_items" ADD CONSTRAINT "dlq_items_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dlq_execution_id_idx" ON "dlq_items" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "dlq_failed_at_idx" ON "dlq_items" USING btree ("failed_at");--> statement-breakpoint
CREATE INDEX "dlq_retried_idx" ON "dlq_items" USING btree ("retried");--> statement-breakpoint
CREATE INDEX "audit_execution_id_idx" ON "state_change_audit" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "audit_change_type_idx" ON "state_change_audit" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "audit_changed_at_idx" ON "state_change_audit" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "workflow_version_idx" ON "workflow_versions" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflows_workflow_id_idx" ON "workflows" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflows_is_active_idx" ON "workflows" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_execution_id_idx" ON "executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "executions_workflow_id_idx" ON "executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "executions_workflow_version_id_idx" ON "executions" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "executions_parent_execution_id_idx" ON "executions" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "executions_timeout_at_idx" ON "executions" USING btree ("timeout_at");