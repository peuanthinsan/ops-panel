# Songdee GPS Control database

`schema.sql` is the production schema for a dedicated Postgres/Neon database. It includes current device bindings plus binding history so delayed tablet uploads remain valid after a fleet reassignment.

The current `server.js` intentionally remains a local-development API backed by `data/songdee-data.json`. The production Next.js API in `web/app/api/[[...segments]]/route.js` uses these tables through the Neon serverless driver and the server-only `DATABASE_URL` environment variable. `gps_sync_samples` stores the device-GPS sample and paired FMS payload with their timestamps and sync status; report queries summarize matching samples inside each job's start/end window. `active_jobs` permits only one active job per Android device and references the current vehicle/device binding, preventing a binding change from racing a new job start.

Reapply the idempotent `schema.sql` to an existing dedicated Songdee Ops database when upgrading so the current-binding foreign key and supporting unique index are installed. The foreign key is added `NOT VALID`: it protects new writes immediately without failing deployment because of historical rows, which can be audited before a later explicit validation.

Do not apply this schema to an existing Songdee SVIS or dashboard database without confirming ownership and migration scope first.
