// Kid Watch card: each child's now-playing, screen time, timeline, TVs, top sites and alerts, with one-tap controls.
// Served by the Kid Watch integration; reads the "Status" sensor of every child it set up.
const KW_VERSION = "0.1.0";

const KW_CATS = {
  video: ["Video", "#e5484d"], social: ["Social", "#8e5cf7"], gaming: ["Gaming", "#2f9e6b"], school: ["School", "#2f6fdc"],
  tv: ["TV & Plex", "#d48a00"], music: ["Music", "#d6487e"], web: ["Other sites", "#7a7f88"], blocked: ["Blocked", "#8a8f98"], paused: ["Paused", "#5d6068"], alert: ["Alert", "#d93025"],
};
const KW_ICON = {
  video: "mdi:play-box", social: "mdi:chat", gaming: "mdi:controller", school: "mdi:school", tv: "mdi:television-play",
  music: "mdi:music", web: "mdi:web", idle: "mdi:weather-night", paused: "mdi:wifi-off",
};
const kwEsc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kwDur = m => (m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m");
const kwPl = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const kwTime = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const kwOver = (rating, limit) => {
  const age = r => {
    if (!r) return null;
    let s = String(r).toUpperCase().split("/").pop().trim();
    const map = { U: 0, UC: 0, G: 0, "TV-Y": 0, "TV-G": 0, "TV-Y7": 7, PG: 8, "TV-PG": 8, "12A": 12, "PG-13": 13, "TV-14": 14, R: 17, "TV-MA": 17, "NC-17": 18 };
    if (s in map) return map[s];
    const m = s.match(/\d{1,2}/);
    return m ? +m[0] : null;
  };
  const a = age(rating), lim = { U: 0, PG: 8, 12: 12, 15: 15, 18: 18 }[limit] ?? 18;
  return a !== null && a > lim;
};

const KW_STYLE = `
:host { --kw-soft: var(--secondary-background-color, #f1efe8); --kw-line: var(--divider-color, #e3e0d6); --kw-muted: var(--secondary-text-color, #5d6068); --kw-alert: var(--error-color, #d93025); }
ha-card { padding: 16px; }
.top { display:flex; align-items:center; gap:10px; }
.top h2 { margin:0; flex:1; font-size:1.15rem; font-weight:700; }
.ib { border:1px solid var(--kw-line); background:var(--kw-soft); color:inherit; border-radius:10px; padding:5px 10px; font:600 13px inherit; font-family:inherit; cursor:pointer; }
.ib[disabled] { opacity:.5; cursor:default; }
.kids { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0; }
.kid { flex:1 1 150px; display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:14px; border:2px solid var(--kw-line); background:none; color:inherit; cursor:pointer; text-align:left; font:inherit; position:relative; min-width:0; }
.kid[aria-selected="true"] { border-color:var(--kc); background:color-mix(in srgb, var(--kc) 10%, transparent); }
.av { width:36px; height:36px; border-radius:50%; display:grid; place-items:center; color:#fff; font-weight:700; background:var(--kc); flex:none; }
.av.sm { width:22px; height:22px; font-size:11px; }
.kid b { display:block; }
.kid small { color:var(--kw-muted); font-size:12px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kid .dot { position:absolute; top:6px; right:8px; width:10px; height:10px; border-radius:50%; background:var(--kw-alert); }
.now { display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; background:var(--kw-soft); }
.ic { width:46px; height:46px; border-radius:12px; display:grid; place-items:center; color:#fff; flex:none; background:var(--cc); overflow:hidden; }
.ic img { width:100%; height:100%; object-fit:cover; }
.lbl { font-size:12px; color:var(--kw-muted); text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
.ttl { font-weight:700; font-size:1.05rem; line-height:1.25; }
.sub, .d { font-size:13px; color:var(--kw-muted); }
.st { margin:12px 0 4px; }
.row { display:flex; justify-content:space-between; font-size:13px; }
.bar { height:10px; border-radius:6px; background:var(--kw-soft); overflow:hidden; margin-top:4px; display:flex; }
.bar i { display:block; height:100%; }
.ctrls { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin:14px 0 10px; }
.tg { border:1px solid var(--kw-line); background:var(--kw-soft); color:inherit; border-radius:12px; padding:8px; font:600 13px inherit; font-family:inherit; cursor:pointer; text-align:left; }
.tg small { display:block; color:var(--kw-muted); font-weight:400; font-size:12px; }
.tg.on { background:var(--kc); border-color:var(--kc); color:#fff; }
.tg.on small { color:#fff; opacity:.85; }
.tg.pause.on { background:var(--kw-alert); border-color:var(--kw-alert); }
.blk { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:13px; }
.blk span { color:var(--kw-muted); }
.chip { border:1px solid var(--kw-line); background:none; color:inherit; border-radius:999px; padding:3px 10px; font:600 12px inherit; font-family:inherit; cursor:pointer; }
.chip.on { background:var(--primary-text-color); color:var(--card-background-color, #fff); border-color:var(--primary-text-color); text-decoration:line-through; }
.seg { display:flex; gap:4px; background:var(--kw-soft); padding:4px; border-radius:12px; margin:16px 0 10px; }
.seg button { flex:1; border:0; background:none; color:inherit; padding:6px; border-radius:9px; font:600 13px inherit; font-family:inherit; cursor:pointer; }
.seg button[aria-selected="true"] { background:var(--card-background-color, #fff); box-shadow:0 1px 3px rgb(0 0 0 / .15); }
.n { background:var(--kw-alert); color:#fff; border-radius:999px; padding:0 6px; font-size:11px; margin-left:4px; }
.list { list-style:none; margin:0; padding:0; max-height:320px; overflow:auto; }
.list li { display:grid; grid-template-columns:auto 10px minmax(0,1fr); gap:8px; align-items:start; padding:7px 0; border-bottom:1px solid var(--kw-line); font-size:14px; }
.list li:last-child { border-bottom:0; }
.list time { font:12px monospace; color:var(--kw-muted); padding-top:2px; white-space:nowrap; }
.cd { width:10px; height:10px; border-radius:50%; margin-top:6px; background:var(--cc); }
.list li.blocked b { text-decoration:line-through; color:var(--kw-muted); }
.list li.alert b { color:var(--kw-alert); text-decoration:none; }
.sites li { grid-template-columns:minmax(0,1fr) 60px; }
.sb { height:6px; border-radius:3px; background:var(--cc); margin-top:4px; }
.m { text-align:right; font:12px monospace; color:var(--kw-muted); padding-top:2px; }
.tvs li { grid-template-columns:36px minmax(0,1fr); }
.tvic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; color:#fff; background:var(--cc); }
.wt { display:flex; gap:8px; align-items:center; margin-top:6px; }
.pg { height:6px; border-radius:3px; background:color-mix(in srgb, #d48a00 22%, transparent); overflow:hidden; margin-top:8px; }
.pg i { display:block; height:100%; background:#d48a00; }
.tvm { margin-top:4px; display:flex; align-items:center; gap:6px; }
.rt { display:inline-block; min-width:26px; text-align:center; padding:0 5px; border:1.5px solid currentColor; border-radius:5px; font:700 11px/16px inherit; font-family:inherit; }
.rt.over { background:var(--kw-alert); border-color:var(--kw-alert); color:#fff; }
.acts { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.empty { color:var(--kw-muted); font-size:14px; padding:10px 0; }
.legend { display:flex; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--kw-muted); margin-top:10px; }
.legend i { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; background:var(--cc); }
.ov { position:fixed; inset:0; background:rgb(0 0 0 / .55); display:grid; place-items:center; z-index:10; padding:16px; }
.dlg { background:var(--card-background-color, #fff); color:var(--primary-text-color); border-radius:18px; padding:16px; width:min(560px, 100%); max-height:90vh; overflow:auto; }
.shead { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.shead h3 { margin:0; }
.frame { background:#0b0c0e; border-radius:12px; padding:8px; }
.screen { aspect-ratio:16/9; border-radius:5px; position:relative; overflow:hidden; color:#fff; display:flex; align-items:flex-end; background:#222 center/cover no-repeat; }
.screen.off { background:#000; align-items:center; justify-content:center; color:#777; font-weight:700; }
.screen .app { position:absolute; top:10px; left:12px; font:700 11px inherit; font-family:inherit; background:rgb(0 0 0 / .5); padding:2px 8px; border-radius:6px; letter-spacing:.06em; text-transform:uppercase; }
.screen .cap { padding:14px 16px; background:linear-gradient(transparent, rgb(0 0 0 / .7)); width:100%; }
.screen .cap b { display:block; font-size:1.6rem; line-height:1.1; }
.screen .pz { position:absolute; inset:0; display:grid; place-items:center; font-size:44px; background:rgb(0 0 0 / .4); }
.stand { width:28%; height:7px; margin:0 auto 10px; background:#0b0c0e; border-radius:0 0 6px 6px; }
.warn { background:var(--kw-alert); color:#fff; border-radius:10px; padding:8px 12px; font-weight:700; font-size:14px; margin-bottom:10px; }
`;

class KidWatchCard extends HTMLElement {
  setConfig(config) {
    this._config = { popup: true, ...(config || {}) };
    this._sel = null;
    this._view = "timeline";
    this._screen = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", e => this._click(e));
    }
  }

  static getStubConfig() { return {}; }
  getCardSize() { return 9; }

  connectedCallback() { this._tick = setInterval(() => this._render(), 30000); }
  disconnectedCallback() { clearInterval(this._tick); }

  set hass(hass) {
    this._hass = hass;
    const kids = this._kids();
    const ids = kids.flatMap(k => [k.entity_id, ...Object.values(k.attributes.switches || {}).flatMap(v => (typeof v === "string" ? [v] : Object.values(v || {}))), ...(k.attributes.tv_entities || [])]);
    const sig = ids.map(id => { const s = hass.states[id]; return s ? s.last_updated + s.state : ""; }).join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    this._autoPopup(kids);
    this._render();
  }

  _kids() {
    const want = (this._config.children || []).map(n => String(n).toLowerCase());
    return Object.values(this._hass.states)
      .filter(s => s.attributes.kid_watch && (!want.length || want.includes(String(s.attributes.child).toLowerCase())))
      .sort((a, b) => String(a.attributes.child).localeCompare(b.attributes.child));
  }

  _seen(cid, val) {
    const key = "kid-watch-seen-" + cid;
    try {
      if (val !== undefined) localStorage.setItem(key, val);
      return localStorage.getItem(key) || "";
    } catch { return ""; }
  }

  // a show above the age limit opens the TV pop-up, once per alert
  _autoPopup(kids) {
    if (!this._config.popup) return;
    for (const k of kids) {
      const a = (k.attributes.alerts || [])[0];
      if (!a || a.type !== "tv" || Date.now() - new Date(a.t) > 120000) continue;
      const key = k.attributes.child_id + a.t;
      if (this._popped === key) continue;
      this._popped = key;
      this._screen = { cid: k.attributes.child_id, auto: true };
      this._sel = k.attributes.child_id;
    }
  }

  _call(domain, service, data) { this._hass.callService(domain, service, data); }

  _click(e) {
    const t = e.target.closest("[data-a]");
    if (!t) { if (e.target.classList.contains("ov")) { this._screen = null; this._render(); } return; }
    const a = t.dataset.a, v = t.dataset.v;
    if (a === "kid") { this._sel = v; }
    else if (a === "view") { this._view = v; }
    else if (a === "toggle") { this._call("switch", "toggle", { entity_id: v }); return; }
    else if (a === "tvpause") { this._call("media_player", "media_play_pause", { entity_id: v }); return; }
    else if (a === "tvoff") { this._call("media_player", "turn_off", { entity_id: v }); return; }
    else if (a === "screen") { this._screen = { cid: v, eid: t.dataset.e, auto: false }; }
    else if (a === "close") { this._screen = null; }
    else if (a === "more") { this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: v } })); return; }
    this._render();
  }

  _tvBlock(k, tv, inPopup) {
    const known = tv.duration && tv.position != null;
    const pct = known ? Math.min(100, tv.position / tv.duration * 100) : 0;
    const left = known ? Math.max(0, Math.round((tv.duration - tv.position) / 60)) : null;
    const over = kwOver(tv.rating, k.attributes.age_limit);
    return `${known ? `<div class="pg"><i style="width:${pct}%"></i></div>` : ""}
      <div class="d tvm">${tv.rating ? `<span class="rt${over ? " over" : ""}">${kwEsc(String(tv.rating).split("/").pop())}</span>` : ""}${left !== null ? left + " min left" : ""}${tv.paused ? " · paused" : ""}</div>
      <div class="acts">${inPopup ? "" : `<button class="ib" data-a="screen" data-v="${kwEsc(k.attributes.child_id)}" data-e="${kwEsc(tv.entity_id)}">📺 Screen</button>`}
        <button class="ib" data-a="tvpause" data-v="${kwEsc(tv.entity_id)}">${tv.paused ? "▶ Play" : "❚❚ Pause"}</button>
        <button class="ib" data-a="tvoff" data-v="${kwEsc(tv.entity_id)}">Turn off TV</button></div>`;
  }

  _render() {
    if (!this._hass || !this.shadowRoot) return;
    const kids = this._kids();
    if (!kids.length) {
      this.shadowRoot.innerHTML = `<style>${KW_STYLE}</style><ha-card><div class="empty">No children set up yet. Add Kid Watch in Settings → Devices &amp; services, then add a child.</div></ha-card>`;
      return;
    }
    if (!kids.some(k => k.attributes.child_id === this._sel)) this._sel = kids[0].attributes.child_id;
    const k = kids.find(x => x.attributes.child_id === this._sel), A = k.attributes, sw = A.switches || {};
    const isOn = id => id && this._hass.states[id] && this._hass.states[id].state === "on";
    const n = A.now;

    const tabs = kids.map(c => {
      const a = c.attributes, line = a.paused ? "Paused" : a.now ? (a.now.kind === "tv" ? "📺 " : "") + a.now.title : "Nothing right now";
      const unseen = (a.alerts || []).length && (a.alerts[0].t > this._seen(a.child_id));
      return `<button class="kid" role="tab" aria-selected="${a.child_id === this._sel}" data-a="kid" data-v="${kwEsc(a.child_id)}" style="--kc:${kwEsc(a.color)}">
        <span class="av">${kwEsc(String(a.child)[0])}</span><span style="min-width:0"><b>${kwEsc(a.child)}</b><small>${kwEsc(line)}</small></span>${unseen ? `<span class="dot"></span>` : ""}</button>`;
    }).join("");

    let now;
    if (A.paused) now = `<div class="ic" style="--cc:var(--kw-alert)"><ha-icon icon="${KW_ICON.paused}"></ha-icon></div><div><div class="lbl">Now</div><div class="ttl">Internet paused</div><div class="sub">${kwPl((A.devices || []).length, "device")}</div></div>`;
    else if (n && n.kind === "tv") now = `<div class="ic" style="--cc:${KW_CATS.tv[1]}">${n.picture ? `<img src="${kwEsc(n.picture)}" alt="">` : `<ha-icon icon="${KW_ICON.tv}"></ha-icon>`}</div><div style="min-width:0;flex:1"><div class="lbl">Watching on TV</div><div class="ttl">${kwEsc(n.title)}</div><div class="sub">${kwEsc([n.app, n.tv].filter(Boolean).join(" · "))}</div>${this._tvBlock(k, n)}</div>`;
    else if (n) now = `<div class="ic" style="--cc:${(KW_CATS[n.category] || KW_CATS.web)[1]}"><ha-icon icon="${KW_ICON[n.category] || KW_ICON.web}"></ha-icon></div><div style="min-width:0"><div class="lbl">${n.category === "gaming" ? "Playing" : n.category === "school" ? "Schoolwork" : "On"}</div><div class="ttl">${kwEsc(n.title)}</div><div class="sub">${kwEsc(n.device)}</div></div>`;
    else now = `<div class="ic" style="--cc:#8a8f98"><ha-icon icon="${KW_ICON.idle}"></ha-icon></div><div><div class="lbl">Now</div><div class="ttl">Nothing right now</div><div class="sub">No activity on ${kwEsc(A.child)}'s devices</div></div>`;

    const used = A.screen_time || 0, budget = A.budget || 0, tot = Math.max(used, budget, 1);
    const bar = Object.entries(A.by_category || {}).map(([c, m]) => `<i style="width:${m / tot * 100}%;background:${(KW_CATS[c] || KW_CATS.web)[1]}" title="${kwEsc((KW_CATS[c] || KW_CATS.web)[0])}: ${kwDur(m)}"></i>`).join("");

    const tg = (id, cls, title, sub) => `<button class="tg ${cls}${isOn(id) ? " on" : ""}" data-a="toggle" data-v="${kwEsc(id)}" ${id ? "" : "disabled"}>${title}<small>${sub}</small></button>`;
    const ctrls = tg(sw.pause, "pause", isOn(sw.pause) ? "Resume internet" : "Pause internet", isOn(sw.pause) ? "All devices blocked" : kwPl((A.devices || []).length, "device"))
      + tg(sw.bedtime, "", "Bedtime", isOn(sw.bedtime) ? `Pauses ${A.bedtime}–${A.wake_time}` : "Off")
      + tg(sw.safesearch, "", "SafeSearch", isOn(sw.safesearch) ? "Google, YouTube, Bing" : "Off")
      + tg(sw.stop_over_age, "", "TV age limit: " + kwEsc(A.age_limit), isOn(sw.stop_over_age) ? "Stops older shows" : "Alerts only");
    const chips = Object.entries(sw.services || {}).filter(([, id]) => id).map(([s, id]) => `<button class="chip${isOn(id) ? " on" : ""}" data-a="toggle" data-v="${kwEsc(id)}">${kwEsc((A.services || {})[s] || s)}</button>`).join("");

    const alerts = A.alerts || [];
    let view;
    if (this._view === "tvs") view = this._tvsView(kids);
    else if (this._view === "sites") {
      const rows = A.top_sites || [], max = rows.length ? rows[0].minutes || 1 : 1;
      view = rows.length ? `<ul class="list sites">${rows.map(r => `<li><div><b style="font-size:14px">${kwEsc(r.name)}</b><div class="sb" style="--cc:${(KW_CATS[r.category] || KW_CATS.web)[1]};width:${r.minutes / max * 100}%"></div></div><span class="m">${kwDur(r.minutes)}</span></li>`).join("")}</ul>` : `<div class="empty">Nothing yet today.</div>`;
    } else if (this._view === "alerts") {
      if (alerts.length) this._seen(A.child_id, alerts[0].t);
      view = alerts.length ? `<ul class="list">${alerts.map(e => `<li class="alert"><time>${kwTime(e.t)}</time><span class="cd" style="--cc:var(--kw-alert)"></span><div><b>${kwEsc(e.title)}</b><div class="d">${kwEsc(e.detail)}</div></div></li>`).join("")}</ul>` : `<div class="empty">No alerts today.</div>`;
    } else {
      const tl = A.timeline || [];
      view = tl.length ? `<ul class="list">${tl.map(e => `<li class="${e.category === "blocked" ? "blocked" : ""}${e.alert ? " alert" : ""}"><time>${kwTime(e.t)}</time><span class="cd" style="--cc:${e.alert ? "var(--kw-alert)" : (KW_CATS[e.category] || KW_CATS.web)[1]}"></span><div><b>${kwEsc(e.title)}</b><div class="d">${kwEsc(e.detail)}</div></div></li>`).join("")}</ul>` : `<div class="empty">Nothing yet today.</div>`;
    }
    const seg = [["timeline", "Timeline"], ["tvs", "TVs"], ["sites", "Top sites"], ["alerts", "Alerts"]].map(([v, l]) =>
      `<button role="tab" data-a="view" data-v="${v}" aria-selected="${this._view === v}">${l}${v === "alerts" && alerts.length ? `<span class="n">${alerts.length}</span>` : ""}</button>`).join("");
    const legend = ["video", "social", "gaming", "school", "tv", "blocked"].map(c => `<span><i style="--cc:${KW_CATS[c][1]}"></i>${KW_CATS[c][0]}</span>`).join("");

    this.shadowRoot.innerHTML = `<style>${KW_STYLE}</style>
      <ha-card style="--kc:${kwEsc(A.color)}">
        <div class="top"><h2>${kwEsc(this._config.title || "Kid Watch")}</h2><button class="ib" data-a="more" data-v="${kwEsc(k.entity_id)}" title="Details" aria-label="Details"><ha-icon icon="mdi:information-outline" style="--mdc-icon-size:18px;width:18px;height:18px"></ha-icon></button></div>
        <div class="kids" role="tablist">${tabs}</div>
        <div class="now">${now}</div>
        <div class="st"><div class="row"><span>Screen time today</span><span><b style="${budget && used > budget ? "color:var(--kw-alert)" : ""}">${kwDur(used)}</b>${budget ? " of " + kwDur(budget) : ""}</span></div><div class="bar">${bar}</div></div>
        <div class="ctrls">${ctrls}</div>
        ${chips ? `<div class="blk"><span>Block:</span>${chips}</div>` : ""}
        <div class="seg" role="tablist">${seg}</div>
        ${view}
        <div class="legend">${legend}</div>
      </ha-card>${this._screen ? this._screenView(kids) : ""}`;
  }

  _tvsView(kids) {
    const all = new Map();
    for (const c of kids) {
      for (const eid of c.attributes.tv_entities || []) if (!all.has(eid)) all.set(eid, null);
      for (const tv of c.attributes.tvs || []) all.set(tv.entity_id, { kid: c, tv });
    }
    if (!all.size) return `<div class="empty">No TVs added yet. Add them to a child in Kid Watch's Configure.</div>`;
    return `<p class="d" style="margin:0 0 4px">Every TV you've added, and who's watching.</p><ul class="list tvs">${[...all].map(([eid, w]) => {
      const st = this._hass.states[eid], name = w ? w.tv.tv : (st ? st.attributes.friendly_name || eid : eid);
      return `<li><span class="tvic" style="--cc:${w ? KW_CATS.tv[1] : "#8a8f98"}"><ha-icon icon="mdi:television"></ha-icon></span><div style="min-width:0"><b>${kwEsc(name)}</b>
        ${w ? `<div class="wt"><span class="av sm" style="--kc:${kwEsc(w.kid.attributes.color)}">${kwEsc(String(w.kid.attributes.child)[0])}</span><span><b>${kwEsc(w.tv.title)}</b><span class="d">${w.tv.app ? " · " + kwEsc(w.tv.app) : ""}</span></span></div>${this._tvBlock(w.kid, w.tv)}`
          : `<div class="d">${st && st.state === "off" ? "Off" : "Nothing playing"}</div>`}</div></li>`;
    }).join("")}</ul>`;
  }

  _screenView(kids) {
    const k = kids.find(x => x.attributes.child_id === this._screen.cid);
    if (!k) return "";
    const A = k.attributes, tvs = A.tvs || [];
    const tv = tvs.find(t => t.entity_id === this._screen.eid) || tvs[0];
    const head = `<div class="shead"><h3>${kwEsc(A.child)}'s TV</h3><button class="ib" data-a="close" aria-label="Close">✕</button></div>`;
    if (!tv) return `<div class="ov"><div class="dlg">${head}<div class="frame"><div class="screen off">TV off</div></div><div class="stand"></div><p class="d">Nothing playing for ${kwEsc(A.child)} right now.</p></div></div>`;
    const over = kwOver(tv.rating, A.age_limit);
    const pic = tv.picture ? `background-image:url('${kwEsc(tv.picture)}')` : "background:linear-gradient(135deg,#3b5bdb,#1b1d3a)";
    return `<div class="ov"><div class="dlg" role="dialog" aria-label="${kwEsc(A.child)}'s TV">${head}
      ${over ? `<div class="warn">⚠ ${kwEsc(String(tv.rating).split("/").pop())}-rated: above ${kwEsc(A.child)}'s age limit (${kwEsc(A.age_limit)})</div>` : ""}
      <div class="frame"><div class="screen" style="${pic}">${tv.app ? `<span class="app">${kwEsc(tv.app)}</span>` : ""}
        <div class="cap"><b>${kwEsc(tv.show)}</b>${tv.episode ? `<span>${kwEsc(tv.episode)}</span>` : ""}</div>${tv.paused ? `<div class="pz">❚❚</div>` : ""}</div></div><div class="stand"></div>
      <div class="wt"><span class="av sm" style="--kc:${kwEsc(A.color)}">${kwEsc(String(A.child)[0])}</span><span><b>${kwEsc(A.child)}</b> · ${kwEsc(tv.tv)}</span></div>
      ${this._tvBlock(k, tv, true)}
      <p class="d" style="margin:10px 0 0">The picture is the artwork the TV reports. Streaming apps block copying the live screen.</p></div></div>`;
  }
}

if (!customElements.get("kid-watch-card")) customElements.define("kid-watch-card", KidWatchCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "kid-watch-card")) {
  window.customCards.push({ type: "kid-watch-card", name: "Kid Watch", description: "What each child is watching and browsing, with screen time and AdGuard controls.", preview: false });
}
console.info(`%c KID-WATCH-CARD %c ${KW_VERSION} `, "background:#ffcc00;color:#000;font-weight:700", "background:#222;color:#fff");
