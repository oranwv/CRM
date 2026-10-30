// Public content pages for the marketing site (2026-10-21) — blog posts and, later,
// feature / audience pages. Each page is a Markdown file under server/landing/content/
// with a small front-matter block; this module renders it into the landing page's
// Nocturne look (same nav, footer and demo form as index.html) and serves:
//   GET /blog            — list of posts, newest first
//   GET /blog/:slug      — one post (Article + Breadcrumb JSON-LD, canonical, OG)
//   GET /sitemap.xml     — built from the landing page + every published page
// No dependencies: a deliberately small Markdown subset (headings, paragraphs, bold,
// italic, links, bullet / numbered lists, blockquotes, horizontal rules).
// Files are read once at boot; restart the server (deploy) to pick up new posts.

const fs   = require('fs');
const path = require('path');

const SITE     = 'https://www.proevent.co.il';
const SITE_NAME = 'ProEvent';
const contentDir = path.join(__dirname, 'content');

// ---------- front matter + markdown ----------

function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: m[2] };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  let t = esc(text);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const ext = /^https?:\/\//.test(href) && !href.startsWith(SITE);
    return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

function markdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const flushPara = (buf) => { if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; };
  let para = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(para); i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(para);
      const lvl = m[1].length;
      const text = m[2].trim();
      const id = text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(para); out.push('<hr class="hr">'); i++; continue; }
    if (/^>\s?/.test(line)) {
      flushPara(para);
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${markdown(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushPara(para);
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i].replace(re, '');
        i++;
        // continuation lines (indented) belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
        item = item.replace(/^\[ \]\s+/, '☐ ').replace(/^\[x\]\s+/i, '☑ ');
        items.push(`<li>${inline(item)}</li>`);
      }
      const check = !ordered && items.every(it => /^<li>[☐☑]/.test(it));
      out.push(`<${ordered ? 'ol' : 'ul'}${check ? ' class="pg-check"' : ''}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara(para);
  return out.join('\n');
}

// ---------- content loading ----------

function readDir(sub) {
  const dir = path.join(contentDir, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const { meta, body } = parseFrontMatter(raw);
      const slug = (meta.slug || f.replace(/\.md$/, '')).trim();
      const words = body.split(/\s+/).filter(Boolean).length;
      return {
        slug, meta, body,
        html: markdown(body),
        title: meta.title || slug,
        description: meta.description || '',
        date: meta.date || '',
        updated: meta.updated || meta.date || '',
        author: meta.author || 'צוות ProEvent',
        readMinutes: Math.max(1, Math.round(words / 200)),
        draft: /^(true|yes|1)$/i.test(meta.draft || ''),
      };
    })
    .filter(p => !p.draft)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

let posts = [];
function load() {
  posts = readDir('blog');
  console.log(`[Landing] ${posts.length} blog post(s) loaded`);
}

// ---------- layout ----------

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

const PAGE_CSS = `
body { margin:0; direction:rtl; font-family:"Inter","Heebo",system-ui,sans-serif; background:#161826; color:#e9e9ed; }
h1,h2,h3,h4 { font-family:"Inter","Heebo",system-ui,sans-serif; }
a { color: var(--color-accent); } a:hover { color: var(--color-accent-300); }
.navlink:hover { color: var(--color-accent-300) !important; }
.lp-burger { display:none; background:none; border:1px solid var(--color-divider); color:var(--color-text); border-radius:8px; width:38px; height:38px; font-size:22px; align-items:center; justify-content:center; cursor:pointer; margin-inline-start:auto; }
.pg-wrap { max-width:760px; margin:0 auto; padding:56px 24px 40px; }
.pg-kicker { font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--color-accent-400); margin-bottom:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.pg-kicker a { color:inherit; text-decoration:none; } .pg-kicker a:hover { color:var(--color-accent-300); }
.pg-title { font-size:40px; line-height:1.15; text-wrap:pretty; margin-bottom:14px; }
.pg-lead { font-size:19px; line-height:1.6; color:var(--color-neutral-300); margin-bottom:22px; }
.pg-meta { display:flex; gap:16px; flex-wrap:wrap; font-size:13px; color:var(--color-neutral-500); padding:16px 0; border-top:1px solid var(--color-divider); border-bottom:1px solid var(--color-divider); margin-bottom:36px; }
.pg-meta span { display:flex; align-items:center; gap:6px; }
.pg-body { font-size:17px; line-height:1.8; color:var(--color-neutral-200); }
.pg-body h2 { font-size:27px; margin:44px 0 12px; color:var(--color-text); }
.pg-body h3 { font-size:21px; margin:32px 0 10px; color:var(--color-text); }
.pg-body p { margin:0 0 18px; }
.pg-body ul, .pg-body ol { padding-inline-start:26px; margin:0 0 18px; }
.pg-body li { margin-bottom:8px; }
.pg-body ul.pg-check { list-style:none; padding-inline-start:4px; }
.pg-body blockquote { margin:24px 0; padding:16px 22px; border-inline-start:3px solid var(--color-accent); background:color-mix(in srgb, var(--color-accent) 8%, transparent); border-radius:0 8px 8px 0; color:var(--color-neutral-200); }
.pg-body blockquote p:last-child { margin-bottom:0; }
.pg-body strong { color:var(--color-text); }
.pg-body code { font-size:0.9em; background:var(--color-surface); padding:1px 6px; border-radius:4px; }
.pg-body hr.hr { margin:36px 0; }
.pg-cta { max-width:1180px; margin:0 auto; padding:24px 40px 96px; }
.pg-list { max-width:900px; margin:0 auto; padding:56px 24px 80px; }
.pg-card { display:block; text-decoration:none; color:inherit; padding:26px 28px; margin-bottom:16px; }
.pg-card:hover { border-color:var(--color-accent-600); color:inherit; }
.pg-card h2 { font-size:23px; margin:6px 0 10px; text-wrap:pretty; }
.pg-card p { color:var(--color-neutral-400); line-height:1.65; margin:0 0 12px; font-size:15px; }
.pg-card .pg-cardmeta { font-size:13px; color:var(--color-neutral-500); display:flex; gap:14px; }
.pg-more { max-width:760px; margin:0 auto; padding:0 24px 24px; }
.pg-more h3 { font-size:16px; letter-spacing:0.04em; color:var(--color-neutral-500); margin-bottom:12px; }
.pg-more a { display:block; padding:12px 16px; margin-bottom:8px; text-decoration:none; color:var(--color-neutral-200); }
.pg-more a:hover { color:var(--color-accent-300); }
@media (max-width: 900px) {
  .lp-nav { padding:14px 20px !important; gap:12px !important; flex-wrap:wrap; }
  .lp-burger { display:inline-flex; }
  .lp-navcta { margin-inline-start:0 !important; }
  .lp-navlinks { display:none !important; width:100%; flex-direction:column; gap:12px !important; margin:6px 0 0 !important; padding-top:12px; border-top:1px solid var(--color-divider); }
  .lp-nav.open .lp-navlinks { display:flex !important; }
  .pg-title { font-size:31px; }
  .pg-lead { font-size:17px; }
  .pg-body { font-size:16px; }
  .pg-cta { padding:16px 20px 64px; }
  .pg-cta > .card { padding:28px 20px !important; }
  footer { padding-left:20px !important; padding-right:20px !important; }
}
@media (max-width: 480px) {
  .lp-navcta { width:100%; justify-content:space-between; }
  .lp-navcta .btn { flex:1; justify-content:center; text-align:center; }
}`;

function nav() {
  return `
  <nav class="lp-nav" style="display:flex;align-items:center;gap:24px;padding:18px 40px;border-bottom:1px solid var(--color-divider);position:sticky;top:0;background:color-mix(in srgb, var(--color-bg) 88%, transparent);backdrop-filter:blur(10px);z-index:50">
    <a href="/" class="lp-logo" style="display:flex;align-items:center;gap:8px;direction:ltr;text-decoration:none;color:inherit">
      <img src="/logo/mark-gradient.svg" width="26" height="26" alt="ProEvent">
      <span style="font-family:'Manrope',sans-serif;font-weight:700;font-size:21px;letter-spacing:-0.03em">pro<span style="color:#d2cefd">event</span></span>
    </a>
    <div class="lp-navlinks" style="display:flex;gap:22px;font-size:14px;color:var(--color-neutral-400);margin-inline-start:24px">
      <a href="/#features" style="color:inherit;text-decoration:none" class="navlink">המערכת</a>
      <a href="/#ai" style="color:inherit;text-decoration:none" class="navlink">AI מכירות</a>
      <a href="/#finance" style="color:inherit;text-decoration:none" class="navlink">כספים</a>
      <a href="/#management" style="color:inherit;text-decoration:none" class="navlink">ניהול עובדים</a>
      <a href="/#compare" style="color:inherit;text-decoration:none" class="navlink">השוואה</a>
      <a href="/blog" style="color:var(--color-accent-300);text-decoration:none" class="navlink">מאמרים</a>
    </div>
    <button class="lp-burger" type="button" aria-label="תפריט" aria-expanded="false" onclick="var n=document.querySelector('.lp-nav');n.classList.toggle('open');this.setAttribute('aria-expanded',n.classList.contains('open'))"><span aria-hidden="true">☰</span></button>
    <div class="lp-navcta" style="display:flex;align-items:center;gap:10px;margin-inline-start:auto">
      <a href="/login" class="btn btn-ghost" style="display:inline-flex;align-items:center;gap:6px"><i class="ph ph-sign-in"></i>כניסה למערכת</a>
      <a href="#demo" class="btn btn-primary">השאירו פרטים</a>
    </div>
  </nav>`;
}

function footer() {
  return `
  <footer style="border-top:1px solid var(--color-divider);padding:28px 40px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--color-neutral-500)">
    <div style="display:flex;align-items:center;gap:8px"><img src="/logo/mark-gradient.svg" width="16" height="16" alt=""><span>ProEvent · CRM לעולם האירועים</span></div>
    <div style="display:flex;gap:18px;flex-wrap:wrap"><a href="/blog" style="color:inherit;text-decoration:none">מאמרים</a><a href="/#demo" style="color:inherit;text-decoration:none">קבעו דמו</a></div>
    <div>© 2026 ProEvent. כל הזכויות שמורות.</div>
  </footer>`;
}

function demoCta() {
  return `
  <section id="demo" class="pg-cta">
    <div class="card elev-md" style="padding:48px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:40px;align-items:center">
      <div>
        <h2 style="text-wrap:pretty">רוצים לראות את זה על האולם שלכם?</h2>
        <p style="color:var(--color-neutral-400);line-height:1.7">השאירו פרטים ונחזור אליכם לתיאום הדגמה קצרה — עם הלידים, האירועים והתהליכים שלכם, לא של מצגת.</p>
        <div style="display:flex;gap:18px;font-size:13px;color:var(--color-neutral-500);margin-top:16px;flex-wrap:wrap">
          <span style="display:flex;gap:6px;align-items:center"><i class="ph ph-clock" style="color:var(--color-accent-400)"></i>30 דקות</span>
          <span style="display:flex;gap:6px;align-items:center"><i class="ph ph-hand-palm" style="color:var(--color-accent-400)"></i>ללא התחייבות</span>
        </div>
      </div>
      <div id="demo-form-wrap">
        <form id="demo-form" novalidate style="display:grid;gap:14px">
          <div class="field"><label>שם מלא</label><input class="input" name="name" required placeholder="ישראל ישראלי"></div>
          <div class="field"><label>טלפון</label><input class="input" name="phone" required type="tel" placeholder="050-0000000"></div>
          <div class="field"><label>שם העסק</label><input class="input" name="business" placeholder="אולם / חברת הפקה"></div>
          <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none" aria-hidden="true">
          <button class="btn btn-primary" type="submit" style="font-size:16px;padding:12px">קבעו לי דמו ←</button>
          <p id="demo-error" style="margin:0;font-size:13px;color:#f4a3a3" hidden></p>
        </form>
      </div>
      <div id="demo-sent" hidden>
        <div style="text-align:center;padding:32px">
          <i class="ph ph-check-circle" style="font-size:48px;color:var(--color-accent-400)"></i>
          <h3 style="margin-top:14px">קיבלנו!</h3>
          <p style="color:var(--color-neutral-400)">נחזור אליכם עוד היום לתיאום הדמו.</p>
        </div>
      </div>
    </div>
  </section>`;
}

const DEMO_JS = `
<script>
(function () {
  var form = document.getElementById('demo-form');
  if (!form) return;
  var err = document.getElementById('demo-error');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.hidden = true;
    var fd = new FormData(form);
    var name = (fd.get('name') || '').trim(), phone = (fd.get('phone') || '').trim(), business = (fd.get('business') || '').trim();
    var digits = phone.replace(/\\D/g, '');
    if (name.length < 2) { err.textContent = 'נא למלא שם מלא'; err.hidden = false; return; }
    if (!/^(0\\d{8,9}|972\\d{8,9})$/.test(digits)) { err.textContent = 'נא למלא מספר טלפון ישראלי תקין'; err.hidden = false; return; }
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'שולח...';
    try {
      var r = await fetch('/api/public/demo-request', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, phone: phone, business: business, website: fd.get('website') || '', page: location.href, ref: document.referrer }) });
      if (!r.ok) throw new Error('bad');
      document.getElementById('demo-form-wrap').hidden = true;
      document.getElementById('demo-sent').hidden = false;
      if (window.gtag) gtag('event', 'generate_lead', { method: 'demo_form', page: location.pathname });
    } catch (e2) {
      err.textContent = 'משהו השתבש — נסו שוב בעוד רגע'; err.hidden = false;
      btn.disabled = false; btn.textContent = 'קבעו לי דמו ←';
    }
  });
})();
</script>`;

function gaSnippet() {
  const ga = process.env.GA_MEASUREMENT_ID || 'G-GJS5B65VR9'; // GA4 property "ProEvent" (2026-10-30); env var overrides
  if (!ga) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');</script>`;
}

