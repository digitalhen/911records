-- Runs once, on the first start of an empty Postgres volume (deploy/docker-compose.yml), or by hand
-- against RDS / any other Postgres 16: psql "$DATABASE_URL" -f deploy/postgres-init.sql
-- scripts/embed/load_site_pg.py grants read access on the `site` schema to this role on every load.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sept11_ro') THEN
    CREATE ROLE sept11_ro NOLOGIN;
  END IF;
END $$;
