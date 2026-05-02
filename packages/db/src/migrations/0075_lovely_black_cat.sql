ALTER TABLE "approvals" ADD COLUMN "source_plugin_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "source_plugin_key" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_source_plugin_id_plugins_id_fk" FOREIGN KEY ("source_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_source_plugin_idx" ON "approvals" USING btree ("source_plugin_id","status");