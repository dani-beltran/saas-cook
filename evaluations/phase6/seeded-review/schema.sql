-- Deliberately missing RLS, context isolation and tenant FK for evaluator calibration.
CREATE TABLE tenancy.commercial_review_items (id uuid PRIMARY KEY, organization_id uuid NOT NULL, secret text NOT NULL);
GRANT SELECT ON tenancy.commercial_review_items TO saas_cook_web;
