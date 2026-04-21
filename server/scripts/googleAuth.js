require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH = path.join(__dirname, '../google_token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
];

async function main() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_id, client_secret, redirect_uris } = creds.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3333/callback'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n✅ Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');

  // Local server to catch the redirect
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const qs = url.parse(req.url, true).query;
      if (!qs.code) { res.end('No code'); return; }

      res.end('<h2>✅ Authorization successful! You can close this tab.</h2>');
      server.close();

      const { tokens } = await oauth2Client.getToken(qs.code);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('✅ Token saved to server/google_token.json');
      resolve();
    });
    server.listen(3333);
  });
}

main().catch(console.error);