function layout({ title, description, canonical, ogType = 'article', jsonLd = [], body }) {
  const fullTitle = `${title} | ${SITE_NAME}`;
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/site/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#161826">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo/app-icon-512.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Heebo:wght@400;500;600&family=Manrope:wght@700&display=swap">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="/site/nocturne.css">
<style>${PAGE_CSS}</style>
${jsonLd.map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')}
${gaSnippet()}
</head>
<body>
<div style="min-height:100vh;background:var(--color-bg);color:var(--color-text)">
${nav()}
${body}
${demoCta()}
${footer()}
</div>
${DEMO_JS}
</body>
</html>`;
}

// ---------- pages ----------

function postPage(post) {
  const url = `${SITE}/blog/${post.slug}`;
  const others = posts.filter(p => p.slug !== post.slug).slice(0, 3);
  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description: post.description, inLanguage: 'he',
      datePublished: post.date, dateModified: post.updated,
      author: { '@type': 'Organization', name: post.author },
      publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${SITE}/logo/app-icon-512.png` } },
      image: `${SITE}/site/og.png`,
      mainEntityOfPage: url,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ProEvent', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'מאמרים', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
  const body = `
  <article class="pg-wrap">
    <div class="pg-kicker"><a href="/blog">מאמרים</a><span>·</span><span>${esc(post.meta.topic || 'CRM לאירועים')}</span></div>
    <h1 class="pg-title">${esc(post.title)}</h1>
    ${post.description ? `<p class="pg-lead">${esc(post.description)}</p>` : ''}
    <div class="pg-meta">
      <span><i class="ph ph-user"></i>${esc(post.author)}</span>
      ${post.date ? `<span><i class="ph ph-calendar-blank"></i><time datetime="${post.date}">${fmtDate(post.date)}</time></span>` : ''}
      <span><i class="ph ph-clock"></i>${post.readMinutes} דקות קריאה</span>
    </div>
    <div class="pg-body">${post.html}</div>
  </article>
  ${others.length ? `<aside class="pg-more"><h3>עוד מאמרים</h3>${others.map(o => `<a class="card" href="/blog/${o.slug}">${esc(o.title)}</a>`).join('')}</aside>` : ''}`;
  return layout({ title: post.title, description: post.description, canonical: url, jsonLd, body });
}

