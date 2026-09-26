-- Disposable review exercise; never an application migration.
CREATE TABLE tenancy.review_widgets (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES tenancy.organizations(id),
 project_id uuid NOT NULL,
 title text NOT NULL,
 internal_note text NOT NULL,
 FOREIGN KEY (organization_id,project_id) REFERENCES tenancy.projects(organization_id,id)
);
GRANT SELECT ON tenancy.review_widgets TO common_saas_web;
