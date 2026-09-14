# ProEvent — לוגו

סמל: ברק בגרדיאנט `#7c5cff → #d946ef` (135°). לוגוטייפ: "proevent" ב-Manrope 700, letter-spacing -0.03em; "pro" בצבע הטקסט, "event" ב-`#d2cefd` (על כהה) / `#5d5294` (על בהיר).
טאגליין: **CRM שעובד בשבילך**

## קבצים
- `mark-gradient.svg` / `mark-gradient-512.png` — הסמל הראשי
- `mark-mono-accent.svg`, `mark-mono-white.svg`, `mark-mono-black.svg` — חד-גוני להדפסה/רקעים
- `logo-horizontal-dark.svg`, `logo-horizontal-light.svg` — סמל + לוגוטייפ
- `logo-with-tagline-dark.svg` — עם הטאגליין
- `favicon.svg`, `favicon-64.png` — פאביקון
- `app-icon.svg`, `app-icon-512.png` — אייקון אפליקציה / פרופיל וואטסאפ

## שימוש באתר (ניווט)
```html
<a href="/" style="display:flex;align-items:center;gap:8px;direction:ltr;text-decoration:none;color:inherit">
  <img src="/logo/mark-gradient.svg" width="26" height="26" alt="">
  <span style="font-family:'Manrope',sans-serif;font-weight:700;font-size:21px;letter-spacing:-0.03em">pro<span style="color:#d2cefd">event</span></span>
</a>
```
גרסת הירו (זוהרת): ברק 44px עם `filter:drop-shadow(0 0 10px rgba(168,85,247,.7))`, ו-"event" בגרדיאנט טקסט `linear-gradient(90deg,#a78bfa,#e879f9)` + `background-clip:text; color:transparent`.

הערה: ה-SVG של הלוגוטייפ תלוי בפונט Manrope (Google Fonts, 700). לשימוש מחוץ לאתר — להמיר ל-outlines.
