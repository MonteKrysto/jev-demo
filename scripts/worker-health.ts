import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
});
try {
  const result = await pool.query(
    "select count(*)::integer as count from worker_heartbeats where last_seen > now() - interval '30 seconds'",
  );
  if (!result.rows[0].count) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
