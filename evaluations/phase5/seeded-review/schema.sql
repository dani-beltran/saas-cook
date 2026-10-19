-- Deliberately unsafe disposable review exercise. Never an application migration.
CREATE TABLE tenancy.review_usage (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 operation_key text NOT NULL,
 quantity integer NOT NULL,
 internal_note text NOT NULL
);
GRANT SELECT, INSERT ON tenancy.review_usage TO saas_cook_web;
