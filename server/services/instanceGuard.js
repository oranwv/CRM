// Phase 137 — one installation per business. INSTANCE_ID (env) names this installation; the same
// id is stamped into its own database (settings.instance_id) on the first boot. If a server is
// ever started with another business's DATABASE_URL (a copy-paste mistake in the hosting
// settings), the ids differ and the server stops instead of serving the wrong business's data.
// Installations without INSTANCE_ID (Sharviya, before its move) are left exactly as they were.
const pool = require('../db/pool');

async function run() {
  const id = (process.env.INSTANCE_ID || '').trim();
  if (!id) return;
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'instance_id'");
    if (!rows.length) {
      await pool.query("INSERT INTO settings (key, value) VALUES ('instance_id', $1) ON CONFLICT (key) DO NOTHING", [id]);
      console.log(`[Instance] database stamped as "${id}"`);
    } else if (rows[0].value !== id) {
      console.error(`[Instance] STOPPING: this server is "${id}" but its database belongs to "${rows[0].value}". Check DATABASE_URL.`);
      process.exit(1);
    }
    // Supabase serves every table without row level security through its public REST API.
    // The CRM connects as the table owner (not affected by RLS), so switch it on everywhere.
    await pool.query(`
      DO $$ DECLARE t record; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
        END LOOP;
      END $$;`);
  } catch (err) {
    console.error('[Instance] check error:', err.message);
  }
}

module.exports = { run };
