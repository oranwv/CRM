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

async function downloadFile(fileId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const { name, mimeType } = meta.data;

  const chunks = [];
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    res.data.on('data', chunk => chunks.push(chunk));
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });

  return { buffer: Buffer.concat(chunks), mimeType, name };
}

module.exports = { listFilesInFolder, getFileMeta, downloadFile };
