const { google } = require('googleapis');
const { getAuth } = require('./gmailService');

async function listFilesInFolder(folderId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'name',
    pageSize: 200,
  });
  return res.data.files || [];
}

async function getFileMeta(fileId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType,size' });
  return meta.data;
}

const EXPORT_MIME = {
  'application/vnd.google-apps.document':     { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet':  { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
};

async function downloadFile(fileId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  let { name, mimeType } = meta.data;

  const exportInfo = EXPORT_MIME[mimeType];
  const chunks = [];

  if (exportInfo) {
    const res = await drive.files.export({ fileId, mimeType: exportInfo.mime }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      res.data.on('data', chunk => chunks.push(chunk));
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });
    mimeType = exportInfo.mime;
    if (!name.endsWith(exportInfo.ext)) name += exportInfo.ext;
  } else {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      res.data.on('data', chunk => chunks.push(chunk));
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });
  }

  return { buffer: Buffer.concat(chunks), mimeType, name };
}

async function syncDriveFolders() {
  const pool = require('../db/pool');
  const { uploadBuffer } = require('./storageService');

  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drive_cached_files (
      id SERIAL PRIMARY KEY,
      folder_id TEXT NOT NULL,
      folder_name TEXT,
      drive_file_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mime_type TEXT,
      size BIGINT,
      drive_modified_time TEXT,
      stored_name TEXT,
      public_url TEXT,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'drive_folders'`);
  const folders = rows[0]?.value ? JSON.parse(rows[0].value) : [];
  if (!folders.length) return;

  for (const folder of folders) {
    try {
      const driveFiles = await listFilesInFolder(folder.id);
      const driveIds = driveFiles.map(f => f.id);

      for (const f of driveFiles) {
        try {
          const { rows: existing } = await pool.query(
            'SELECT drive_modified_time FROM drive_cached_files WHERE drive_file_id = $1',
            [f.id]
          );
          if (existing[0]?.drive_modified_time === f.modifiedTime) continue;

          if (f.mimeType?.startsWith('application/vnd.google-apps.') && !EXPORT_MIME[f.mimeType]) continue;

          const { buffer, mimeType } = await downloadFile(f.id);
          const { url, storedName } = await uploadBuffer(buffer, f.name, mimeType);

          await pool.query(`
            INSERT INTO drive_cached_files
              (folder_id, folder_name, drive_file_id, name, mime_type, size, drive_modified_time, stored_name, public_url, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
            ON CONFLICT (drive_file_id) DO UPDATE SET
              name = EXCLUDED.name, mime_type = EXCLUDED.mime_type, size = EXCLUDED.size,
              drive_modified_time = EXCLUDED.drive_modified_time,
              stored_name = EXCLUDED.stored_name, public_url = EXCLUDED.public_url, synced_at = NOW()
          `, [folder.id, folder.name, f.id, f.name, mimeType, f.size || null, f.modifiedTime, storedName, url]);

          console.log(`[Drive sync] Cached: ${f.name}`);
        } catch (fileErr) {
          console.error(`[Drive sync] skipping "${f.name}": ${fileErr.message}`);
        }
      }

      // Remove DB entries for files deleted from Drive
      if (driveIds.length > 0) {
        await pool.query(
          `DELETE FROM drive_cached_files WHERE folder_id = $1 AND drive_file_id <> ALL($2::text[])`,
          [folder.id, driveIds]
        );
      } else {
        await pool.query('DELETE FROM drive_cached_files WHERE folder_id = $1', [folder.id]);
      }
    } catch (err) {
      console.error(`[Drive sync] folder ${folder.id} error:`, err.message);
    }
  }
}

module.exports = { listFilesInFolder, getFileMeta, downloadFile, syncDriveFolders };
