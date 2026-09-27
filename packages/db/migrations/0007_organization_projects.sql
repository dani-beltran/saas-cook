-- Reviewed retirement: Organization -> Projects. Drain all old application/worker
-- processes before this atomic migration, then run the supported model upgrade.
-- Policy: retire the entire inherited Workspace access path (positive AND denied
-- grants); preserve all direct Project grants and organization administration.
-- No inherited permission is converted into Project or Organization authority.
-- Existing historical audit/outbox payloads and Project command hashes stay intact.
-- Drizzle generated 0007_snapshot.json; SQL order/cleanup reviewed manually.
LOCK TABLE tenancy.organizations, tenancy.authorization_revisions,
 tenancy.resource_registry, tenancy.workspaces, tenancy.projects,
 tenancy.resource_grants, tenancy.resource_operations,
 tenancy.service_accounts, tenancy.api_keys,
 tenancy.capacity_buckets, tenancy.capacity_reservations
 IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- Record the access impact before deleting retired operational data. This is an
-- append-only migration event, not a rewrite or replay of historical domain events.
WITH affected AS (
 SELECT o.id AS organization_id,
  (SELECT count(*) FROM tenancy.workspaces w WHERE w.organization_id=o.id) AS workspaces,
  (SELECT count(*) FROM tenancy.projects p WHERE p.organization_id=o.id AND p.workspace_id IS NOT NULL) AS detached_projects,
  (SELECT count(*) FROM tenancy.resource_grants g JOIN tenancy.resource_registry r ON r.organization_id=g.organization_id AND r.id=g.resource_id WHERE g.organization_id=o.id AND r.resource_type='workspace') AS retired_grants,
  (SELECT count(*) FROM tenancy.service_accounts s WHERE s.organization_id=o.id AND EXISTS (SELECT 1 FROM unnest(s.capabilities) scope WHERE scope LIKE 'workspace:%' OR scope='project:move')) AS changed_service_accounts,
  (SELECT count(*) FROM tenancy.api_keys k WHERE k.organization_id=o.id AND EXISTS (SELECT 1 FROM unnest(k.scopes) scope WHERE scope LIKE 'workspace:%' OR scope='project:move')) AS changed_api_keys,
  (SELECT count(*) FROM tenancy.capacity_buckets b WHERE b.organization_id=o.id AND b.feature ~ '^workspaces?([.:]|$)') AS retired_capacity_buckets,
  (SELECT count(*) FROM tenancy.resource_operations op WHERE op.organization_id=o.id AND (op.operation LIKE 'workspace.%' OR op.operation='project.move' OR EXISTS (SELECT 1 FROM tenancy.resource_registry r WHERE r.organization_id=op.organization_id AND r.id=op.resource_id AND r.resource_type='workspace') OR EXISTS (SELECT 1 FROM tenancy.resource_grants g JOIN tenancy.resource_registry r ON r.organization_id=g.organization_id AND r.id=g.resource_id WHERE g.organization_id=op.organization_id AND g.id=op.resource_id AND r.resource_type='workspace'))) AS retired_receipts
 FROM tenancy.organizations o
), audit AS (
 INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes)
 SELECT gen_random_uuid(), organization_id, 'system:migration:0007',
  'migration.workspace_retired', organization_id::text,
  to_jsonb(affected)-'organization_id' || '{"accessPolicy":"retire-inherited-access","resharing":"explicit-project-grants-required"}'::jsonb
 FROM affected
 WHERE workspaces+detached_projects+retired_grants+changed_service_accounts+changed_api_keys+retired_capacity_buckets+retired_receipts>0
 RETURNING id,organization_id,action,changes
)
INSERT INTO tenancy.outbox_events(id,organization_id,type,payload)
 SELECT id,organization_id,action,changes FROM audit;
