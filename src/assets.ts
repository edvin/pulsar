/**
 * The stylesheet and the one script, served from /assets (cached; the CSP allows only these).
 * The script is progressive: every page works without it.
 */

export const CSS = String.raw`
:root{
  --accent:#7c5cff;--accent-2:color-mix(in oklab,var(--accent) 70%,#22d3ee);
  --bg:#07080f;--bg-2:#0c0e1a;--panel:rgba(20,23,40,.72);--panel-solid:#121527;--line:rgba(255,255,255,.08);--line-2:rgba(255,255,255,.14);
  --text:#eef0fb;--muted:#9097b8;--faint:#5d6487;
  --ok:#22c55e;--degraded:#eab308;--partial:#f97316;--major:#ef4444;--maint:#38bdf8;--none-bar:rgba(255,255,255,.07);
  --radius:16px;--shadow:0 1px 0 rgba(255,255,255,.04) inset,0 20px 50px -20px rgba(0,0,0,.6);
  --font:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"JetBrains Mono",Menlo,Consolas,monospace;
  color-scheme:dark
}
:root[data-theme=light]{
  --bg:#f5f6fb;--bg-2:#ffffff;--panel:rgba(255,255,255,.85);--panel-solid:#fff;--line:rgba(15,18,40,.08);--line-2:rgba(15,18,40,.14);
  --text:#0d1024;--muted:#5a6080;--faint:#9aa0bd;--none-bar:rgba(15,18,40,.07);--shadow:0 1px 2px rgba(15,18,40,.04),0 12px 32px -16px rgba(15,18,40,.18);color-scheme:light
}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){
  --bg:#f5f6fb;--bg-2:#ffffff;--panel:rgba(255,255,255,.85);--panel-solid:#fff;--line:rgba(15,18,40,.08);--line-2:rgba(15,18,40,.14);
  --text:#0d1024;--muted:#5a6080;--faint:#9aa0bd;--none-bar:rgba(15,18,40,.07);--shadow:0 1px 2px rgba(15,18,40,.04),0 12px 32px -16px rgba(15,18,40,.18);color-scheme:light}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
body.glow{background:radial-gradient(1200px 520px at 50% -180px,color-mix(in oklab,var(--accent) 34%,transparent),transparent 70%),radial-gradient(800px 400px at 100% 0,color-mix(in oklab,var(--accent-2) 14%,transparent),transparent 70%),var(--bg);background-attachment:fixed}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:920px;margin:0 auto;padding:0 20px}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:13px}.tiny{font-size:12px}.mono{font-family:var(--mono)}
h1,h2,h3,h4{letter-spacing:-.02em;line-height:1.2;margin:0}
code{font-family:var(--mono);font-size:.88em;background:var(--none-bar);border:1px solid var(--line);border-radius:6px;padding:1px 6px;overflow-wrap:anywhere}
code.copy{display:inline-block;max-width:100%;padding:6px 10px;cursor:pointer}code.copy:hover{border-color:var(--line-2)}

/* ---------- public page ---------- */
.site-head{padding:28px 0 8px}
.site-head .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
.logo{display:flex;align-items:center;gap:12px;color:var(--text);font-weight:700;font-size:18px}
.logo:hover{text-decoration:none}
.mark{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 8px 24px -8px var(--accent);font-size:17px}
.head-links{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:8px;font:600 14px/1 var(--font);padding:10px 16px;border-radius:11px;border:1px solid transparent;cursor:pointer;color:#fff;background:var(--accent);box-shadow:0 6px 20px -8px var(--accent);transition:transform .12s ease,filter .12s ease,background .12s}
.btn:hover{filter:brightness(1.08);text-decoration:none}.btn:active{transform:translateY(1px)}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line-2);box-shadow:none}.btn.ghost:hover{background:var(--none-bar)}
.btn.danger{background:var(--major);box-shadow:0 6px 20px -8px var(--major)}.btn.sm{padding:7px 12px;font-size:13px;border-radius:9px}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn{white-space:nowrap}.btn svg{width:16px;height:16px;flex:none}.btn.sm svg{width:14px;height:14px}
.hero{padding:34px 0 10px}
.hero h1{font-size:clamp(28px,4.4vw,40px);font-weight:800}
.hero p{margin:10px 0 0;color:var(--muted);max-width:640px}
.banner{position:relative;margin:26px 0 8px;padding:22px 24px;border-radius:20px;display:flex;align-items:center;gap:18px;overflow:hidden;
  background:linear-gradient(135deg,color-mix(in oklab,var(--c) 22%,var(--panel-solid)),var(--panel-solid));border:1px solid color-mix(in oklab,var(--c) 40%,transparent);box-shadow:var(--shadow)}
.banner::after{content:"";position:absolute;inset:auto -40px -80px auto;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--c) 30%,transparent),transparent 70%);pointer-events:none}
.banner .sig{position:relative;width:46px;height:46px;flex:none;border-radius:50%;background:var(--c);display:grid;place-items:center;color:#fff}
.banner .sig::before{content:"";position:absolute;inset:0;border-radius:50%;background:var(--c);animation:ping 2.4s cubic-bezier(0,0,.2,1) infinite;opacity:.5}
.banner .sig svg{position:relative;width:24px;height:24px}
.banner h2{font-size:21px;font-weight:750}.banner p{margin:3px 0 0;color:var(--muted);font-size:13px}
@keyframes ping{75%,100%{transform:scale(1.9);opacity:0}}
@media (prefers-reduced-motion:reduce){.banner .sig::before,.dot.live::after{animation:none}}
.st-none{--c:var(--ok)}.st-minor{--c:var(--degraded)}.st-major{--c:var(--partial)}.st-critical{--c:var(--major)}.st-maintenance{--c:var(--maint)}
.card{background:var(--panel);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.section{margin:30px 0}.section>h2,.section-head h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:0 0 12px}
.incident{padding:20px 22px;margin:12px 0;border-left:3px solid var(--c)}
.incident h3{font-size:18px;font-weight:700}.incident h3 a{color:var(--text)}
.incident .meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 2px}
.timeline{margin:14px 0 0;padding:0;list-style:none;position:relative}
.timeline::before{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--line-2);border-radius:2px}
.timeline li{position:relative;padding:0 0 14px 26px}.timeline li:last-child{padding-bottom:0}
.timeline li::before{content:"";position:absolute;left:1px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--panel-solid);border:2px solid var(--muted)}
.timeline li:first-child::before{border-color:var(--c);background:var(--c)}
.timeline .who{font-weight:700;font-size:13px}.timeline .when{color:var(--faint);font-size:12px;margin-left:6px}
.prose p{margin:4px 0}.prose ul{margin:4px 0;padding-left:20px}.prose h4{margin:10px 0 4px;font-size:15px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:650;padding:3px 10px 3px 8px;border-radius:999px;background:color-mix(in oklab,var(--c,var(--muted)) 14%,transparent);color:color-mix(in oklab,var(--c,var(--muted)) 85%,var(--text));border:1px solid color-mix(in oklab,var(--c,var(--muted)) 30%,transparent);white-space:nowrap}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c,var(--muted))}
.pill.plain::before{display:none}
.c-operational{--c:var(--ok)}.c-degraded_performance{--c:var(--degraded)}.c-partial_outage{--c:var(--partial)}.c-major_outage{--c:var(--major)}.c-under_maintenance{--c:var(--maint)}
.i-none{--c:var(--muted)}.i-minor{--c:var(--degraded)}.i-major{--c:var(--partial)}.i-critical{--c:var(--major)}.i-maintenance{--c:var(--maint)}
.s-resolved,.s-completed,.s-postmortem{--c:var(--ok)}.s-investigating{--c:var(--major)}.s-identified{--c:var(--partial)}.s-monitoring{--c:var(--degraded)}.s-scheduled,.s-in_progress,.s-verifying{--c:var(--maint)}
.services{overflow:hidden}
.group{border-bottom:1px solid var(--line)}.group:last-child{border-bottom:0}
.group>summary{list-style:none;cursor:pointer;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;font-weight:700}
.group>summary::-webkit-details-marker{display:none}
.group>summary .chev{transition:transform .2s;color:var(--faint)}.group[open]>summary .chev{transform:rotate(90deg)}
.svc{padding:16px 22px;border-top:1px solid var(--line)}.group>.svc:first-of-type{border-top:1px solid var(--line)}
.services>.svc:first-child{border-top:0}
.svc .top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.svc .name{font-weight:600}.svc .desc{color:var(--muted);font-size:13px;margin-top:2px}
.bars{display:flex;gap:2px;margin:12px 0 6px;height:32px;align-items:stretch}
.bar{flex:1;border-radius:3px;background:var(--c,var(--ok));opacity:.92;position:relative;min-width:2px;transition:transform .12s,opacity .12s}
.bar:hover,.bar:focus{opacity:1;transform:scaleY(1.12);outline:none}
.bar.b-none{--c:var(--none-bar)}.bar.b-operational{--c:var(--ok)}.bar.b-under_maintenance{--c:var(--maint)}.bar.b-degraded_performance{--c:var(--degraded)}.bar.b-partial_outage{--c:var(--partial)}.bar.b-major_outage{--c:var(--major)}
.bar[data-tip]:hover::after,.bar[data-tip]:focus::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);z-index:5;white-space:pre;
  background:var(--panel-solid);color:var(--text);border:1px solid var(--line-2);border-radius:10px;padding:8px 11px;font-size:12px;line-height:1.45;box-shadow:var(--shadow);pointer-events:none}
.bars-legend{display:flex;justify-content:space-between;color:var(--faint);font-size:12px}
.bars-legend .line{flex:1;height:1px;background:var(--line);margin:9px 12px}
.history-day{padding:16px 22px;border-top:1px solid var(--line)}.history-day:first-child{border-top:0}
.history-day h4{font-size:14px;color:var(--muted);font-weight:650;margin-bottom:6px}
.history-day.quiet{display:flex;justify-content:space-between;gap:12px;padding-top:12px;padding-bottom:12px}.history-day.quiet h4{margin:0;font-weight:550}.history-day.quiet .empty{margin:0}
.section-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.section-head h2{margin-bottom:12px}
.empty{color:var(--faint);font-size:14px}
.subscribe{padding:22px}.subscribe .opts{display:grid;gap:10px;grid-template-columns:repeat(4,1fr);margin-top:14px}@media (max-width:820px){.subscribe .opts{grid-template-columns:1fr 1fr}}@media (max-width:480px){.subscribe .opts{grid-template-columns:1fr}}
.opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--none-bar);color:var(--text)}
.opt:hover{border-color:var(--line-2);text-decoration:none}.opt svg{width:20px;height:20px;flex:none;color:var(--accent);margin-top:2px}
.opt b{display:block}.opt span{color:var(--muted);font-size:13px}.opt span.mark{color:#fff;flex:none}
.list-row .tiny{white-space:nowrap}
.site-foot{padding:40px 0 50px;text-align:center;color:var(--faint);font-size:13px}
.site-foot a{color:var(--muted)}
.powered{display:inline-flex;align-items:center;gap:8px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c,var(--accent));position:relative}
.dot.live::after{content:"";position:absolute;inset:0;border-radius:50%;background:inherit;animation:ping 2s cubic-bezier(0,0,.2,1) infinite}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.theme-toggle{width:38px;height:38px;border-radius:11px;border:1px solid var(--line-2);background:transparent;color:var(--text);display:grid;place-items:center;cursor:pointer}
.theme-toggle svg{width:18px;height:18px}

/* ---------- forms ---------- */
label.f{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--muted)}
.f .hint{font-weight:400;color:var(--faint);font-size:12px}
input,select,textarea{font:inherit;font-size:14px;color:var(--text);background:var(--bg-2);border:1px solid var(--line-2);border-radius:11px;padding:10px 12px;width:100%;transition:border-color .12s,box-shadow .12s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in oklab,var(--accent) 22%,transparent)}
input[type=color]{padding:3px;height:42px;cursor:pointer}input[type=checkbox],input[type=radio]{width:auto;accent-color:var(--accent)}
textarea{min-height:110px;resize:vertical;line-height:1.5}
.grid{display:grid;gap:14px;align-content:start}.g2{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.end{justify-content:flex-end}
.check{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--text);font-weight:500}

/* ---------- admin app ---------- */
.app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;min-height:100%;overflow:auto;border-right:1px solid var(--line);background:color-mix(in oklab,var(--bg-2) 60%,transparent);backdrop-filter:blur(16px);padding:18px 14px;display:flex;flex-direction:column;gap:6px}
.side .logo{padding:4px 8px 16px;font-size:16px}
.side .mark{width:32px;height:32px;border-radius:9px;font-size:14px}
.nav-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--faint);padding:14px 10px 6px}
.nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:var(--muted);font-weight:550;font-size:14px}
.nav a:hover{background:var(--none-bar);color:var(--text);text-decoration:none}
.nav a.on{background:color-mix(in oklab,var(--accent) 16%,transparent);color:var(--text)}
.nav a svg{width:18px;height:18px;flex:none}.nav .count{margin-left:auto;font-size:11px;font-weight:700;background:var(--major);color:#fff;border-radius:999px;padding:1px 7px}
.side .me{margin-top:auto;padding:12px 10px 4px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px}
.avatar{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
.main{min-width:0}
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 28px;border-bottom:1px solid var(--line);background:color-mix(in oklab,var(--bg) 80%,transparent);backdrop-filter:blur(16px)}
.crumbs{display:flex;gap:8px;align-items:center;font-size:14px;color:var(--muted);min-width:0;flex-wrap:wrap}.crumbs a{color:var(--muted)}.crumbs b{color:var(--text)}
.content{padding:28px;max-width:1120px}
.page-title{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.page-title h1{font-size:26px;font-weight:800}.page-title p{margin:6px 0 0;color:var(--muted)}
.panel{padding:20px 22px;margin-bottom:18px}.panel>h2{font-size:16px;font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.stats{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px}
.stat{padding:18px 20px}.stat .k{font-size:12px;color:var(--muted);font-weight:650;text-transform:uppercase;letter-spacing:.06em}.stat .v{font-size:28px;font-weight:800;margin-top:6px;letter-spacing:-.02em}
.stat .v small{font-size:13px;color:var(--muted);font-weight:600;margin-left:4px}
table.t{width:100%;border-collapse:collapse;font-size:14px}.t th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
.t td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:middle}.t tr:last-child td{border-bottom:0}.t tr:hover td{background:color-mix(in oklab,var(--none-bar) 60%,transparent)}
.t td a.strong{color:var(--text);font-weight:650}
.list-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid var(--line)}.list-row>.row{flex-wrap:nowrap;flex:none}.list-row>span:first-child{min-width:0}.list-row:last-child{border-bottom:0}
.flash{position:fixed;right:22px;bottom:22px;z-index:50;display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:var(--panel-solid);border:1px solid var(--line-2);box-shadow:var(--shadow);font-weight:600;font-size:14px;animation:rise .25s ease}
.flash.ok{border-color:color-mix(in oklab,var(--ok) 60%,transparent)}.flash.err{border-color:color-mix(in oklab,var(--major) 70%,transparent)}
.flash .x{background:none;border:0;color:var(--muted);cursor:pointer;font-size:18px;padding:0 0 0 6px}
@keyframes rise{from{transform:translateY(10px);opacity:0}}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:18px;overflow:auto}
.tabs a{padding:10px 14px;color:var(--muted);font-weight:600;font-size:14px;border-bottom:2px solid transparent;white-space:nowrap}.tabs a:hover{color:var(--text);text-decoration:none}
.tabs a.on{color:var(--text);border-color:var(--accent)}
.split{display:grid;gap:18px;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}.split>*{min-width:0}.panel.grid>*{min-width:0}
.preview{padding:16px 18px;min-height:110px;border-radius:12px;border:1px dashed var(--line-2);background:var(--none-bar)}
.svc-pick{display:grid;gap:8px;min-width:0}.svc-pick>*{min-width:0}.svc-pick .row{padding:8px 10px;border-radius:10px;border:1px solid var(--line);justify-content:space-between}
.svc-pick .row{flex-wrap:nowrap}.svc-pick .check{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}.svc-pick .check input{margin-right:8px;vertical-align:-2px}
.svc-pick select{width:auto;flex:none;min-width:0;max-width:44%;padding:7px 10px}
.kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--line-2);border-bottom-width:2px;border-radius:6px;padding:1px 6px;color:var(--muted)}
.copy{cursor:pointer}
.danger-zone{border-color:color-mix(in oklab,var(--major) 35%,transparent)}
.login{min-height:100vh;display:grid;place-items:center;padding:20px}
.login .card{width:min(420px,100%);padding:30px}
.login h1{font-size:24px;font-weight:800;margin:18px 0 4px}
.swatch{width:18px;height:18px;border-radius:6px;display:inline-block;vertical-align:middle;border:1px solid var(--line-2)}
.burger{display:none}
@media (max-width:900px){
  .app{grid-template-columns:1fr}.side{position:fixed;inset:0 auto 0 0;width:270px;z-index:40;transform:translateX(-102%);transition:transform .2s;background:var(--panel-solid)}
  .app.nav-open .side{transform:none}.burger{display:grid}.content{padding:20px 16px}.topbar{padding:12px 16px}.split{grid-template-columns:1fr}
}
@media (max-width:560px){.head-links .btn.ghost{display:none}.banner{padding:18px}.banner h2{font-size:18px}.incident,.svc,.group>summary{padding-left:16px;padding-right:16px}.bars{height:28px;gap:1px}.wrap{padding:0 14px}}
`;

