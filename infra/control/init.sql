-- Disposable independent control-plane instance. Never put this database in application backups.
CREATE ROLE saas_cook_control_admin LOGIN PASSWORD 'local_phase2_control' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE saas_cook_control_reader LOGIN PASSWORD 'local_phase2_control' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE saas_cook_control OWNER saas_cook_control_admin;
\connect saas_cook_control
REVOKE ALL ON DATABASE saas_cook_control FROM PUBLIC;
GRANT CONNECT ON DATABASE saas_cook_control TO saas_cook_control_admin, saas_cook_control_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