--> statement-breakpoint
-- A Project create receipt uses the old input hash, including its former parent.
-- Keep it unchanged: retries with the new contract conflict instead of creating a
-- duplicate or claiming an old request with different semantics was identical.
DELETE FROM tenancy.resource_operations op
 WHERE op.operation LIKE 'workspace.%' OR op.operation='project.move'
 OR EXISTS (SELECT 1 FROM tenancy.resource_registry r WHERE r.organization_id=op.organization_id AND r.id=op.resource_id AND r.resource_type='workspace')
 OR EXISTS (SELECT 1 FROM tenancy.resource_grants g JOIN tenancy.resource_registry r ON r.organization_id=g.organization_id AND r.id=g.resource_id WHERE g.organization_id=op.organization_id AND g.id=op.resource_id AND r.resource_type='workspace');
--> statement-breakpoint
DELETE FROM tenancy.resource_grants g USING tenancy.resource_registry r
 WHERE r.organization_id=g.organization_id AND r.id=g.resource_id AND r.resource_type='workspace';
--> statement-breakpoint
-- Retire obsolete scopes without broadening the surviving Project scopes. Empty
-- capabilities/scopes remain empty and cannot authorize an endpoint.
UPDATE tenancy.service_accounts s SET capabilities=ARRAY(
 SELECT scope FROM unnest(s.capabilities) WITH ORDINALITY AS value(scope,position)
 WHERE scope NOT LIKE 'workspace:%' AND scope<>'project:move' ORDER BY position
),version=version+1,updated_at=clock_timestamp()
 WHERE EXISTS (SELECT 1 FROM unnest(s.capabilities) scope WHERE scope LIKE 'workspace:%' OR scope='project:move');
--> statement-breakpoint
UPDATE tenancy.api_keys k SET scopes=ARRAY(
 SELECT scope FROM unnest(k.scopes) WITH ORDINALITY AS value(scope,position)
 WHERE scope NOT LIKE 'workspace:%' AND scope<>'project:move' ORDER BY position
)
 WHERE EXISTS (SELECT 1 FROM unnest(k.scopes) scope WHERE scope LIKE 'workspace:%' OR scope='project:move');
--> statement-breakpoint
DELETE FROM tenancy.capacity_reservations r USING tenancy.capacity_buckets b
 WHERE b.organization_id=r.organization_id AND b.id=r.bucket_id AND b.feature ~ '^workspaces?([.:]|$)';
--> statement-breakpoint
DELETE FROM tenancy.capacity_buckets WHERE feature ~ '^workspaces?([.:]|$)';
--> statement-breakpoint
-- Advance both source counters atomically without changing their difference,
-- model binding, readiness, or recovery epoch. The upgrade command owns models.
UPDATE tenancy.authorization_revisions SET desired_revision=desired_revision+1,
 applied_revision=applied_revision+1,updated_at=clock_timestamp()
 WHERE organization_id IN (
 SELECT organization_id FROM tenancy.audit_events
 WHERE actor_id='system:migration:0007' AND action='migration.workspace_retired'
 );
--> statement-breakpoint
-- Explicit dependency order; never CASCADE into unrelated custom schema objects.
ALTER TABLE tenancy.projects DROP CONSTRAINT projects_organization_id_workspace_id_workspaces_organization_id_id_fk;
--> statement-breakpoint
DROP INDEX tenancy.projects_workspace;
--> statement-breakpoint
ALTER TABLE tenancy.projects DROP COLUMN workspace_id;
--> statement-breakpoint
ALTER TABLE tenancy.resource_registry DROP CONSTRAINT resource_registry_organization_id_parent_id_resource_registry_organization_id_id_fk;
--> statement-breakpoint
ALTER TABLE tenancy.resource_registry DROP CONSTRAINT resource_registry_parent_check;
--> statement-breakpoint
DROP INDEX tenancy.resource_registry_parent;
--> statement-breakpoint
ALTER TABLE tenancy.resource_registry DROP COLUMN parent_id;
--> statement-breakpoint
DROP TABLE tenancy.workspaces;
--> statement-breakpoint
DELETE FROM tenancy.resource_registry WHERE resource_type='workspace';
--> statement-breakpoint
ALTER TABLE tenancy.resource_registry DROP CONSTRAINT resource_registry_type;
--> statement-breakpoint
ALTER TABLE tenancy.resource_registry ADD CONSTRAINT resource_registry_type CHECK (resource_type = 'project');
