CREATE TABLE "executions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "executions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"execution_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"parent_execution_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"initial_data" jsonb,
	"metadata" jsonb,
	CONSTRAINT "executions_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"node_id" text,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "node_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "node_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"execution_id" text NOT NULL,
	"node_id" text NOT NULL,
	"success" boolean NOT NULL,
	"data" jsonb,
	"error" text,
	"next_nodes" jsonb,
	"skipped" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "spans" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"start_time" bigint NOT NULL,
	"end_time" bigint,
	"status" text NOT NULL,
	"error" text,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_parent_execution_id_executions_execution_id_fk" FOREIGN KEY ("parent_execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_id_idx" ON "executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_id_idx" ON "executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "parent_execution_id_idx" ON "executions" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "logs_execution_id_idx" ON "logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "execution_node_idx" ON "node_results" USING btree ("execution_id","node_id");--> statement-breakpoint
CREATE INDEX "spans_execution_id_idx" ON "spans" USING btree ("execution_id");