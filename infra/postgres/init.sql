-- Disposable local/CI infrastructure only. Never apply these credentials to production.
CREATE ROLE common_saas_migrator LOGIN PASSWORD 'local_phase1' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE common_saas_web LOGIN PASSWORD 'local_phase1' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE common_saas_worker LOGIN PASSWORD 'local_phase1' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE common_saas_identity LOGIN PASSWORD 'local_phase1' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE common_saas OWNER common_saas_migrator;
CREATE DATABASE common_saas_fga;
\connect common_saas
REVOKE ALL ON DATABASE common_saas FROM PUBLIC;
GRANT CONNECT ON DATABASE common_saas TO common_saas_migrator, common_saas_web, common_saas_worker, common_saas_identity;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
