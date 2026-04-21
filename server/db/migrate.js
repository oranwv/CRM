require('dotenv').config();
const pool = require('./pool');

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  password_hash TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'sales' CHECK (role IN ('admin','sales','production')),
  phone VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  event_date DATE,
  event_type VARCHAR(100),
  guest_count VARCHAR(50),
  budget VARCHAR(100),
  source VARCHAR(50) DEFAULT 'manual' CHECK (source IN ('website_popup','website_form','call_event','telekol','whatsapp','facebook','instagram','manual')),
  stage VARCHAR(30) DEFAULT 'new' CHECK (stage IN ('new','contacted','meeting','offer_sent','negotiation','contract_sent','deposit','production','lost')),
  lost_reason VARCHAR(100),
  lost_reason_text TEXT,
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal','hot','urgent')),
  assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_interactions (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('call','meeting','note','email','whatsapp','facebook','instagram')),
  direction VARCHAR(10) DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
  body TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('whatsapp','facebook','instagram')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
  body TEXT,
  external_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  remind_via VARCHAR(10) DEFAULT 'app' CHECK (remind_via IN ('app','whatsapp')),
  completed_at TIMESTAMPTZ,
  assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  file_type VARCHAR(50),
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE CASCADE,
  google_event_id TEXT,
  type VARCHAR(20) CHECK (type IN ('option','confirmed')),
  event_date DATE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
})();