export const JS = String.raw`
(() => {
  const root = document.documentElement;
  // Theme: remembered per browser; the system's until chosen.
  const saved = (() => { try { return localStorage.getItem('pulsar-theme'); } catch { return null; } })();
  if (saved) root.dataset.theme = saved;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-toggle]');
    if (t) {
      const dark = (root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('pulsar-theme', root.dataset.theme); } catch {}
    }
    const c = e.target.closest('[data-copy]');
    if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Copied')); }
    const n = e.target.closest('[data-nav-toggle]');
    if (n) document.querySelector('.app')?.classList.toggle('nav-open');
    const x = e.target.closest('.flash .x');
    if (x) x.parentElement.remove();
  });
  // Confirm before destructive submits.
  document.addEventListener('submit', (e) => {
    const f = e.target; const q = f.dataset.confirm;
    if (q && !confirm(q)) { e.preventDefault(); return; }
    f.querySelectorAll('button[type=submit],button:not([type])').forEach((b) => { setTimeout(() => (b.disabled = true), 0); });
  });
  function toast(msg, kind) {
    const el = document.createElement('div'); el.className = 'flash ' + (kind || 'ok'); el.setAttribute('role', 'status');
    el.textContent = msg; const x = document.createElement('button'); x.className = 'x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×'; el.append(x);
    document.body.append(el); setTimeout(() => el.remove(), 4000);
  }
  // Server flashes fade on their own; the URL loses ?ok/?err so a reload doesn't repeat them.
  document.querySelectorAll('.flash').forEach((el) => setTimeout(() => el.remove(), 5000));
  if (location.search.match(/[?&](ok|err)=/)) { const u = new URL(location.href); u.searchParams.delete('ok'); u.searchParams.delete('err'); history.replaceState(null, '', u); }
  // Times: "3 min ago" next to absolute ones.
  const rel = (d) => { const s = (Date.now() - d) / 1000; const f = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (Math.abs(s) < 60) return f.format(-Math.round(s), 'second'); if (Math.abs(s) < 3600) return f.format(-Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return f.format(-Math.round(s / 3600), 'hour'); return f.format(-Math.round(s / 86400), 'day'); };
  const tick = () => document.querySelectorAll('time[data-rel]').forEach((t) => { t.textContent = rel(Date.parse(t.getAttribute('datetime'))); });
  tick(); setInterval(tick, 30000);
  // Live preview of markdown fields.
  document.querySelectorAll('textarea[data-preview]').forEach((ta) => {
    const out = document.getElementById(ta.dataset.preview); if (!out) return;
    let timer; const run = async () => {
      const r = await fetch('/admin/preview', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text: ta.value }) });
      if (r.ok) out.innerHTML = await r.text();
    };
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); }); run();
  });
  // Templates fill the composer.
  const tpl = document.querySelector('select[data-templates]');
  if (tpl) tpl.addEventListener('change', () => {
    const o = tpl.selectedOptions[0]; if (!o || !o.value) return;
    const f = tpl.form; f.elements.name.value = o.dataset.title || ''; f.elements.body.value = o.dataset.body || '';
    if (f.elements.impact && o.dataset.impact) f.elements.impact.value = o.dataset.impact;
    f.elements.body.dispatchEvent(new Event('input'));
  });
  // A service ticked follows the impact's usual status until changed by hand.
  document.querySelectorAll('[data-svc-pick]').forEach((box) => {
    const f = box.closest('form'); const imp = f?.elements.impact;
    const map = { none: 'operational', minor: 'degraded_performance', major: 'partial_outage', critical: 'major_outage' };
    imp?.addEventListener('change', () => box.querySelectorAll('select').forEach((s) => { if (!s.dataset.touched) s.value = map[imp.value] || s.value; }));
    box.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { s.dataset.touched = '1'; const cb = s.closest('.row').querySelector('input[type=checkbox]'); if (cb) cb.checked = true; }));
  });
  // Keyboard: n = new incident, / = search, g d = dashboard.
  let g = false;
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const newInc = document.querySelector('[data-key=n]');
    if (e.key === 'n' && newInc) { e.preventDefault(); location.href = newInc.href; }
    else if (e.key === '/') { const s = document.querySelector('input[type=search]'); if (s) { e.preventDefault(); s.focus(); } }
    else if (e.key === 'g') { g = true; setTimeout(() => (g = false), 800); }
    else if (g && e.key === 'd') location.href = '/admin';
  });
  // A table filter.
  document.querySelectorAll('input[data-filter]').forEach((inp) => {
    const rows = document.querySelectorAll(inp.dataset.filter);
    inp.addEventListener('input', () => { const q = inp.value.toLowerCase(); rows.forEach((r) => { r.hidden = q && !r.textContent.toLowerCase().includes(q); }); });
  });
})();
`;

export const ICON: Record<string, string> = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.4" fill="currentColor"/></svg>',
  hook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16.1A4 4 0 1 1 13 12l-3-5"/><path d="M6 15.9A4 4 0 1 0 11 20h6"/><path d="M12 4a4 4 0 0 1 3.5 6"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h2l2-4 2 8 2-4h2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
};