function blogIndex() {
  const url = `${SITE}/blog`;
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'Blog', name: `מאמרים — ${SITE_NAME}`, url, inLanguage: 'he',
    blogPost: posts.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: p.date })),
  }];
  const body = `
  <section class="pg-list">
    <div class="pg-kicker">מאמרים</div>
    <h1 class="pg-title" style="font-size:36px">ניהול אולם אירועים, לידים וכסף — מהשטח</h1>
    <p class="pg-lead">מה שלמדנו מניהול אולם אירועים אמיתי ומבניית המערכת שמנהלת אותו: לידים, חוזים, אישורי הגעה, רווח לאירוע ו-AI למכירות.</p>
    <div style="margin-top:36px">
      ${posts.map(p => `
      <a class="card pg-card" href="/blog/${p.slug}">
        <div class="card-kicker">${esc(p.meta.topic || 'CRM לאירועים')}</div>
        <h2>${esc(p.title)}</h2>
        <p>${esc(p.description)}</p>
        <div class="pg-cardmeta">${p.date ? `<span>${fmtDate(p.date)}</span>` : ''}<span>${p.readMinutes} דקות קריאה</span></div>
      </a>`).join('')}
    </div>
  </section>`;
  return layout({ title: 'מאמרים — ניהול אולמות אירועים, לידים ו-CRM', description: 'מאמרים מהשטח על ניהול אולם אירועים: לידים מוואטסאפ, חוזים דיגיטליים, אישורי הגעה, רווח לאירוע ומערכת CRM לענף האירועים.', canonical: url, ogType: 'website', jsonLd, body });
}

function sitemap() {
  const urls = [
    { loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE}/blog`, changefreq: 'weekly', priority: '0.8', lastmod: posts[0]?.updated },
    ...posts.map(p => ({ loc: `${SITE}/blog/${p.slug}`, changefreq: 'monthly', priority: '0.7', lastmod: p.updated })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
}

// ---------- express ----------

function mount(app) {
  load();
  const send = (res, html) => { res.set('Cache-Control', 'public, max-age=300'); res.type('html').send(html); };
  app.get('/blog', (req, res) => send(res, blogIndex()));
  app.get('/blog/', (req, res) => res.redirect(301, '/blog'));
  app.get('/blog/:slug', (req, res, next) => {
    const post = posts.find(p => p.slug === req.params.slug);
    if (!post) return next();
    send(res, postPage(post));
  });
  app.get('/sitemap.xml', (req, res) => { res.set('Cache-Control', 'public, max-age=3600'); res.type('application/xml').send(sitemap()); });
}

module.exports = { mount, load, markdown, parseFrontMatter, sitemap, blogIndex, postPage, getPosts: () => posts };
