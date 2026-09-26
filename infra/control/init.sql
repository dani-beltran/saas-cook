-- Disposable independent control-plane instance. Never put this database in application backups.
CREATE ROLE common_saas_control_admin LOGIN PASSWORD 'local_phase2_control' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE common_saas_control_reader LOGIN PASSWORD 'local_phase2_control' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE common_saas_control OWNER common_saas_control_admin;
\connect common_saas_control
REVOKE ALL ON DATABASE common_saas_control FROM PUBLIC;
GRANT CONNECT ON DATABASE common_saas_control TO common_saas_control_admin, common_saas_control_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
