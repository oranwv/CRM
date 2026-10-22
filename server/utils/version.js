// Running version: package.json version + build metadata (git commit, build time).
// Railway injects RAILWAY_GIT_COMMIT_SHA; BUILD_TIME is written by the Dockerfile at build time.
const fs = require('fs');
const path = require('path');

const pkg = require('../../package.json');
let buildTime = process.env.BUILD_TIME || null;
try { if (!buildTime) buildTime = fs.readFileSync(path.join(__dirname, '../../.build-time'), 'utf8').trim(); } catch {}
const commit = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7) || null;

function readChangelog(limit = 5) {
  try {
    const md = fs.readFileSync(path.join(__dirname, '../../CHANGELOG.md'), 'utf8');
    const parts = md.split(/^## /m).slice(1);
    return parts.slice(0, limit).map(p => {
      const [head, ...body] = p.trim().split('\n');
      const m = head.match(/^(\S+)\s*—\s*(.+)$/);
      return { version: m ? m[1] : head, date: m ? m[2].trim() : '', notes: body.map(l => l.replace(/^- /, '').trim()).filter(Boolean) };
    });
  } catch { return []; }
}

function versionInfo() {
  return { version: pkg.version, commit, buildTime, startedAt: STARTED_AT };
}
const STARTED_AT = new Date().toISOString();

function versionTextForAssistant() {
  const v = versionInfo();
  const log = readChangelog(5);
  const lines = log.map(e => `- ${e.version} (${e.date}): ${e.notes.join(' | ')}`);
  return `## גרסת התוכנה\nגרסה נוכחית: ${v.version}${v.commit ? ` (commit ${v.commit})` : ''}${v.buildTime ? `, נבנתה ${v.buildTime}` : ''}.\nגרסאות אחרונות:\n${lines.join('\n')}`;
}

module.exports = { versionInfo, readChangelog, versionTextForAssistant };
