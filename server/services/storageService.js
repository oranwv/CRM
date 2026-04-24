const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const BUCKET = 'crm-files';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  return createClient(url, key);
}

async function uploadFile(filePath, originalName, mimetype) {
  const ext = path.extname(originalName);
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const storedName = `${unique}${ext}`;

  const buffer = fs.readFileSync(filePath);
  const supabase = getClient();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storedName, buffer, {
      contentType: mimetype || 'application/octet-stream',
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storedName);
  return { url: data.publicUrl, storedName };
}

async function deleteFile(url) {
  try {
    const marker = `/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const storedName = url.slice(idx + marker.length);
    const supabase = getClient();
    await supabase.storage.from(BUCKET).remove([storedName]);
  } catch (err) {
    console.error('[Storage] deleteFile error:', err.message);
  }
}

module.exports = { uploadFile, deleteFile };
