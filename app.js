/* =========================================================================
   MBG WATCH v2 — app.js
   Vanilla JS ES6+. Seluruh data dari data.js adalah data dummy/simulasi.
   Struktur modul: STATE → STORAGE → UTILITIES → NAVIGATION → MAP →
   DASHBOARD → ALERTS → CCTV → RISK → AUDIT → REPORTS → SIMULATION → INIT
   ========================================================================= */
(function () {
  "use strict";

  /* =======================================================================
     STATE
     ======================================================================= */
  const state = {
    view: "overview",
    appMode: "admin", // 'admin' | 'dapur' — set at login, drives which nav/views are active
    mapStatusFilter: "all",
    mapProvinceFilter: "all",
    mapSearch: "",
    alertFilter: "all",
    activeSPPGId: null,
    activeDetailTab: "overview",
    activeAlertId: null,
    activeAuditId: null,
  };

  /* =======================================================================
     STORAGE  (localStorage helpers — never store secrets/credentials)
     ======================================================================= */
  const STORAGE_KEYS = {
    theme: "mbgwatch:theme",
    filters: "mbgwatch:filters",
    favorites: "mbgwatch:favorites",
    lastVisited: "mbgwatch:lastVisited",
    alertState: "mbgwatch:alertState",
    auditState: "mbgwatch:auditState",
    settings: "mbgwatch:settings",
  };
  function storageGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  /* Session (login) uses sessionStorage on purpose — it's tab/session
     scoped and never persists across browser restarts, which fits a
     "logged in as" concept better than the persistent localStorage keys
     above. No password/credential is ever stored, only a role + display
     name, since this login is a simulated prototype flow. */
  const SESSION_KEY = "mbgwatch:session";
  function sessionGet(key, fallback) {
    try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function sessionClear(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  /* Re-hydrate alert / audit workflow status saved from a previous visit */
  function hydrateAlerts() {
    const saved = storageGet(STORAGE_KEYS.alertState, {});
    ALERTS.forEach((a) => {
      if (saved[a.id]) Object.assign(a, saved[a.id]);
    });
  }
  function persistAlert(alert) {
    const saved = storageGet(STORAGE_KEYS.alertState, {});
    saved[alert.id] = { status: alert.status, note: alert.note || "" };
    storageSet(STORAGE_KEYS.alertState, saved);
  }
  function hydrateAudits() {
    const saved = storageGet(STORAGE_KEYS.auditState, {});
    AUDITS.forEach((a) => { if (saved[a.id]) Object.assign(a, saved[a.id]); });
  }
  function persistAudit(audit) {
    const saved = storageGet(STORAGE_KEYS.auditState, {});
    saved[audit.id] = { status: audit.status, notes: audit.notes || "" };
    storageSet(STORAGE_KEYS.auditState, saved);
  }

  /* =======================================================================
     UTILITIES
     ======================================================================= */
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function fmt(n) { return Math.round(n).toLocaleString("id-ID"); }
  function statusLabel(s) {
    return { normal: "NORMAL", monitoring: "MONITORING", warning: "WARNING", critical: "CRITICAL", offline: "OFFLINE" }[s] || String(s).toUpperCase();
  }
  function statusColorVar(status) {
    return { normal: "var(--accent-green)", monitoring: "var(--accent-cyan)", warning: "var(--accent-orange)", critical: "var(--accent-red)", offline: "var(--accent-gray)" }[status] || "var(--accent-gray)";
  }
  function healthLabel(score) {
    if (score >= 80) return "GOOD";
    if (score >= 60) return "FAIR";
    if (score >= 40) return "NEEDS ATTENTION";
    return "POOR";
  }
  function sppgById(id) { return SPPG_DATA.find((s) => s.id === id); }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function debounce(fn, wait) {
    let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }

  /* =======================================================================
     SIMULATION — ONE global ticker only. Everything subscribes to it.
     Fixes the old bug where renderCCTV() created a new setInterval every
     time it was called.
     ======================================================================= */
  const appTicker = (function () {
    const subs1s = new Set();
    const subs20s = new Set();
    let seconds = 0;
    let handle = null;
    function tick() {
      seconds++;
      subs1s.forEach((fn) => { try { fn(); } catch (e) { /* keep ticking */ } });
      if (seconds % 20 === 0) subs20s.forEach((fn) => { try { fn(); } catch (e) {} });
    }
    return {
      start() { if (handle) return; handle = setInterval(tick, 1000); },
      every1s(fn) { subs1s.add(fn); return () => subs1s.delete(fn); },
      every20s(fn) { subs20s.add(fn); return () => subs20s.delete(fn); },
    };
  })();

  /* Light real-time simulation: nudge a few live numbers every ~20s so the
     dashboard feels alive without ever doing a full page reload or spawning
     new intervals. */
  function runLiveSimulationTick() {
    // Perturb sensors/production/distribution for a wider slice of SPPG
    // each tick so more of the dashboard — not just the map — visibly
    // moves between updates (was 3 SPPG; a national command center with
    // only 3 of 300 kitchens ever changing read as frozen).
    lastChangedSppgIds = new Set();
    const perturbCount = 6;
    for (let i = 0; i < perturbCount; i++) {
      const s = SPPG_DATA[Math.floor(Math.random() * SPPG_DATA.length)];
      lastChangedSppgIds.add(s.id);
      s.sensors.temperature = +clamp1(s.sensors.temperature + (Math.random() - 0.5) * 0.6, 0, 14).toFixed(1);
      s.sensors.humidity = +clamp1(s.sensors.humidity + (Math.random() - 0.5) * 2, 30, 85).toFixed(0);
      if (s.production.produced < s.production.target) {
        s.production.produced = Math.min(s.production.target, s.production.produced + Math.floor(Math.random() * 6));
        s.production.completion = +((s.production.produced / s.production.target) * 100).toFixed(1);
      }
      if (s.distribution.delivered < s.distribution.target) {
        s.distribution.delivered = Math.min(s.distribution.target, s.distribution.delivered + Math.floor(Math.random() * 4));
        s.distribution.completion = +((s.distribution.delivered / s.distribution.target) * 100).toFixed(1);
      }
      // Small chance a delayed distribution catches up, or an on-time one
      // slips — keeps "Distribusi tertunda" style alerts from being static.
      if (s.distribution.delayed > 0 && Math.random() < 0.3) s.distribution.delayed = Math.max(0, s.distribution.delayed - 1);
      else if (s.distribution.delayed === 0 && Math.random() < 0.05) s.distribution.delayed += 1;
      if (s.cctv.camerasOnline < s.cctv.camerasTotal && Math.random() < 0.4) s.cctv.camerasOnline++;
      else if (s.cctv.camerasOnline > 0 && Math.random() < 0.03) s.cctv.camerasOnline--;
      const derived = deriveSPPGStatus(s);
      s.status = derived.status; s.riskScore = derived.riskScore; s.riskBreakdown = derived.breakdown;
    }
    setLastUpdatedNow();

    // Alert workflow simulation: incidents keep arriving, staff keep working
    // the queue — makes the Alert tab / notif bell feel genuinely alive
    // instead of a frozen snapshot. Runs every tick (~20s); each event is
    // independently probabilistic so it doesn't fire in lockstep.
    let alertsChanged = false;
    if (Math.random() < 0.55) { progressRandomAlert(); alertsChanged = true; }
    if (Math.random() < 0.4) {
      const a = spawnSyntheticAlert();
      alertsChanged = true;
      if (a.level !== "monitoring") showLiveToast(a);
    }
    if (alertsChanged && typeof refreshAlertUI === "function") refreshAlertUI();

    // Re-render currently visible view's live-ish widgets cheaply.
    // renderOps()/renderMiniMap() were previously only called once at
    // startup — the "Live Operations" list and the Overview mini-map sat
    // frozen forever after the first paint even while everything else on
    // the dashboard kept moving. Now they refresh with the same 20s tick.
    if (state.view === "overview") { renderStatsAndSummary(); renderCriticalStrip(); renderAttention(); renderOps(); renderMiniMap(); }
    if (state.view === "map") renderLargeMap();
    if (state.view === "risk") renderRiskCenter();
    if (state.view === "cctv") renderCCTV();
    // Sensor IoT grid lives inside the Distribusi view (id="sensorGrid"),
    // not a standalone "sensor" view — the admin dashboard has no such
    // view name, so guarding on it would silently never fire.
    if (state.view === "distribution") renderSensors();
  }
  function clamp1(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* Small non-blocking toast for incoming alerts — purely cosmetic, never
     blocks interaction, caps itself so the stack can't grow unbounded. */
  function showLiveToast(alert) {
    let stack = document.getElementById("liveToastStack");
    if (!stack) {
      stack = el(`<div class="live-toast-stack" id="liveToastStack" aria-live="polite"></div>`);
      document.body.appendChild(stack);
    }
    const levelLabel = { critical: "CRITICAL", warning: "WARNING", monitoring: "INFO" }[alert.level] || "INFO";
    const toast = el(`<div class="live-toast is-${alert.level}">
      <span class="lt-dot"></span>
      <div class="lt-body">
        <div class="lt-title">${levelLabel} · ${escapeHtml(alert.sppgName)}</div>
        <div class="lt-msg">${escapeHtml(alert.message)}</div>
      </div>
    </div>`);
    toast.addEventListener("click", () => { setView("alerts"); toast.remove(); });
    stack.appendChild(toast);
    while (stack.children.length > 3) stack.removeChild(stack.firstChild);
    setTimeout(() => { toast.classList.add("is-leaving"); setTimeout(() => toast.remove(), 400); }, 5200);
  }

  function setLastUpdatedNow() {
    const nodes = document.querySelectorAll("[data-last-updated]");
    const t = new Date().toLocaleTimeString("id-ID", { hour12: false });
    nodes.forEach((n) => (n.textContent = `LAST UPDATED ${t} WIB`));
  }

  /* =======================================================================
     NAVIGATION
     ======================================================================= */
  const views = document.querySelectorAll(".view");
  function setView(name) {
    state.view = name;
    views.forEach((v) => (v.hidden = v.id !== `view-${name}`));
    document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    document.querySelectorAll(".bn-item[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    const mainEl = document.getElementById("mainContent");
    if (mainEl && typeof mainEl.scrollTo === "function") mainEl.scrollTo({ top: 0 });
    if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
    closeMobileSheet();
  }
  document.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.goto)));

  const MENU_ITEMS_ADMIN = [
    ["overview", "Overview"], ["map", "Peta SPPG"], ["cctv", "Monitoring CCTV"],
    ["production", "Produksi"], ["distribution", "Distribusi"], ["risk", "Risk Center"],
    ["alerts", "Early Warning"], ["audit", "Audit & Inspeksi"], ["reports", "Laporan"],
    ["analytics", "Analitik"], ["system", "System Status"], ["settings", "Pengaturan"],
  ];
  const MENU_ITEMS_DAPUR = [
    ["dapur-overview", "Ringkasan"], ["dapur-team", "Struktur & Tim"], ["dapur-menu", "Jadwal Menu"],
    ["dapur-ops", "Produksi & Distribusi"], ["dapur-cctv", "CCTV Dapur"], ["dapur-sensor", "Sensor"],
    ["dapur-audit", "Audit Dapur"], ["settings", "Pengaturan"],
  ];
  const mobileSheet = document.getElementById("mobileMenuSheet");
  function openMobileSheet() {
    mobileSheet.innerHTML = "";
    const inner = el(`<div class="sheet-inner"></div>`);
    const items = state.appMode === "dapur" ? MENU_ITEMS_DAPUR : MENU_ITEMS_ADMIN;
    items.forEach(([view, label]) => {
      const b = el(`<button class="nav-item" style="width:100%;font-size:14px;padding:12px 10px">${label}</button>`);
      b.addEventListener("click", () => setView(view));
      inner.appendChild(b);
    });
    mobileSheet.appendChild(inner);
    mobileSheet.hidden = false;
  }
  function closeMobileSheet() { mobileSheet.hidden = true; }
  document.getElementById("bnMenu").addEventListener("click", openMobileSheet);
  document.getElementById("bnMenuDapur").addEventListener("click", openMobileSheet);
  mobileSheet.addEventListener("click", (e) => { if (e.target === mobileSheet) closeMobileSheet(); });
  document.getElementById("menuToggle").addEventListener("click", openMobileSheet);

  /* =======================================================================
     THEME
     ======================================================================= */
  function applyTheme(theme) { document.body.dataset.theme = theme; storageSet(STORAGE_KEYS.theme, theme); }
  function toggleTheme() { applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark"); }
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("settingsThemeToggle").addEventListener("click", toggleTheme);
  applyTheme(storageGet(STORAGE_KEYS.theme, "dark"));

  /* =======================================================================
     CLOCK (subscribes to the single global ticker)
     ======================================================================= */
  function updateClock() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const clockNode = document.getElementById("clockDisplay");
    if (clockNode) clockNode.textContent = `${dateStr} • ${timeStr} WIB`;
    document.querySelectorAll(".cctv-ts").forEach((t) => (t.textContent = now.toLocaleTimeString("id-ID", { hour12: false })));
  }
  appTicker.every1s(updateClock);
  appTicker.every20s(runLiveSimulationTick);

  /* =======================================================================
     NOTIFICATIONS
     ======================================================================= */
  const notifPanel = document.getElementById("notifPanel");
  document.getElementById("notifToggle").addEventListener("click", () => { notifPanel.hidden = !notifPanel.hidden; });
  document.getElementById("closeNotif").addEventListener("click", () => (notifPanel.hidden = true));
  document.addEventListener("click", (e) => {
    if (!notifPanel.hidden && !notifPanel.contains(e.target) && !e.target.closest("#notifToggle")) notifPanel.hidden = true;
  });
  function renderNotifList() {
    const list = document.getElementById("notifList");
    const openAlerts = ALERTS.filter((a) => a.status !== "RESOLVED").slice(0, 8);
    list.innerHTML = "";
    document.getElementById("notifCount").textContent = openAlerts.length;
    document.querySelector("#notifPanel .notif-head strong").textContent = `${openAlerts.length} Alert Aktif`;
    const counts = { critical: 0, warning: 0, monitoring: 0 };
    ALERTS.forEach((a) => { if (a.status !== "RESOLVED" && counts[a.level] !== undefined) counts[a.level]++; });
    document.getElementById("notifSummary").innerHTML =
      `<span><span class="dot dot-critical"></span>Critical: ${counts.critical}</span>
       <span><span class="dot dot-warning"></span>Warning: ${counts.warning}</span>
       <span><span class="dot dot-monitoring"></span>Monitoring: ${counts.monitoring}</span>`;
    openAlerts.forEach((a) => {
      const row = el(`<div class="notif-row"><strong>${statusLabel(a.level)}</strong> — ${escapeHtml(a.sppgName)}<br><span class="muted">${escapeHtml(a.message)}</span></div>`);
      row.addEventListener("click", () => { notifPanel.hidden = true; setView("alerts"); });
      list.appendChild(row);
    });
  }

  /* =======================================================================
     DASHBOARD — Operational Summary + Stats
     ======================================================================= */
  const STAT_ICONS = {
    "accent-gold": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    "accent-green": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    "accent-cyan": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3"/></svg>',
    "accent-orange": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    "accent-red": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  };
  function renderStatsAndSummary() {
    const counts = { normal: 0, monitoring: 0, warning: 0, critical: 0, offline: 0 };
    SPPG_DATA.forEach((s) => counts[s.status]++);

    const STATS = [
      { label: "TOTAL SPPG (SIMULASI NASIONAL)", value: NATIONAL_SIMULATION.totalSPPG, cls: "accent-gold" },
      { label: "OPERATIONAL", value: NATIONAL_SIMULATION.operational, cls: "accent-green" },
      { label: "MONITORING", value: NATIONAL_SIMULATION.monitoring, cls: "accent-cyan" },
      { label: "WARNING", value: NATIONAL_SIMULATION.warning, cls: "accent-orange" },
      { label: "CRITICAL", value: NATIONAL_SIMULATION.critical, cls: "accent-red" },
    ];
    const grid = document.getElementById("statsGrid");
    grid.innerHTML = "";
    STATS.forEach((s) => {
      const share = Math.min(100, Math.round((s.value / NATIONAL_SIMULATION.totalSPPG) * 100));
      grid.appendChild(el(`<div class="stat-card ${s.cls}">
        <div class="stat-top"><span class="stat-icon">${STAT_ICONS[s.cls]}</span><span class="stat-label">${s.label}</span></div>
        <span class="stat-value" data-target="${s.value}">0</span>
        <div class="stat-bar"><span style="width:${share}%"></span></div>
      </div>`));
    });
    animateCounters();

    document.getElementById("demoCountBadge").textContent = `DATA DEMO: ${SPPG_DATA.length} SPPG dimuat di browser ini`;
  }
  function animateCounters() {
    document.querySelectorAll(".stat-value[data-target]").forEach((elm) => {
      const target = parseInt(elm.dataset.target, 10);
      const duration = 900, start = performance.now();
      function step(now) {
        const p = Math.min(1, (now - start) / duration);
        elm.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* Critical Alert Strip — most prominent element right below the summary */
  function renderCriticalStrip() {
    const strip = document.getElementById("criticalStrip");
    const priority = ALERTS.filter((a) => a.level === "critical" && a.status !== "RESOLVED").slice(0, 3);
    if (!priority.length) { strip.hidden = true; strip.innerHTML = ""; return; }
    strip.hidden = false;
    strip.innerHTML = `
      <div class="strip-head">
        <span class="strip-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>
        </span>
        <strong>${priority.length} PRIORITY ALERTS</strong>
        <button class="link-btn" data-goto="alerts">BUKA EARLY WARNING →</button>
      </div>
      <div class="strip-list">
        ${priority.map((a) => `
          <div class="strip-item">
            <div class="strip-sppg">${escapeHtml(a.sppgName)}</div>
            <div class="strip-msg">${escapeHtml(a.message)}</div>
          </div>`).join("")}
      </div>`;
    strip.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.goto)));
  }

  /* SPPG Requiring Attention — sorted by lowest risk score */
  function renderAttention() {
    const wrap = document.getElementById("attentionList");
    const top = [...SPPG_DATA].sort((a, b) => a.riskScore - b.riskScore).slice(0, 6);
    wrap.innerHTML = "";
    top.forEach((s, i) => {
      const row = el(`
        <button class="attention-row" data-id="${s.id}">
          <span class="attention-rank">${String(i + 1).padStart(2, "0")}</span>
          <span class="attention-main">
            <span class="attention-name">${escapeHtml(s.name)}</span>
            <span class="attention-loc muted">${escapeHtml(s.city)}, ${escapeHtml(s.province)}</span>
          </span>
          <span class="attention-score">Risk ${s.riskScore}</span>
          <span class="status-pill status-${s.status}"><span class="dot dot-${s.status}"></span>${statusLabel(s.status)}</span>
        </button>`);
      row.addEventListener("click", () => openDetailModal(s.id));
      wrap.appendChild(row);
    });
  }

  function renderOps() {
    const list = document.getElementById("opsList");
    const ops = [FEATURED.bogor, FEATURED.depok, FEATURED.bandung, FEATURED.jakarta].map((s) => ({
      sppg: s.name,
      stage: s.production.completion < 100 ? "Produksi" : "Distribusi",
      active: s.distribution.delayed === 0,
    }));
    list.innerHTML = "";
    ops.forEach((op) => {
      list.appendChild(el(`<li><span>${escapeHtml(op.sppg)}<span class="ops-stage">${op.stage}</span></span>
        <span class="ops-status"><span class="dot ${op.active ? "dot-normal" : "dot-warning"}"></span>${op.active ? "Active" : "Delayed"}</span></li>`));
    });
  }
  function renderActivity(highlightFirst) {
    const list = document.getElementById("activityTimeline");
    if (!list) return;
    list.innerHTML = "";
    ACTIVITIES.forEach((a, i) => {
      const li = el(`<li${highlightFirst && i === 0 ? ' class="t-new"' : ""}><span class="t-time">${a.time}</span><span class="t-sppg">${escapeHtml(a.sppg)}</span> — ${escapeHtml(a.text)}</li>`);
      list.appendChild(li);
    });
  }

  // Live activity ticker: every ~9-16s, inject one plausible new event so
  // the Overview panel keeps moving like a real monitoring feed.
  let liveTickerHandle = null;
  function startLiveTicker() {
    if (liveTickerHandle) return;
    function tick() {
      pushLiveActivity();
      if (document.getElementById("activityTimeline")) renderActivity(true);
      liveTickerHandle = setTimeout(tick, 4000 + Math.random() * 5000);
    }
    liveTickerHandle = setTimeout(tick, 4000 + Math.random() * 5000);
  }

  /* =======================================================================
     MAP — lightweight SVG projection + pan/zoom/filter/search/hover/click
     ======================================================================= */
  const MAP_W = 900, MAP_H = 400;
  // Bounding box (in map units) that the traced Indonesia silhouette below
  // actually occupies — computed once from the source outline so lat/lng
  // markers line up with the real landmass instead of being spread across
  // the full empty viewBox.
  const MAP_CONTENT = { x0: 16.0, y0: 38.84, w: 868.0, h: 322.32 };
  const MAP_GEO_BOUNDS = { minLat: -11.05, maxLat: 6.05, minLng: 95.0, maxLng: 141.05 };
  function project(lat, lng) {
    return {
      x: MAP_CONTENT.x0 + (lng - MAP_GEO_BOUNDS.minLng) / (MAP_GEO_BOUNDS.maxLng - MAP_GEO_BOUNDS.minLng) * MAP_CONTENT.w,
      y: MAP_CONTENT.y0 + (MAP_GEO_BOUNDS.maxLat - lat) / (MAP_GEO_BOUNDS.maxLat - MAP_GEO_BOUNDS.minLat) * MAP_CONTENT.h,
    };
  }
  // Real Indonesia silhouette, traced from an outline reference and
  // simplified to a lightweight path (~25 subpaths, one per major
  // island/cluster) — still a single static <path>, so it costs nothing
  // at runtime, unlike a tile-based map library.
  const INDONESIA_LAND_PATH = "M 824.9,181.1 L 831.7,184.7 L 839.1,186.8 L 842.8,190.0 L 845.3,190.1 L 860.7,197.7 L 865.8,196.8 L 869.8,198.9 L 870.9,199.1 L 871.2,198.1 L 875.7,198.9 L 877.9,200.0 L 877.3,202.4 L 883.1,201.9 L 883.1,271.9 L 880.3,279.5 L 881.4,282.3 L 883.1,282.8 L 883.1,325.0 L 879.7,323.4 L 870.7,312.7 L 862.5,305.9 L 858.6,305.7 L 851.9,307.4 L 849.6,305.3 L 846.7,306.2 L 844.2,308.7 L 843.0,307.5 L 842.4,306.3 L 844.0,304.6 L 843.9,301.9 L 845.7,301.1 L 845.7,299.2 L 847.7,295.9 L 844.9,294.7 L 843.6,291.7 L 839.4,288.6 L 846.2,289.4 L 849.4,288.6 L 853.5,289.1 L 853.4,288.5 L 852.1,287.9 L 851.9,285.6 L 843.9,280.7 L 842.1,280.6 L 842.0,279.2 L 834.5,272.7 L 834.0,269.3 L 831.4,264.5 L 831.5,263.3 L 834.4,262.5 L 836.1,260.3 L 837.2,261.7 L 839.7,259.5 L 842.3,260.5 L 843.8,259.5 L 846.7,263.9 L 845.2,262.6 L 845.6,261.4 L 844.0,259.4 L 842.3,260.5 L 840.6,259.4 L 837.2,261.7 L 835.9,260.2 L 835.1,261.6 L 834.6,260.8 L 835.9,259.6 L 839.0,258.7 L 835.7,258.2 L 834.0,259.6 L 831.3,259.7 L 831.1,255.6 L 829.6,255.4 L 828.2,257.2 L 826.3,254.5 L 829.3,252.3 L 830.0,250.0 L 828.3,249.9 L 827.6,251.6 L 821.6,253.8 L 820.5,251.6 L 818.0,250.3 L 819.2,249.8 L 822.8,240.5 L 821.4,235.8 L 822.6,231.6 L 807.4,231.4 L 810.8,212.7 L 818.4,209.7 L 822.5,210.6 L 830.9,209.9 L 835.1,206.9 L 833.0,202.0 L 823.5,192.0 L 824.9,181.1 Z M 875.7,202.1 L 874.4,201.5 L 873.5,202.4 L 872.1,201.1 L 871.5,201.9 L 875.2,202.8 L 875.7,202.1 Z M 881.9,284.4 L 879.4,283.0 L 877.9,284.4 L 878.1,285.7 L 879.4,285.8 L 879.9,284.6 L 880.6,285.9 L 879.6,286.8 L 879.9,288.4 L 882.2,286.1 L 881.9,284.4 Z M 837.1,308.9 L 832.1,311.0 L 819.9,311.2 L 823.9,301.3 L 827.5,296.3 L 833.7,292.7 L 841.0,291.9 L 844.0,295.0 L 846.9,295.5 L 845.4,300.5 L 843.3,302.2 L 843.3,304.3 L 841.5,306.2 L 839.3,306.4 L 837.1,308.9 Z M 846.3,288.7 L 840.9,287.1 L 836.9,283.7 L 838.4,282.6 L 840.0,283.1 L 843.7,281.8 L 851.9,285.7 L 852.6,287.0 L 851.8,287.9 L 852.7,288.9 L 850.7,289.0 L 849.4,287.6 L 848.5,288.7 L 846.3,288.7 Z M 837.4,309.2 L 839.3,306.9 L 841.9,306.2 L 842.5,308.4 L 843.9,309.3 L 843.7,310.8 L 840.5,310.9 L 836.9,310.0 L 837.4,309.2 Z M 831.1,262.6 L 829.7,261.2 L 834.9,259.4 L 835.7,258.2 L 838.6,258.8 L 833.7,260.5 L 834.2,262.5 L 831.1,262.6 Z M 827.7,260.3 L 827.7,257.6 L 829.1,257.2 L 829.7,255.5 L 830.9,255.6 L 830.8,259.7 L 830.0,260.7 L 827.7,260.3 Z M 829.1,251.1 L 829.3,252.1 L 826.2,254.0 L 826.8,256.5 L 824.1,253.9 L 827.8,251.6 L 828.4,250.0 L 830.0,250.0 L 829.1,251.1 Z M 842.2,281.5 L 839.2,279.7 L 839.5,277.9 L 842.0,279.4 L 842.2,281.5 Z M 839.2,281.8 L 838.1,280.7 L 838.4,279.8 L 840.4,280.8 L 839.7,281.2 L 839.2,281.8 Z M 839.5,282.5 L 839.8,281.2 L 840.7,280.7 L 841.5,281.7 L 840.2,282.7 L 839.5,282.5 Z M 823.8,254.0 L 822.3,253.4 L 823.7,252.5 L 823.8,254.0 Z M 442.5,313.2 L 442.6,314.2 L 444.5,314.3 L 445.8,317.4 L 448.9,317.7 L 450.3,316.2 L 454.4,316.0 L 454.4,314.8 L 450.9,312.2 L 449.1,312.5 L 443.7,308.2 L 444.2,306.7 L 448.1,305.2 L 452.2,306.3 L 452.9,308.8 L 455.3,310.7 L 458.6,308.3 L 461.9,309.1 L 462.6,310.3 L 462.1,313.0 L 463.0,313.0 L 462.8,311.3 L 464.7,309.0 L 468.5,309.6 L 469.1,315.7 L 471.4,315.6 L 471.4,316.9 L 470.9,317.8 L 467.9,317.7 L 466.7,316.4 L 466.0,317.2 L 463.6,316.8 L 463.4,318.0 L 467.5,318.9 L 462.1,318.8 L 457.7,320.4 L 456.5,319.5 L 457.3,315.8 L 451.6,320.3 L 450.9,319.6 L 447.4,321.1 L 443.5,321.1 L 438.4,323.5 L 434.6,322.9 L 431.0,324.6 L 425.5,322.2 L 427.0,318.6 L 426.0,316.4 L 426.6,314.9 L 433.0,310.7 L 438.0,312.6 L 439.0,311.3 L 441.3,311.4 L 442.5,313.2 Z M 419.1,321.7 L 418.9,320.8 L 415.4,320.9 L 415.1,320.0 L 412.3,320.7 L 408.4,317.7 L 413.1,317.3 L 412.9,312.1 L 418.8,307.7 L 425.3,310.3 L 424.4,314.2 L 421.5,318.4 L 422.5,320.5 L 420.8,321.0 L 420.8,319.1 L 419.9,319.3 L 419.1,321.7 Z M 441.5,306.5 L 443.7,306.9 L 440.6,311.0 L 439.5,310.4 L 439.7,307.3 L 441.5,306.5 Z M 470.0,306.1 L 470.7,307.8 L 469.4,308.6 L 468.5,307.0 L 470.0,306.1 Z M 528.5,133.2 L 529.2,134.0 L 533.7,133.6 L 540.9,137.5 L 542.4,136.6 L 542.8,134.7 L 546.0,135.4 L 550.7,140.4 L 553.1,140.9 L 553.6,144.4 L 552.6,146.7 L 548.9,146.7 L 545.1,143.2 L 538.4,143.9 L 532.6,143.1 L 521.4,145.1 L 519.6,143.1 L 516.1,142.5 L 516.0,143.5 L 512.6,143.9 L 512.8,142.1 L 510.7,141.6 L 509.3,139.9 L 513.4,136.5 L 515.5,136.8 L 522.7,134.5 L 524.3,136.0 L 528.5,133.2 Z M 543.0,141.9 L 543.4,142.4 L 544.2,142.3 L 543.9,141.2 L 543.0,141.9 Z M 505.8,206.3 L 507.6,205.2 L 509.2,208.9 L 512.0,210.7 L 518.2,207.2 L 521.1,204.0 L 523.8,208.1 L 526.6,208.7 L 530.1,212.0 L 530.4,216.2 L 532.3,217.1 L 531.9,218.2 L 531.0,216.6 L 529.4,216.9 L 530.6,218.3 L 528.6,220.9 L 531.9,223.6 L 533.4,223.6 L 534.6,226.1 L 537.6,226.3 L 536.3,227.8 L 537.4,228.4 L 537.0,230.7 L 539.9,231.2 L 540.8,230.6 L 539.5,229.4 L 540.8,229.3 L 541.7,230.6 L 542.0,235.4 L 540.8,236.7 L 537.8,234.4 L 539.4,236.8 L 539.0,237.8 L 536.0,235.7 L 526.5,238.4 L 525.4,241.8 L 527.0,243.6 L 524.8,245.1 L 521.3,243.9 L 518.6,244.3 L 516.7,243.1 L 514.7,241.1 L 514.7,239.3 L 517.4,229.3 L 512.4,227.9 L 511.6,226.2 L 503.7,219.3 L 503.4,217.7 L 507.0,212.9 L 507.7,208.0 L 505.8,206.3 Z M 543.3,248.6 L 543.1,250.8 L 544.4,249.7 L 547.8,252.9 L 546.3,254.6 L 541.7,255.5 L 540.9,256.3 L 541.8,257.7 L 540.0,260.2 L 539.0,259.1 L 536.7,259.9 L 535.5,256.2 L 537.1,255.1 L 537.2,253.3 L 538.7,251.7 L 539.9,251.7 L 540.1,250.9 L 538.8,250.3 L 541.1,243.0 L 541.0,239.4 L 542.1,236.9 L 544.5,235.3 L 547.5,239.7 L 547.8,241.9 L 547.0,244.0 L 545.7,241.7 L 543.7,243.9 L 543.3,248.6 Z M 530.8,250.7 L 531.0,249.2 L 532.1,248.7 L 531.0,244.0 L 532.0,242.3 L 537.5,239.8 L 538.7,240.3 L 539.3,245.0 L 536.0,250.6 L 537.0,253.8 L 535.2,255.4 L 534.8,252.6 L 533.7,254.7 L 530.1,254.4 L 530.8,250.7 Z M 521.3,251.8 L 522.3,248.5 L 524.7,248.9 L 526.1,250.6 L 525.7,255.7 L 523.9,256.1 L 521.3,251.8 Z M 543.8,228.3 L 548.6,229.5 L 546.0,233.2 L 543.7,232.1 L 542.7,230.1 L 543.8,228.3 Z M 553.9,253.5 L 553.5,252.2 L 556.0,252.8 L 555.4,254.4 L 553.9,253.5 Z M 564.1,266.0 L 562.4,265.3 L 562.1,264.8 L 562.5,263.6 L 563.6,264.3 L 564.1,266.0 Z M 545.5,220.2 L 547.2,220.8 L 545.9,221.5 L 544.6,220.6 L 545.5,220.2 Z M 557.4,256.1 L 558.2,256.6 L 559.4,257.9 L 558.6,258.3 L 557.3,256.8 L 557.4,256.1 Z M 561.9,260.8 L 562.6,261.6 L 561.3,261.8 L 560.7,261.0 L 561.9,260.8 Z M 535.2,259.1 L 535.0,260.1 L 534.1,259.6 L 534.5,258.8 L 535.2,259.1 Z M 532.8,216.9 L 533.8,218.2 L 533.2,219.0 L 532.5,217.7 L 532.8,216.9 Z M 545.0,244.1 L 545.3,243.2 L 546.0,243.3 L 545.8,244.2 L 545.0,244.1 Z M 299.0,301.5 L 301.2,298.8 L 301.4,297.0 L 303.6,297.0 L 303.5,297.7 L 307.1,294.9 L 309.0,299.9 L 313.6,300.3 L 313.0,304.2 L 314.5,307.5 L 307.0,305.5 L 299.0,301.5 Z M 276.7,280.0 L 279.0,281.8 L 280.4,280.6 L 282.1,282.0 L 285.3,282.4 L 289.8,280.7 L 295.6,283.1 L 298.6,283.4 L 302.9,282.2 L 305.5,284.0 L 307.0,283.8 L 309.4,281.1 L 312.5,274.4 L 316.1,273.6 L 318.2,273.9 L 319.3,277.2 L 321.5,278.9 L 324.3,279.2 L 326.9,277.6 L 330.7,280.2 L 328.3,283.9 L 329.4,286.1 L 328.5,288.6 L 326.0,290.1 L 325.8,291.5 L 321.7,290.4 L 322.1,289.5 L 320.3,289.8 L 319.7,292.7 L 321.0,298.2 L 322.9,298.9 L 323.5,300.9 L 322.7,302.4 L 320.2,302.5 L 319.6,304.9 L 316.8,304.9 L 315.8,307.6 L 313.6,306.6 L 313.6,300.3 L 309.0,299.9 L 307.1,294.9 L 303.5,297.7 L 303.6,297.0 L 301.4,297.0 L 299.5,301.6 L 285.1,298.0 L 281.9,297.7 L 279.8,298.9 L 277.6,297.9 L 276.6,296.1 L 276.2,297.5 L 275.0,296.3 L 273.5,291.2 L 271.6,291.1 L 271.5,288.0 L 275.7,286.8 L 275.5,282.9 L 276.7,280.0 Z M 277.3,298.1 L 279.1,298.4 L 279.7,299.5 L 276.3,298.7 L 276.7,297.7 L 277.3,298.1 Z M 236.9,267.7 L 236.3,269.3 L 237.8,272.8 L 232.8,272.7 L 232.1,271.9 L 231.5,272.8 L 231.4,279.1 L 233.0,280.4 L 231.6,281.4 L 230.5,284.7 L 223.1,281.3 L 214.8,282.3 L 209.1,281.5 L 208.6,280.1 L 211.5,278.3 L 213.3,281.6 L 216.7,275.2 L 217.9,276.0 L 219.8,274.8 L 221.1,267.4 L 223.8,263.9 L 224.7,263.8 L 226.5,266.5 L 228.9,265.0 L 232.2,267.0 L 236.2,266.3 L 236.9,267.7 Z M 209.1,276.6 L 208.3,278.2 L 207.9,276.2 L 209.1,276.6 Z M 330.7,280.2 L 333.3,281.0 L 335.9,280.4 L 337.6,282.8 L 344.2,282.3 L 346.2,283.0 L 346.7,282.0 L 347.8,282.8 L 349.2,289.1 L 351.2,288.9 L 352.2,290.6 L 352.3,295.9 L 358.2,298.9 L 360.6,299.6 L 364.4,298.0 L 370.1,298.7 L 371.1,297.7 L 372.8,298.0 L 374.7,296.3 L 375.9,298.0 L 378.7,298.0 L 382.6,300.0 L 380.5,311.6 L 382.5,315.7 L 384.9,316.1 L 385.3,317.8 L 380.7,317.7 L 381.2,316.8 L 380.1,315.4 L 375.0,315.7 L 373.1,314.2 L 370.6,314.0 L 370.2,312.9 L 369.1,313.6 L 366.9,312.0 L 362.6,311.2 L 359.9,309.0 L 356.6,309.0 L 352.9,311.4 L 351.2,311.0 L 349.1,312.1 L 335.9,309.0 L 332.2,308.5 L 330.3,310.7 L 325.3,308.9 L 315.8,307.6 L 316.8,304.9 L 319.6,304.9 L 320.2,302.5 L 322.7,302.4 L 323.5,300.9 L 322.9,298.9 L 321.0,298.2 L 319.7,292.7 L 320.3,289.8 L 322.1,289.5 L 321.7,290.4 L 325.8,291.5 L 326.0,290.1 L 328.5,288.6 L 329.4,286.1 L 328.3,283.9 L 330.7,280.2 Z M 367.3,282.7 L 372.5,282.3 L 376.4,284.5 L 371.9,286.2 L 371.9,287.4 L 366.7,287.2 L 365.7,289.2 L 357.0,289.1 L 349.4,287.7 L 349.3,285.4 L 352.4,282.9 L 367.3,282.7 Z M 402.4,283.8 L 400.2,283.1 L 400.3,284.6 L 399.0,284.7 L 396.6,283.5 L 397.7,281.6 L 403.4,283.0 L 402.4,283.8 Z M 349.2,263.3 L 347.1,262.8 L 349.1,260.8 L 350.2,262.1 L 349.2,263.3 Z M 379.5,286.2 L 381.0,286.4 L 381.8,288.1 L 380.1,288.0 L 379.5,286.2 Z M 409.9,286.9 L 409.8,288.3 L 408.7,288.7 L 406.9,287.7 L 407.7,286.9 L 408.9,287.9 L 409.9,286.9 Z M 360.4,312.4 L 361.1,312.2 L 362.8,312.3 L 362.8,313.1 L 361.1,313.3 L 360.4,312.4 Z M 383.2,287.5 L 384.3,287.1 L 385.5,287.4 L 385.5,288.0 L 383.2,287.5 Z M 633.2,137.5 L 635.0,137.7 L 636.7,136.2 L 637.6,132.4 L 641.1,131.7 L 641.4,129.6 L 639.7,128.9 L 641.0,127.2 L 646.7,123.8 L 651.6,123.2 L 650.8,124.8 L 652.0,127.8 L 650.9,132.7 L 644.3,135.7 L 643.3,136.5 L 644.0,137.5 L 641.9,137.7 L 643.9,140.5 L 651.0,142.5 L 650.8,146.5 L 654.0,148.0 L 638.8,143.8 L 636.4,144.3 L 635.6,147.1 L 636.5,147.7 L 635.9,152.7 L 637.8,157.9 L 642.2,166.1 L 645.1,168.8 L 644.6,169.6 L 642.4,168.9 L 643.1,168.3 L 642.5,167.5 L 638.1,165.4 L 635.4,159.7 L 631.6,156.8 L 633.0,146.9 L 630.8,146.1 L 629.1,142.5 L 629.4,139.1 L 631.2,137.2 L 628.8,136.7 L 628.1,132.9 L 627.1,133.5 L 626.7,132.6 L 630.1,119.7 L 635.0,113.5 L 639.0,111.3 L 637.0,115.4 L 635.2,116.6 L 635.0,118.7 L 638.4,120.7 L 638.0,127.7 L 636.0,131.2 L 630.9,134.6 L 633.2,137.5 Z M 580.3,189.3 L 578.9,188.6 L 570.1,191.0 L 569.0,188.4 L 569.5,185.2 L 572.5,183.7 L 582.9,186.1 L 584.0,184.7 L 587.5,186.5 L 587.3,188.6 L 580.3,189.3 Z M 628.6,185.4 L 626.8,184.2 L 626.9,180.8 L 632.6,178.1 L 641.2,183.3 L 639.9,185.2 L 635.9,184.5 L 628.6,185.4 Z M 643.3,115.2 L 643.9,113.6 L 642.2,109.4 L 644.8,105.6 L 648.7,103.0 L 651.1,106.1 L 649.9,111.0 L 648.0,113.8 L 643.3,115.2 Z M 625.9,163.8 L 624.5,161.7 L 625.9,159.0 L 627.7,160.7 L 629.3,158.7 L 632.2,161.6 L 630.5,164.5 L 632.1,166.2 L 634.3,165.7 L 636.2,167.6 L 634.1,169.0 L 632.2,168.8 L 631.5,166.9 L 628.1,168.3 L 627.4,166.8 L 628.1,165.2 L 625.9,163.8 Z M 600.3,189.0 L 590.0,189.5 L 587.7,187.4 L 588.5,186.4 L 606.6,187.6 L 600.3,189.0 Z M 600.3,199.0 L 597.7,192.2 L 598.7,190.1 L 600.0,190.8 L 599.6,194.0 L 601.6,198.5 L 601.1,199.5 L 600.3,199.0 Z M 624.1,160.8 L 623.9,162.2 L 621.4,162.6 L 621.9,157.8 L 624.2,158.2 L 624.1,160.8 Z M 622.2,166.5 L 623.1,165.0 L 624.8,165.8 L 625.4,167.6 L 622.8,167.5 L 622.2,166.5 Z M 628.6,176.8 L 627.9,176.2 L 629.3,175.1 L 632.2,176.0 L 631.8,177.2 L 628.6,176.8 Z M 665.6,154.6 L 667.5,156.3 L 666.5,156.8 L 663.9,154.1 L 664.4,153.4 L 665.6,154.6 Z M 626.4,139.3 L 627.6,138.9 L 627.2,141.0 L 626.1,140.8 L 626.4,139.3 Z M 624.7,137.4 L 625.1,136.6 L 626.4,137.2 L 626.2,138.5 L 624.9,138.5 L 624.7,137.4 Z M 626.3,147.6 L 625.7,146.6 L 627.0,145.8 L 627.5,146.5 L 627.1,147.5 L 626.3,147.6 Z M 627.9,152.9 L 627.3,153.0 L 627.0,151.8 L 627.5,151.0 L 628.0,152.2 L 627.9,152.9 Z M 625.1,180.0 L 624.7,179.4 L 625.7,178.6 L 626.7,179.3 L 626.2,179.8 L 625.1,180.0 Z M 641.1,107.4 L 641.6,108.3 L 641.5,109.7 L 640.5,109.0 L 641.1,107.4 Z M 644.6,172.4 L 644.5,171.2 L 645.6,171.6 L 645.6,172.4 L 644.6,172.4 Z M 647.4,163.6 L 647.9,164.0 L 649.3,164.4 L 649.2,165.0 L 647.7,164.6 L 647.4,163.6 Z M 643.9,163.1 L 645.0,162.7 L 645.6,163.7 L 643.9,163.1 Z M 625.4,164.7 L 626.3,164.3 L 626.9,164.8 L 625.9,165.4 L 625.4,164.7 Z M 568.3,190.6 L 568.5,190.0 L 569.5,190.0 L 569.5,190.8 L 568.8,191.1 L 568.3,190.6 Z M 607.4,127.5 L 608.6,127.5 L 608.1,128.7 L 607.4,127.5 Z M 691.4,218.3 L 692.3,220.5 L 691.2,222.6 L 691.3,225.9 L 687.3,224.3 L 683.4,221.2 L 675.9,218.4 L 674.3,215.7 L 666.2,215.3 L 667.5,217.1 L 666.9,218.2 L 658.3,215.8 L 656.1,216.1 L 655.3,215.7 L 656.1,213.6 L 654.8,213.2 L 650.5,216.5 L 650.5,217.6 L 646.5,218.0 L 643.3,213.6 L 641.0,212.6 L 641.6,210.6 L 639.6,211.8 L 638.9,215.8 L 637.5,216.6 L 636.3,219.6 L 636.7,216.4 L 635.5,212.9 L 637.9,210.7 L 639.8,210.7 L 641.0,206.8 L 653.0,206.9 L 657.4,205.5 L 659.3,208.7 L 663.4,206.6 L 664.0,205.3 L 665.7,205.3 L 671.6,206.8 L 675.9,209.3 L 682.1,208.9 L 686.9,212.3 L 688.2,217.1 L 690.8,217.2 L 691.4,218.3 Z M 600.3,215.3 L 600.6,212.9 L 602.2,211.7 L 604.5,213.0 L 605.9,211.3 L 615.2,210.6 L 621.1,213.7 L 619.7,214.4 L 620.5,216.5 L 622.2,215.8 L 624.0,216.5 L 623.8,220.6 L 623.3,221.9 L 613.2,225.6 L 604.1,221.3 L 600.3,215.3 Z M 697.4,298.6 L 696.6,298.1 L 699.0,293.7 L 701.0,293.2 L 703.5,289.2 L 704.5,289.1 L 704.3,287.8 L 706.8,286.9 L 706.8,288.1 L 708.1,287.8 L 708.5,288.9 L 706.5,289.5 L 707.3,291.6 L 706.3,297.0 L 703.7,298.5 L 700.3,304.0 L 699.7,302.8 L 698.9,303.7 L 696.5,303.5 L 696.2,300.6 L 697.4,298.6 Z M 596.6,303.7 L 596.6,301.0 L 599.3,297.3 L 603.8,298.5 L 612.4,295.5 L 614.0,297.4 L 615.8,297.3 L 616.3,298.7 L 610.9,300.3 L 609.1,303.2 L 601.5,301.6 L 596.6,303.7 Z M 759.3,278.8 L 757.3,282.3 L 754.9,283.4 L 752.5,281.7 L 753.8,274.7 L 752.9,269.2 L 759.8,274.2 L 761.1,277.3 L 759.3,278.8 Z M 756.4,267.0 L 759.1,266.5 L 761.2,264.5 L 763.5,265.0 L 765.8,267.8 L 764.8,271.8 L 761.5,272.6 L 757.5,270.0 L 756.4,267.0 Z M 765.4,263.2 L 764.5,265.6 L 761.2,264.5 L 757.8,266.6 L 756.8,264.1 L 758.1,263.2 L 758.1,261.7 L 755.2,260.7 L 755.6,259.9 L 757.6,260.9 L 759.7,257.6 L 761.1,257.8 L 761.5,259.5 L 765.4,263.2 Z M 643.0,221.0 L 643.4,222.5 L 641.5,223.5 L 640.3,223.6 L 640.8,221.9 L 637.7,224.0 L 636.3,222.9 L 638.3,220.5 L 644.3,218.9 L 644.4,221.4 L 643.0,221.0 Z M 671.8,304.6 L 670.1,304.5 L 667.7,301.8 L 668.3,300.1 L 672.8,300.7 L 673.1,302.2 L 671.8,304.6 Z M 730.7,262.0 L 734.5,252.3 L 735.6,252.6 L 734.6,257.6 L 731.7,261.0 L 730.4,265.0 L 730.7,262.0 Z M 694.6,236.6 L 698.9,236.9 L 701.9,235.4 L 703.9,236.1 L 703.1,237.8 L 699.7,238.5 L 696.2,237.3 L 694.4,238.0 L 693.8,237.3 L 694.6,236.6 Z M 726.6,261.3 L 725.6,259.1 L 726.5,258.5 L 728.7,261.9 L 728.3,264.8 L 726.1,264.2 L 726.6,261.3 Z M 756.3,269.2 L 759.1,271.3 L 757.7,272.5 L 754.5,269.8 L 753.5,266.7 L 755.4,266.3 L 756.3,269.2 Z M 758.7,271.7 L 759.8,271.2 L 762.4,273.3 L 761.4,276.1 L 758.4,273.5 L 758.7,271.7 Z M 633.8,306.3 L 634.3,305.6 L 640.2,306.9 L 638.9,308.5 L 637.2,308.4 L 633.8,306.3 Z M 696.2,306.9 L 690.2,309.6 L 695.2,305.0 L 697.8,305.8 L 696.2,306.9 Z M 763.3,258.2 L 765.3,259.0 L 764.9,260.7 L 762.7,260.8 L 761.5,259.4 L 761.2,258.0 L 763.3,258.2 Z M 762.3,255.2 L 764.3,257.8 L 760.7,257.5 L 760.7,255.1 L 762.3,255.2 Z M 711.5,288.2 L 708.2,288.0 L 708.1,287.3 L 712.1,286.9 L 712.5,289.5 L 711.5,288.2 Z M 651.0,286.8 L 650.0,289.0 L 647.8,287.3 L 649.1,286.1 L 651.0,286.8 Z M 626.1,294.3 L 628.3,294.7 L 626.2,297.3 L 625.3,296.7 L 626.1,294.3 Z M 645.8,219.8 L 647.2,219.0 L 648.7,220.4 L 645.6,221.3 L 645.8,219.8 Z M 764.4,279.7 L 763.8,280.8 L 762.9,280.3 L 764.8,277.0 L 765.4,277.9 L 764.4,279.7 Z M 649.5,220.3 L 648.3,219.3 L 651.6,219.0 L 651.8,220.7 L 650.6,220.2 L 650.0,221.2 L 649.5,220.3 Z M 694.7,234.7 L 695.6,233.8 L 697.4,234.4 L 697.0,236.0 L 695.4,235.8 L 694.7,234.7 Z M 695.3,294.2 L 694.0,293.9 L 694.4,292.8 L 697.6,292.4 L 696.7,293.7 L 695.3,294.2 Z M 631.4,213.2 L 633.4,212.2 L 634.0,214.0 L 631.4,213.2 Z M 767.6,271.5 L 768.2,272.1 L 767.1,274.3 L 766.3,274.7 L 766.2,273.4 L 767.6,271.5 Z M 637.1,209.4 L 635.0,210.0 L 636.8,208.0 L 638.0,208.2 L 637.1,209.4 Z M 639.7,308.0 L 641.6,307.4 L 642.3,308.9 L 639.6,308.8 L 639.7,308.0 Z M 656.9,308.7 L 653.6,307.6 L 656.0,307.2 L 657.2,307.8 L 656.9,308.7 Z M 628.6,215.5 L 628.2,215.0 L 629.5,214.0 L 630.9,215.3 L 630.0,215.7 L 628.6,215.5 Z M 764.9,274.9 L 765.5,276.0 L 763.8,276.5 L 763.2,275.3 L 764.2,274.4 L 764.9,274.9 Z M 727.8,259.6 L 727.5,258.8 L 727.7,257.9 L 728.4,257.7 L 728.9,259.8 L 727.8,259.6 Z M 695.4,297.1 L 696.9,296.8 L 696.6,297.8 L 694.0,298.7 L 694.0,297.6 L 695.4,297.1 Z M 631.2,307.0 L 632.1,306.6 L 633.3,307.5 L 631.5,308.1 L 630.5,307.6 L 631.2,307.0 Z M 692.2,294.2 L 694.5,294.8 L 694.1,295.4 L 691.7,295.4 L 691.5,294.2 L 692.2,294.2 Z M 622.4,305.9 L 621.8,305.8 L 621.7,304.5 L 623.0,304.2 L 623.5,305.8 L 622.4,305.9 Z M 706.3,279.1 L 704.5,281.1 L 705.1,278.8 L 706.3,279.1 Z M 622.9,226.2 L 622.1,226.0 L 621.8,225.4 L 622.8,224.8 L 623.6,225.7 L 622.9,226.2 Z M 702.6,228.3 L 703.1,229.6 L 702.5,229.7 L 701.5,227.7 L 702.5,227.3 L 702.6,228.3 Z M 764.6,261.2 L 765.2,261.9 L 764.3,262.4 L 763.5,261.0 L 764.6,261.2 Z M 755.9,262.0 L 755.1,262.9 L 754.7,262.5 L 754.9,261.3 L 755.9,262.0 Z M 761.6,253.5 L 762.4,253.5 L 761.3,255.0 L 760.7,254.2 L 761.6,253.5 Z M 407.1,177.7 L 405.0,183.1 L 406.7,186.9 L 406.4,191.5 L 408.3,191.9 L 407.8,194.6 L 408.8,197.9 L 411.5,196.5 L 416.5,196.5 L 422.3,198.3 L 421.4,201.2 L 419.9,199.9 L 417.6,200.7 L 419.2,201.6 L 418.7,207.1 L 416.9,209.5 L 415.8,209.5 L 414.8,207.5 L 413.8,207.9 L 415.8,211.8 L 415.1,214.2 L 412.5,216.2 L 411.2,221.0 L 386.9,231.7 L 386.0,231.1 L 385.6,221.5 L 383.3,218.9 L 380.7,218.0 L 380.7,216.0 L 384.4,210.7 L 383.5,209.7 L 384.8,206.9 L 385.8,207.2 L 385.4,205.9 L 388.5,204.2 L 389.3,201.5 L 393.7,197.2 L 398.5,194.8 L 399.1,191.9 L 400.7,191.7 L 399.1,187.0 L 400.8,179.7 L 407.1,177.7 Z M 417.7,226.4 L 413.6,229.4 L 412.6,228.7 L 413.4,225.2 L 412.0,222.3 L 412.7,218.3 L 414.0,215.1 L 416.6,213.4 L 417.5,222.9 L 418.2,223.2 L 417.0,224.9 L 417.7,226.4 Z M 419.7,218.8 L 418.7,221.7 L 417.7,219.9 L 419.2,217.2 L 420.0,217.4 L 419.7,218.8 Z M 378.0,126.3 L 377.0,126.8 L 376.4,131.1 L 373.9,131.3 L 372.1,133.3 L 371.9,136.2 L 372.8,137.0 L 371.2,140.3 L 365.0,146.8 L 360.4,148.4 L 362.9,150.3 L 363.3,152.7 L 359.5,159.3 L 360.3,161.0 L 359.6,161.8 L 357.8,161.4 L 350.6,163.6 L 347.7,165.8 L 342.1,166.7 L 340.2,164.5 L 336.4,166.6 L 335.6,168.3 L 334.7,167.5 L 334.7,169.3 L 329.4,171.4 L 328.2,175.7 L 326.9,175.9 L 326.8,177.0 L 324.2,177.1 L 321.1,181.0 L 319.7,180.9 L 319.9,182.0 L 317.2,181.9 L 314.9,183.7 L 316.0,185.3 L 317.6,184.8 L 317.2,189.7 L 319.2,190.7 L 318.2,195.2 L 320.7,204.0 L 311.1,210.2 L 309.5,206.5 L 304.4,209.4 L 303.6,208.8 L 302.9,207.3 L 303.5,205.0 L 301.7,202.6 L 302.4,200.5 L 300.4,195.2 L 300.5,190.3 L 296.9,187.5 L 299.3,184.4 L 299.7,178.0 L 297.1,175.4 L 297.8,174.0 L 294.2,171.6 L 292.2,171.7 L 290.9,169.8 L 288.0,169.0 L 287.5,170.4 L 285.5,169.8 L 284.4,168.1 L 284.5,165.4 L 291.8,168.0 L 291.1,166.3 L 292.6,166.0 L 287.8,164.8 L 287.0,163.7 L 284.8,164.2 L 282.3,163.2 L 281.5,158.1 L 283.5,157.1 L 283.1,151.4 L 281.2,147.9 L 278.2,146.8 L 278.2,140.4 L 276.8,137.4 L 279.0,135.5 L 279.4,133.9 L 278.2,131.2 L 280.5,128.0 L 281.0,124.2 L 284.7,121.5 L 286.1,116.5 L 291.0,115.2 L 290.4,117.9 L 292.7,119.6 L 292.3,122.1 L 295.5,126.0 L 297.5,126.1 L 298.2,128.2 L 302.3,130.7 L 304.0,134.1 L 306.3,134.3 L 309.5,136.8 L 319.6,133.5 L 333.7,134.0 L 335.6,131.6 L 338.8,131.3 L 340.6,125.4 L 345.5,123.2 L 355.4,123.3 L 356.5,123.9 L 354.8,126.4 L 361.3,126.9 L 363.2,128.7 L 365.3,128.0 L 367.7,129.9 L 373.7,125.5 L 376.8,125.3 L 378.0,126.3 Z M 293.1,171.7 L 294.2,171.8 L 294.6,174.4 L 289.3,177.6 L 287.7,177.1 L 289.1,171.2 L 293.1,171.7 Z M 277.8,181.9 L 279.5,183.0 L 277.2,184.4 L 276.5,182.4 L 277.8,181.9 Z M 281.4,158.0 L 280.8,157.7 L 281.5,156.8 L 282.8,156.8 L 282.1,157.7 L 281.4,158.0 Z M 289.3,165.7 L 288.8,164.6 L 290.9,165.2 L 289.3,165.7 Z M 282.4,154.6 L 283.0,154.6 L 283.4,155.5 L 283.2,156.5 L 282.3,155.3 L 282.4,154.6 Z M 300.0,204.0 L 300.8,203.3 L 301.1,204.6 L 300.2,205.0 L 300.0,204.0 Z M 478.8,169.1 L 479.8,174.9 L 479.1,176.9 L 476.5,178.1 L 478.1,180.0 L 480.4,179.4 L 481.5,180.4 L 481.0,182.0 L 483.0,184.8 L 482.8,186.1 L 485.4,186.7 L 484.2,191.5 L 487.1,189.9 L 493.4,191.6 L 494.8,188.5 L 500.5,194.6 L 505.2,195.1 L 511.8,197.5 L 519.3,200.9 L 521.1,204.0 L 518.2,207.2 L 512.0,210.7 L 509.2,208.9 L 507.6,205.2 L 505.8,206.3 L 507.5,203.8 L 502.4,202.2 L 498.6,203.3 L 495.7,206.1 L 490.8,208.7 L 492.1,212.5 L 494.4,213.2 L 494.8,214.8 L 494.4,218.9 L 495.6,223.4 L 493.6,226.4 L 493.4,230.1 L 494.5,234.6 L 493.6,236.3 L 495.5,240.7 L 494.3,244.1 L 492.8,244.9 L 492.1,250.0 L 494.6,253.7 L 495.7,258.8 L 492.8,256.9 L 488.6,258.4 L 485.7,257.6 L 483.0,260.4 L 480.3,259.9 L 480.5,259.0 L 477.5,257.8 L 476.6,258.4 L 475.1,255.1 L 475.6,250.3 L 478.2,245.7 L 477.6,242.2 L 479.5,239.1 L 480.3,234.0 L 480.2,228.3 L 476.9,223.0 L 477.9,219.5 L 473.8,217.5 L 466.9,220.1 L 464.1,211.3 L 465.7,210.0 L 466.2,207.3 L 463.9,206.9 L 463.8,205.2 L 464.9,202.2 L 465.9,203.4 L 467.6,202.6 L 469.2,200.1 L 470.7,199.6 L 472.3,190.6 L 474.6,189.9 L 475.0,188.7 L 473.6,184.7 L 474.5,182.5 L 474.0,176.9 L 478.8,169.1 Z M 484.9,228.8 L 485.2,227.7 L 484.2,227.5 L 484.4,228.5 L 484.9,228.8 Z M 485.7,231.0 L 486.5,231.5 L 487.4,229.3 L 485.4,229.4 L 485.7,231.0 Z M 497.4,266.0 L 496.2,273.6 L 495.3,271.1 L 495.9,261.9 L 497.4,266.0 Z M 500.2,287.2 L 498.5,286.7 L 499.5,285.0 L 502.0,286.7 L 500.2,287.2 Z M 504.5,290.7 L 502.5,290.3 L 506.4,290.2 L 506.1,291.1 L 504.5,290.7 Z M 521.2,294.2 L 520.7,292.7 L 521.2,291.8 L 522.1,292.0 L 521.7,294.0 L 521.2,294.2 Z M 507.7,291.4 L 508.3,290.8 L 509.3,291.4 L 508.0,292.3 L 507.7,291.4 Z M 473.5,255.7 L 474.3,256.8 L 473.2,257.2 L 473.5,255.7 Z M 236.9,267.7 L 241.7,267.7 L 240.6,272.9 L 238.0,271.9 L 236.3,269.3 L 236.9,267.7 Z M 230.8,284.4 L 231.6,281.4 L 233.0,280.4 L 231.4,279.1 L 230.9,276.0 L 232.1,271.9 L 232.8,272.7 L 237.8,272.8 L 238.0,271.9 L 240.6,272.9 L 242.9,264.3 L 244.8,265.6 L 247.9,265.2 L 251.0,268.6 L 254.5,270.5 L 257.7,269.3 L 263.0,272.3 L 264.7,270.9 L 267.9,271.1 L 269.1,273.8 L 271.2,275.1 L 272.4,280.5 L 275.4,281.3 L 276.7,280.0 L 275.5,282.9 L 275.7,286.8 L 271.5,288.0 L 271.6,291.1 L 273.5,291.2 L 275.0,296.3 L 276.2,297.5 L 270.7,298.0 L 269.1,300.3 L 266.0,300.0 L 258.0,298.7 L 249.6,294.1 L 233.1,292.5 L 230.3,290.7 L 233.6,284.5 L 230.8,284.4 Z M 763.5,206.1 L 764.2,209.0 L 765.3,209.3 L 767.0,207.5 L 766.4,209.8 L 767.3,214.1 L 771.8,216.4 L 778.6,216.5 L 781.5,212.7 L 787.4,208.8 L 787.2,206.9 L 789.3,203.5 L 793.2,201.9 L 795.0,195.8 L 796.7,194.4 L 802.7,195.2 L 806.6,192.8 L 810.8,192.3 L 812.1,190.6 L 809.5,187.8 L 809.6,186.8 L 819.8,181.5 L 824.4,180.4 L 824.6,188.0 L 823.5,192.0 L 833.0,202.0 L 835.1,206.9 L 830.9,209.9 L 822.5,210.6 L 818.4,209.7 L 810.8,212.7 L 807.4,231.4 L 822.6,231.6 L 821.4,235.8 L 822.8,240.5 L 819.8,247.0 L 818.5,246.6 L 818.0,249.3 L 817.0,249.9 L 815.8,248.7 L 816.3,245.6 L 814.1,247.9 L 813.2,247.2 L 814.8,246.3 L 814.4,244.9 L 811.3,247.1 L 810.1,246.5 L 810.4,245.0 L 808.8,243.2 L 807.8,246.0 L 804.6,243.6 L 800.3,243.7 L 797.4,241.7 L 791.0,240.0 L 787.8,237.8 L 791.8,231.8 L 785.0,231.8 L 783.1,226.7 L 781.7,225.9 L 755.1,216.8 L 757.2,212.9 L 759.2,211.5 L 759.2,209.6 L 763.5,206.1 Z M 785.4,172.3 L 784.1,168.5 L 782.2,169.7 L 777.8,167.1 L 776.7,164.8 L 782.0,165.3 L 782.9,166.3 L 786.3,166.1 L 789.5,168.7 L 792.0,172.5 L 793.7,172.0 L 796.1,173.3 L 791.5,175.6 L 789.4,174.5 L 787.0,175.1 L 785.4,174.3 L 785.4,172.3 Z M 796.2,185.3 L 805.3,186.4 L 804.9,187.3 L 802.6,187.1 L 800.8,188.2 L 793.9,188.5 L 783.3,184.8 L 778.9,184.5 L 778.2,183.2 L 792.8,184.0 L 796.2,185.3 Z M 769.2,173.8 L 768.1,174.2 L 766.2,172.2 L 767.1,170.3 L 769.2,171.1 L 769.2,173.8 Z M 815.3,249.1 L 814.1,247.9 L 816.1,246.3 L 815.3,249.1 Z M 813.0,247.1 L 812.1,247.0 L 813.0,245.4 L 814.6,245.0 L 813.0,247.1 Z M 773.7,181.4 L 772.6,180.6 L 776.1,181.3 L 773.7,181.4 Z M 805.3,245.0 L 803.7,245.0 L 804.9,244.0 L 805.3,245.0 Z M 809.8,246.4 L 808.8,245.9 L 809.5,244.8 L 810.2,244.9 L 810.1,246.1 L 809.8,246.4 Z M 801.8,243.8 L 803.3,243.6 L 803.0,244.7 L 801.8,243.8 Z M 818.9,248.9 L 818.9,249.0 L 818.1,248.4 L 818.6,247.8 L 819.2,248.1 L 818.9,248.9 Z M 536.6,311.3 L 541.8,308.9 L 542.4,307.4 L 538.9,307.6 L 539.7,305.8 L 541.3,304.9 L 543.3,306.3 L 544.2,309.7 L 542.5,309.9 L 541.8,312.2 L 539.8,311.8 L 540.7,314.9 L 532.1,318.0 L 527.3,317.6 L 521.5,320.3 L 513.3,318.7 L 511.9,321.1 L 508.5,320.8 L 506.0,321.8 L 502.8,319.2 L 500.9,320.2 L 497.4,318.6 L 493.3,319.5 L 490.6,318.3 L 486.0,319.4 L 483.4,317.6 L 483.5,314.5 L 485.6,312.4 L 487.2,312.2 L 487.9,310.7 L 490.1,310.7 L 491.0,309.3 L 495.6,308.1 L 496.0,309.0 L 499.6,309.0 L 501.2,310.1 L 505.7,310.2 L 515.6,315.3 L 517.5,313.1 L 521.3,313.4 L 525.4,312.1 L 525.2,313.7 L 529.2,315.5 L 534.0,315.3 L 534.3,312.5 L 536.6,311.3 Z M 563.5,329.0 L 564.5,330.4 L 566.5,329.6 L 568.1,332.1 L 571.2,328.4 L 571.5,326.0 L 574.3,325.6 L 576.0,323.6 L 580.5,321.9 L 580.4,323.4 L 581.3,323.8 L 583.6,322.1 L 584.9,323.0 L 584.7,325.9 L 581.2,326.6 L 583.2,331.3 L 581.2,334.7 L 572.0,343.2 L 569.8,344.6 L 564.4,344.8 L 562.9,346.4 L 558.8,348.1 L 552.4,348.1 L 553.8,344.7 L 557.8,343.2 L 557.9,341.9 L 554.7,342.0 L 554.8,340.0 L 556.4,337.9 L 556.4,334.8 L 558.7,331.9 L 563.5,329.0 Z M 481.2,338.1 L 477.3,336.5 L 475.7,337.5 L 471.8,336.6 L 469.0,335.3 L 467.0,333.0 L 467.3,332.2 L 471.9,329.6 L 480.3,329.0 L 483.4,330.0 L 486.1,327.8 L 489.2,331.5 L 491.4,331.8 L 492.1,334.7 L 495.7,334.4 L 497.6,336.0 L 499.3,339.0 L 502.2,340.8 L 502.7,343.0 L 496.1,347.1 L 491.2,346.2 L 486.0,341.0 L 481.2,338.1 Z M 569.3,310.8 L 572.2,308.6 L 572.4,307.9 L 570.2,308.8 L 571.6,306.1 L 573.9,306.1 L 573.8,307.3 L 583.1,306.6 L 584.1,308.0 L 583.8,310.2 L 582.4,310.5 L 570.8,312.3 L 568.9,311.7 L 569.3,310.8 Z M 553.7,310.5 L 558.4,306.9 L 560.8,307.8 L 560.9,308.5 L 558.2,309.1 L 556.5,311.7 L 555.5,311.3 L 554.2,312.6 L 554.8,313.9 L 554.1,314.4 L 553.3,313.5 L 551.1,314.7 L 548.2,313.3 L 552.7,310.0 L 552.0,308.8 L 553.9,308.1 L 553.7,310.5 Z M 547.5,352.5 L 551.5,349.9 L 550.9,351.8 L 551.9,353.7 L 548.6,355.2 L 547.8,356.8 L 540.4,358.7 L 540.1,356.6 L 541.0,355.6 L 544.7,355.0 L 547.5,352.5 Z M 561.5,311.3 L 563.7,309.2 L 564.5,310.6 L 566.9,307.7 L 568.6,307.1 L 568.2,309.9 L 565.2,313.8 L 563.8,314.1 L 563.2,311.7 L 561.5,311.3 Z M 546.9,311.1 L 543.8,311.3 L 544.4,309.5 L 548.4,308.0 L 549.6,310.5 L 546.9,311.1 Z M 522.5,352.9 L 519.2,352.2 L 522.9,349.4 L 524.8,349.6 L 524.8,351.2 L 522.5,352.9 Z M 476.7,317.8 L 475.6,317.3 L 475.5,314.6 L 476.4,312.1 L 477.4,312.2 L 479.2,312.9 L 479.0,314.7 L 477.0,315.3 L 476.7,317.8 Z M 550.0,347.9 L 549.5,346.4 L 552.3,343.6 L 551.8,347.0 L 550.0,347.9 Z M 543.8,313.0 L 541.8,315.3 L 541.6,313.7 L 543.4,311.9 L 546.6,312.4 L 543.8,313.0 Z M 480.4,315.0 L 481.1,316.6 L 483.5,315.3 L 482.0,316.5 L 481.9,318.6 L 479.9,317.8 L 480.4,315.0 Z M 591.7,309.4 L 591.0,308.7 L 593.1,306.4 L 592.5,309.6 L 591.7,309.4 Z M 532.3,313.2 L 531.7,313.0 L 531.3,312.0 L 532.1,311.9 L 532.9,312.8 L 532.3,313.2 Z M 519.7,310.5 L 518.9,309.8 L 519.9,309.4 L 519.7,310.5 Z M 396.7,317.5 L 397.4,318.7 L 394.6,319.4 L 396.0,318.4 L 395.6,316.2 L 391.6,312.6 L 385.0,311.0 L 382.5,307.8 L 382.4,305.4 L 390.2,307.4 L 392.9,306.9 L 396.4,304.8 L 401.5,306.7 L 406.2,310.4 L 404.5,313.2 L 399.8,314.6 L 396.7,317.5 Z M 404.7,318.2 L 404.1,319.1 L 401.4,317.3 L 403.6,316.3 L 404.7,318.2 Z M 116.5,105.1 L 118.4,110.0 L 120.9,112.1 L 125.2,113.9 L 126.7,115.6 L 126.9,114.4 L 125.1,112.9 L 124.7,110.8 L 127.9,109.5 L 130.2,109.8 L 135.1,115.3 L 136.8,120.8 L 139.4,121.9 L 143.4,121.5 L 150.7,126.8 L 152.5,134.5 L 155.3,137.4 L 157.2,138.6 L 164.5,139.0 L 168.9,144.2 L 173.0,142.5 L 174.5,143.0 L 180.5,147.6 L 181.9,152.9 L 178.0,153.3 L 176.2,156.4 L 181.4,159.3 L 174.8,162.7 L 174.4,166.6 L 175.9,167.4 L 167.0,167.1 L 160.0,174.0 L 155.4,172.3 L 153.7,170.2 L 152.0,170.7 L 147.6,169.5 L 145.0,171.4 L 141.4,170.5 L 135.9,165.3 L 130.4,162.3 L 129.7,159.3 L 128.0,158.8 L 127.4,159.9 L 126.0,158.9 L 124.4,154.1 L 124.9,149.7 L 119.0,148.7 L 117.7,146.5 L 115.6,146.6 L 114.1,141.7 L 115.1,139.5 L 112.9,137.8 L 112.0,135.6 L 113.3,134.0 L 112.3,132.7 L 113.3,131.2 L 111.7,126.7 L 118.0,125.2 L 118.8,122.2 L 117.9,119.4 L 115.6,118.4 L 117.0,111.0 L 115.9,107.4 L 116.5,105.1 Z M 265.1,83.9 L 262.7,83.3 L 264.7,81.6 L 262.1,80.5 L 260.9,77.5 L 265.2,73.1 L 265.5,74.8 L 268.6,78.2 L 268.3,81.4 L 266.7,83.9 L 265.1,83.9 Z M 161.9,134.0 L 167.6,137.4 L 167.6,139.4 L 166.6,139.9 L 164.2,138.0 L 158.3,138.3 L 155.5,136.2 L 157.3,135.1 L 156.9,131.6 L 158.4,132.0 L 159.4,134.0 L 161.9,134.0 Z M 139.5,114.2 L 141.4,112.7 L 143.7,115.4 L 142.8,119.6 L 140.7,121.0 L 137.6,120.3 L 136.3,116.9 L 136.7,114.7 L 139.5,114.2 Z M 194.0,134.0 L 194.2,133.0 L 190.5,134.0 L 189.8,132.9 L 191.8,130.7 L 196.6,130.4 L 198.1,133.5 L 196.9,137.6 L 193.9,135.8 L 194.0,134.0 Z M 157.1,129.7 L 156.1,132.5 L 157.0,134.9 L 155.2,135.7 L 152.3,132.1 L 151.8,126.4 L 153.4,126.2 L 157.1,129.7 Z M 162.9,134.0 L 160.1,133.5 L 162.1,131.0 L 166.4,132.3 L 169.7,136.8 L 168.2,137.2 L 162.9,134.0 Z M 147.9,122.8 L 156.6,124.2 L 157.5,129.2 L 153.5,126.0 L 150.4,125.4 L 147.9,122.8 Z M 196.7,152.9 L 199.9,156.5 L 201.7,155.8 L 203.2,158.2 L 201.7,159.0 L 198.9,156.8 L 195.4,158.1 L 194.0,157.5 L 193.7,156.4 L 195.2,155.3 L 196.1,152.5 L 196.7,152.9 Z M 192.4,161.1 L 193.9,159.4 L 195.7,159.9 L 196.7,161.5 L 195.0,165.1 L 193.9,163.9 L 192.9,165.5 L 192.1,165.2 L 190.5,162.3 L 190.9,160.4 L 192.4,161.1 Z M 176.2,140.7 L 174.3,140.7 L 173.4,139.0 L 173.8,135.9 L 176.8,137.9 L 176.2,140.7 Z M 184.9,134.0 L 184.1,131.5 L 187.6,130.3 L 188.5,131.5 L 188.3,133.4 L 184.9,134.0 Z M 170.6,139.6 L 172.4,141.6 L 172.1,142.9 L 169.8,143.4 L 169.7,140.0 L 170.6,139.6 Z M 219.9,96.8 L 219.0,99.5 L 217.7,99.4 L 217.9,96.6 L 219.9,96.8 Z M 188.5,135.9 L 190.7,136.7 L 190.2,137.5 L 189.0,138.1 L 187.4,136.5 L 187.5,134.8 L 188.5,135.9 Z M 276.6,97.3 L 277.8,96.5 L 276.6,99.2 L 275.7,98.6 L 276.6,97.3 Z M 196.0,150.3 L 195.6,148.6 L 198.2,151.5 L 196.0,150.3 Z M 173.9,134.0 L 172.6,132.6 L 173.4,131.5 L 175.0,134.2 L 173.9,134.0 Z M 227.2,93.4 L 227.1,92.3 L 228.5,92.7 L 227.8,94.5 L 227.2,93.4 Z M 183.7,134.0 L 185.0,134.7 L 184.1,135.3 L 182.6,134.6 L 182.9,133.5 L 183.7,134.0 Z M 182.1,137.1 L 182.6,138.5 L 181.4,137.9 L 180.3,136.5 L 180.9,136.2 L 182.1,137.1 Z M 190.6,138.8 L 190.2,139.7 L 189.2,139.0 L 189.2,138.2 L 190.4,137.8 L 190.6,138.8 Z M 228.9,90.1 L 228.9,91.0 L 228.3,92.1 L 227.8,91.3 L 227.9,89.9 L 228.9,90.1 Z M 194.4,151.9 L 193.0,151.0 L 193.8,150.3 L 194.9,151.6 L 194.4,151.9 Z M 279.4,105.0 L 280.1,104.6 L 281.4,106.0 L 280.0,105.9 L 280.3,105.2 L 279.4,105.0 Z M 183.5,136.6 L 183.9,137.0 L 183.3,137.8 L 182.4,136.9 L 183.5,136.6 Z M 175.7,135.8 L 175.9,136.7 L 175.3,136.7 L 174.4,136.0 L 175.0,135.4 L 175.7,135.8 Z M 192.3,146.1 L 193.6,146.7 L 193.2,147.4 L 192.3,147.0 L 192.3,146.1 Z M 478.8,169.1 L 481.2,167.3 L 482.1,165.3 L 484.3,169.5 L 484.9,169.1 L 482.7,162.1 L 483.8,156.4 L 483.3,155.1 L 481.1,155.2 L 479.8,153.1 L 481.9,153.0 L 483.0,155.0 L 484.1,155.0 L 485.1,153.1 L 484.8,150.9 L 483.0,149.2 L 485.5,148.5 L 484.4,146.3 L 485.6,143.9 L 488.1,143.3 L 487.6,140.4 L 491.6,137.9 L 491.9,134.8 L 493.8,134.3 L 493.4,136.8 L 498.1,138.4 L 498.7,136.4 L 502.1,133.3 L 502.9,128.0 L 505.6,127.5 L 510.5,129.5 L 514.5,128.0 L 514.2,130.8 L 516.7,132.7 L 523.7,132.0 L 524.8,133.5 L 526.9,132.6 L 528.5,133.2 L 524.3,136.0 L 522.7,134.5 L 511.6,137.3 L 509.3,139.9 L 510.7,141.6 L 512.8,142.1 L 512.6,143.9 L 504.3,145.5 L 500.4,143.3 L 497.2,143.2 L 493.0,145.1 L 490.2,148.7 L 487.4,156.2 L 488.3,164.8 L 493.1,171.1 L 494.9,170.3 L 496.7,171.7 L 498.4,174.9 L 498.0,176.5 L 500.2,179.7 L 503.1,178.7 L 503.4,179.6 L 508.3,179.7 L 511.7,173.7 L 515.0,169.9 L 518.3,168.1 L 518.4,170.0 L 524.0,171.7 L 525.0,170.6 L 526.8,171.0 L 528.7,167.8 L 536.8,167.3 L 538.7,168.2 L 542.2,167.4 L 539.3,166.1 L 540.2,164.8 L 543.0,165.1 L 545.9,163.7 L 551.5,165.3 L 552.3,167.3 L 550.4,172.4 L 548.7,172.7 L 545.7,168.7 L 544.8,169.9 L 539.8,170.8 L 538.3,174.3 L 532.3,180.9 L 529.1,183.0 L 522.6,184.5 L 519.0,189.5 L 516.7,189.6 L 514.6,186.9 L 511.7,186.8 L 512.1,189.4 L 514.0,189.4 L 516.0,191.5 L 516.4,193.8 L 518.9,194.0 L 521.6,196.1 L 525.5,203.0 L 525.0,204.0 L 528.3,206.1 L 528.3,207.0 L 530.9,207.8 L 529.7,209.9 L 534.1,212.8 L 530.8,214.5 L 528.5,210.0 L 523.8,208.1 L 519.3,200.9 L 505.2,195.1 L 500.5,194.6 L 494.8,188.5 L 493.4,191.6 L 487.1,189.9 L 484.2,191.5 L 485.4,186.7 L 482.8,186.1 L 483.0,184.8 L 481.0,182.0 L 481.5,180.4 L 480.4,179.4 L 478.1,180.0 L 476.5,178.1 L 479.1,176.9 L 479.8,174.9 L 478.8,169.1 Z M 497.3,188.2 L 499.1,191.7 L 500.2,191.8 L 498.5,186.6 L 497.2,186.6 L 497.3,188.2 Z M 547.0,183.7 L 545.7,182.7 L 547.3,181.4 L 546.7,177.7 L 541.2,183.0 L 539.8,179.0 L 542.0,175.2 L 545.8,174.9 L 546.5,175.7 L 547.3,174.8 L 548.4,176.1 L 547.4,177.9 L 548.5,179.2 L 550.6,176.1 L 554.3,177.2 L 552.4,181.5 L 550.7,181.2 L 549.4,179.5 L 547.0,183.7 Z M 552.8,184.1 L 553.2,181.3 L 554.1,181.3 L 554.5,183.2 L 555.6,183.5 L 555.4,184.8 L 553.1,185.1 L 552.8,184.1 Z M 523.3,161.4 L 523.4,162.7 L 521.8,162.2 L 518.6,163.4 L 520.3,161.0 L 523.3,161.4 Z M 524.3,160.8 L 522.5,160.7 L 522.5,159.6 L 526.0,159.5 L 526.1,160.5 L 524.3,160.8 Z M 546.3,186.4 L 546.4,188.1 L 545.0,189.1 L 545.5,186.2 L 546.3,186.4 Z M 526.7,160.5 L 526.0,159.8 L 526.8,158.5 L 527.8,160.4 L 526.7,160.5 Z M 560.0,190.5 L 558.6,190.2 L 558.3,188.8 L 560.0,190.5 Z M 531.8,159.7 L 530.5,157.9 L 530.7,157.4 L 532.0,158.2 L 531.8,159.7 Z M 517.8,156.9 L 516.7,156.3 L 517.4,155.3 L 518.2,155.3 L 518.3,156.5 L 517.8,156.9 Z M 549.7,185.3 L 550.6,184.5 L 551.1,185.1 L 549.7,186.5 L 548.8,186.6 L 549.7,185.3 Z M 549.9,175.5 L 549.7,176.7 L 549.0,175.9 L 549.9,175.5 Z M 372.6,134.4 L 372.1,133.3 L 373.9,131.3 L 376.4,131.1 L 377.0,126.8 L 378.6,125.7 L 381.8,124.3 L 384.9,125.8 L 387.5,121.3 L 387.3,118.7 L 390.7,116.7 L 391.0,115.0 L 389.3,114.4 L 388.9,112.5 L 389.3,110.6 L 391.4,110.3 L 392.2,108.3 L 397.4,105.9 L 396.0,103.7 L 395.1,104.1 L 395.6,99.8 L 394.8,99.6 L 398.4,95.3 L 399.2,96.6 L 400.4,96.5 L 402.2,95.7 L 403.6,93.1 L 403.1,90.2 L 404.2,87.8 L 405.3,88.0 L 403.9,84.8 L 404.7,80.0 L 403.7,79.1 L 405.1,78.0 L 406.0,74.5 L 407.5,73.0 L 408.6,73.2 L 409.5,70.3 L 413.4,72.3 L 415.0,70.3 L 418.6,70.3 L 420.7,71.9 L 422.6,69.9 L 423.6,71.2 L 425.8,70.3 L 427.5,71.3 L 435.4,70.5 L 440.5,74.4 L 440.5,75.6 L 438.5,74.8 L 438.8,75.7 L 445.4,81.6 L 440.4,81.7 L 439.5,83.0 L 440.0,85.2 L 438.0,84.4 L 431.5,85.0 L 434.7,85.0 L 435.3,87.4 L 438.5,89.2 L 436.7,93.1 L 438.8,93.2 L 439.7,94.5 L 439.1,95.4 L 442.4,95.3 L 441.2,98.2 L 444.2,98.4 L 442.3,100.3 L 445.3,101.2 L 445.9,103.7 L 451.2,109.6 L 449.8,111.6 L 444.4,111.7 L 444.3,113.6 L 445.7,113.2 L 445.5,115.0 L 447.0,115.9 L 447.8,118.7 L 450.2,119.2 L 451.8,122.0 L 457.2,124.8 L 457.7,126.6 L 460.0,127.0 L 466.0,132.7 L 468.2,133.5 L 464.4,137.8 L 462.3,136.7 L 456.5,137.7 L 450.7,135.8 L 447.5,131.6 L 450.1,138.1 L 447.9,137.1 L 444.8,138.7 L 442.1,143.8 L 439.8,149.9 L 440.5,153.4 L 438.5,157.5 L 439.3,161.4 L 438.4,163.1 L 436.0,163.8 L 435.4,170.0 L 430.7,175.5 L 427.1,177.0 L 425.5,173.6 L 426.1,171.7 L 425.1,174.0 L 426.2,178.5 L 422.2,180.2 L 422.4,183.0 L 416.6,186.4 L 420.3,186.2 L 419.7,188.1 L 420.5,191.2 L 419.0,192.3 L 421.3,192.6 L 423.0,194.3 L 422.3,198.3 L 416.5,196.5 L 411.5,196.5 L 408.8,197.9 L 407.8,194.6 L 408.3,191.9 L 406.4,191.5 L 406.7,186.9 L 404.9,181.8 L 408.9,174.8 L 407.1,174.1 L 402.3,168.9 L 400.4,168.4 L 397.3,158.6 L 399.0,154.6 L 398.6,153.5 L 393.8,156.5 L 392.0,156.5 L 390.8,151.9 L 389.1,151.1 L 390.9,147.3 L 393.8,147.2 L 395.3,145.9 L 392.8,139.4 L 391.3,138.1 L 390.1,139.4 L 388.6,138.9 L 384.4,141.0 L 381.9,143.5 L 378.1,142.8 L 376.1,139.7 L 371.2,140.3 L 372.8,137.0 L 371.9,136.2 L 372.6,134.4 Z M 444.5,82.4 L 446.1,82.8 L 443.3,84.8 L 439.8,82.9 L 440.5,81.8 L 444.5,82.4 Z M 447.8,74.4 L 448.2,76.3 L 447.0,76.9 L 443.9,74.6 L 446.5,73.7 L 447.8,74.4 Z M 436.0,85.4 L 440.5,87.5 L 435.1,87.1 L 434.9,85.7 L 436.0,85.4 Z M 444.4,77.5 L 443.3,78.2 L 442.0,77.2 L 442.7,74.8 L 444.9,76.2 L 444.4,77.5 Z M 441.4,88.2 L 443.2,88.6 L 443.0,91.6 L 441.0,90.3 L 440.4,88.9 L 441.4,88.2 Z M 436.0,163.9 L 440.2,163.6 L 438.4,166.0 L 436.0,163.9 Z M 439.7,166.2 L 442.2,167.5 L 439.8,167.9 L 438.6,166.2 L 439.7,166.2 Z M 464.5,127.0 L 465.5,126.7 L 465.4,131.1 L 464.5,127.0 Z M 446.7,86.4 L 446.6,87.9 L 444.9,85.9 L 445.8,85.4 L 446.7,86.4 Z M 436.4,166.0 L 437.4,169.8 L 436.6,169.4 L 436.4,166.0 Z M 440.6,87.2 L 439.3,86.7 L 439.8,86.1 L 442.3,87.1 L 442.2,87.5 L 440.6,87.2 Z M 439.9,163.5 L 439.7,162.8 L 441.0,162.8 L 441.7,163.6 L 440.4,164.2 L 439.9,163.5 Z M 447.3,112.4 L 448.4,112.8 L 447.9,113.5 L 446.9,112.5 L 446.0,113.0 L 445.8,111.8 L 447.3,112.4 Z M 438.5,163.0 L 440.9,161.2 L 441.6,162.0 L 439.2,163.0 L 438.5,163.0 Z M 439.3,91.2 L 438.3,90.5 L 440.3,90.4 L 440.5,91.2 L 439.3,91.2 Z M 444.2,79.9 L 444.7,79.9 L 446.4,81.2 L 446.3,81.7 L 444.8,81.2 L 444.2,79.9 Z M 445.5,113.2 L 444.4,113.5 L 444.5,112.1 L 445.8,112.1 L 445.5,113.2 Z M 443.3,97.0 L 443.7,97.5 L 442.0,97.8 L 441.6,97.0 L 443.3,96.6 L 443.3,97.0 Z M 440.8,85.6 L 441.5,85.4 L 442.7,85.8 L 442.4,86.3 L 440.8,85.6 Z M 436.4,85.5 L 438.2,84.9 L 438.4,85.4 L 436.4,85.5 Z M 440.2,89.1 L 440.2,90.0 L 439.2,89.8 L 439.1,88.9 L 440.2,89.1 Z M 440.0,159.4 L 439.2,161.1 L 438.9,160.4 L 440.0,159.4 Z M 442.5,98.2 L 443.7,97.7 L 443.9,98.3 L 442.5,98.2 Z M 552.6,146.7 L 553.6,144.4 L 553.1,140.9 L 550.7,140.4 L 546.0,135.4 L 555.2,135.8 L 558.6,137.1 L 565.2,135.4 L 568.4,133.6 L 569.1,131.0 L 573.6,130.4 L 574.1,129.6 L 572.4,128.3 L 572.7,127.3 L 578.3,125.2 L 577.8,123.1 L 581.4,119.8 L 586.0,124.5 L 582.9,127.1 L 581.9,131.3 L 579.3,134.7 L 577.5,135.1 L 574.4,138.5 L 573.2,141.8 L 572.0,142.5 L 572.3,144.0 L 558.5,147.0 L 552.6,146.7 Z M 613.3,70.5 L 613.9,67.6 L 615.5,67.2 L 617.6,72.1 L 615.3,74.3 L 614.7,77.2 L 612.9,76.4 L 615.2,72.7 L 613.8,72.2 L 613.3,70.5 Z M 593.7,86.7 L 593.5,89.2 L 591.3,88.2 L 591.1,85.8 L 589.0,83.8 L 589.4,82.7 L 591.1,82.8 L 593.7,86.7 Z M 588.6,100.1 L 589.4,100.0 L 589.9,101.0 L 589.1,101.5 L 588.2,101.3 L 588.6,100.1 Z M 614.0,79.3 L 613.1,79.9 L 612.9,78.5 L 613.6,78.3 L 614.0,79.3 Z M 615.8,82.3 L 614.3,80.0 L 616.0,81.0 L 615.8,82.3 Z M 588.6,108.5 L 589.7,107.9 L 590.3,108.5 L 589.8,109.2 L 588.6,108.5 Z M 583.9,118.4 L 584.9,119.4 L 584.0,119.8 L 583.9,118.4 Z M 763.5,206.1 L 759.2,209.6 L 759.2,211.5 L 757.2,212.9 L 755.1,216.8 L 781.7,225.9 L 783.1,226.7 L 785.0,231.8 L 791.8,231.8 L 787.8,237.8 L 777.5,236.3 L 774.0,237.0 L 771.8,236.0 L 763.3,230.8 L 764.1,229.6 L 763.5,228.0 L 765.5,227.0 L 768.0,227.8 L 767.8,227.0 L 763.8,226.7 L 760.7,229.1 L 759.4,226.7 L 757.7,226.2 L 757.7,227.6 L 756.7,227.6 L 757.4,228.6 L 756.6,228.8 L 753.9,226.3 L 754.7,225.1 L 754.1,224.0 L 752.5,224.9 L 751.8,224.2 L 750.4,225.7 L 748.0,220.0 L 747.1,220.8 L 747.4,222.8 L 744.1,218.5 L 745.5,217.2 L 744.9,214.1 L 748.6,210.0 L 748.2,208.3 L 744.6,212.4 L 744.3,217.2 L 742.5,217.6 L 743.3,220.2 L 739.8,222.5 L 741.0,225.6 L 736.7,229.8 L 730.7,229.9 L 728.8,227.5 L 727.2,222.4 L 727.1,221.5 L 730.2,221.6 L 730.5,219.5 L 730.2,218.2 L 728.8,217.9 L 728.6,214.4 L 726.1,215.6 L 725.4,212.9 L 719.9,208.4 L 715.2,208.7 L 713.8,207.1 L 713.8,204.4 L 716.1,203.1 L 720.1,203.1 L 724.1,203.5 L 727.2,205.7 L 733.1,200.0 L 736.4,198.3 L 739.6,200.4 L 739.9,203.6 L 744.5,200.6 L 746.7,203.3 L 747.9,199.0 L 751.1,199.1 L 750.4,196.7 L 751.4,195.1 L 750.3,194.9 L 750.4,192.1 L 744.5,193.0 L 742.3,195.0 L 735.9,194.2 L 731.6,196.1 L 728.7,195.1 L 726.9,196.1 L 723.5,194.1 L 719.2,195.7 L 712.8,189.9 L 712.0,187.0 L 713.9,184.9 L 711.8,185.3 L 711.6,182.9 L 708.3,182.7 L 705.5,180.6 L 703.1,181.2 L 700.9,178.2 L 699.6,178.9 L 700.9,179.9 L 698.4,181.5 L 697.7,180.4 L 693.3,179.7 L 695.4,176.5 L 697.7,176.0 L 699.2,173.3 L 699.9,171.5 L 698.9,168.2 L 704.7,166.5 L 705.0,167.2 L 710.3,166.2 L 715.1,161.9 L 721.2,159.3 L 731.2,161.4 L 739.7,166.8 L 750.1,166.3 L 752.7,168.2 L 751.3,170.8 L 756.3,178.0 L 754.7,182.3 L 752.5,184.0 L 754.4,197.3 L 757.4,200.9 L 759.9,207.0 L 760.8,206.4 L 759.8,201.0 L 760.7,199.8 L 762.9,199.9 L 763.5,206.1 Z M 679.8,156.8 L 681.2,157.0 L 680.9,154.9 L 690.4,153.1 L 693.9,154.0 L 695.1,153.3 L 699.4,155.4 L 700.9,158.4 L 699.1,159.7 L 696.0,158.8 L 694.2,159.6 L 691.8,157.2 L 690.7,157.3 L 688.8,154.7 L 687.6,154.7 L 687.4,155.7 L 690.0,158.3 L 693.0,158.7 L 693.3,159.5 L 692.5,160.8 L 689.3,161.3 L 688.4,158.5 L 686.0,159.1 L 685.3,157.2 L 684.1,158.1 L 679.8,156.8 Z M 682.9,190.2 L 678.1,191.7 L 670.5,188.5 L 673.8,186.3 L 681.9,184.5 L 684.0,187.4 L 682.3,189.0 L 682.9,190.2 Z M 687.7,171.0 L 691.4,169.8 L 695.5,170.4 L 696.1,172.0 L 695.3,176.3 L 693.9,178.5 L 691.9,178.3 L 690.0,176.6 L 687.7,171.0 Z M 685.1,168.0 L 686.0,168.7 L 692.5,167.8 L 691.5,169.2 L 685.8,170.2 L 684.2,169.9 L 684.2,168.5 L 685.1,168.0 Z M 684.0,162.5 L 684.7,161.2 L 688.7,161.3 L 687.0,162.9 L 686.3,162.1 L 684.0,162.5 Z M 741.7,233.0 L 738.5,231.2 L 739.2,230.5 L 742.9,232.5 L 741.7,233.0 Z M 670.8,175.1 L 673.2,174.2 L 674.2,175.2 L 672.9,176.1 L 670.8,175.1 Z M 757.9,190.6 L 758.8,191.4 L 757.6,193.7 L 757.9,190.6 Z M 754.3,189.6 L 753.9,187.3 L 755.2,186.7 L 754.3,189.6 Z M 748.7,197.9 L 750.3,198.1 L 750.6,199.3 L 749.5,199.6 L 748.4,198.1 L 748.7,197.9 Z M 747.1,199.7 L 746.2,198.7 L 748.2,198.3 L 747.1,199.7 Z M 745.6,201.0 L 747.1,201.6 L 747.3,203.0 L 745.5,202.1 L 745.6,201.0 Z M 753.9,228.3 L 752.6,227.7 L 752.8,226.6 L 754.2,227.9 L 753.9,228.3 Z M 675.7,149.3 L 677.5,148.4 L 677.5,149.5 L 676.4,149.6 L 675.7,149.3 Z M 673.5,162.3 L 672.7,161.4 L 673.5,160.6 L 674.1,161.4 L 673.5,162.3 Z M 761.9,196.2 L 761.7,198.9 L 760.6,197.5 L 761.6,197.6 L 761.9,196.2 Z M 748.9,197.5 L 750.3,196.8 L 750.8,197.8 L 749.4,197.8 L 748.9,197.5 Z M 677.8,152.9 L 678.6,153.9 L 678.2,154.8 L 677.4,154.2 L 677.8,152.9 Z M 697.2,171.7 L 696.6,172.9 L 696.0,172.7 L 696.3,171.7 L 697.2,171.7 Z M 77.4,72.0 L 75.8,75.4 L 77.7,75.2 L 82.5,77.3 L 83.1,78.6 L 85.2,79.2 L 87.4,82.8 L 95.3,86.2 L 100.5,89.8 L 101.7,91.7 L 105.3,93.1 L 110.2,97.5 L 109.9,101.2 L 112.1,102.4 L 114.4,101.9 L 116.5,105.1 L 115.9,107.4 L 117.0,111.0 L 115.6,118.4 L 117.9,119.4 L 118.8,122.2 L 118.0,125.2 L 111.7,126.7 L 113.3,131.2 L 112.3,132.7 L 113.3,134.0 L 112.0,135.6 L 113.7,138.5 L 107.1,136.1 L 107.3,139.9 L 108.6,140.0 L 109.6,142.4 L 108.5,143.9 L 104.9,144.3 L 103.5,142.6 L 100.8,142.7 L 94.4,148.5 L 92.5,139.2 L 87.2,125.8 L 86.9,124.1 L 88.1,121.3 L 85.9,119.2 L 85.3,120.1 L 81.3,115.4 L 75.4,112.4 L 76.1,109.2 L 74.1,105.6 L 74.9,102.8 L 74.2,99.7 L 71.7,98.2 L 72.1,93.9 L 70.1,91.6 L 73.1,90.1 L 71.6,89.0 L 68.8,82.5 L 70.8,80.9 L 70.7,79.5 L 73.0,78.1 L 73.7,73.9 L 75.3,72.1 L 77.4,72.0 Z M 90.0,102.7 L 87.5,100.2 L 82.6,98.4 L 82.5,100.2 L 84.2,103.0 L 85.4,103.2 L 85.7,101.5 L 87.2,101.2 L 90.9,105.7 L 91.2,106.6 L 89.0,107.2 L 85.7,103.8 L 85.1,104.9 L 88.6,108.9 L 92.4,109.0 L 94.2,107.1 L 92.6,107.8 L 91.9,105.4 L 90.0,104.2 L 90.0,102.7 Z M 63.1,135.6 L 61.2,135.1 L 58.5,129.7 L 55.1,126.2 L 58.5,126.3 L 60.1,124.8 L 62.7,125.2 L 66.5,130.7 L 68.6,131.2 L 71.3,134.8 L 70.5,141.0 L 67.0,142.3 L 65.9,139.0 L 63.1,135.6 Z M 80.3,164.1 L 79.0,162.5 L 80.9,157.5 L 82.3,159.6 L 81.9,163.3 L 80.3,164.1 Z M 79.5,152.8 L 83.2,159.1 L 78.5,153.1 L 79.5,152.8 Z M 83.8,151.1 L 82.4,150.2 L 87.6,149.6 L 88.6,150.7 L 86.6,151.5 L 83.8,151.1 Z M 81.2,120.8 L 81.7,120.9 L 82.0,122.2 L 80.9,121.7 L 81.2,120.8 Z M 206.5,191.0 L 207.6,189.2 L 211.0,187.6 L 211.9,186.4 L 210.8,184.8 L 213.2,182.3 L 215.8,182.0 L 216.6,183.8 L 218.0,184.1 L 216.8,185.2 L 218.3,186.4 L 219.4,186.0 L 218.1,182.6 L 218.7,181.7 L 223.5,182.4 L 227.0,188.6 L 226.7,193.4 L 228.6,198.1 L 230.5,199.5 L 238.4,201.3 L 235.7,204.2 L 234.4,207.8 L 237.3,210.4 L 233.2,211.5 L 231.1,208.8 L 222.6,205.8 L 221.2,202.6 L 222.1,199.5 L 219.6,197.3 L 220.0,196.4 L 218.3,193.0 L 214.0,192.1 L 210.2,193.3 L 208.6,191.8 L 206.9,192.1 L 206.5,191.0 Z M 254.0,204.6 L 254.7,201.1 L 257.6,200.7 L 264.5,203.3 L 266.5,206.7 L 264.2,212.2 L 262.4,212.6 L 262.2,213.9 L 260.4,213.9 L 260.3,212.2 L 258.2,210.4 L 258.0,212.2 L 254.3,213.8 L 253.3,213.2 L 253.7,208.0 L 252.5,207.6 L 254.0,204.6 Z M 239.9,209.4 L 238.3,209.8 L 236.7,208.7 L 238.5,207.3 L 240.3,208.2 L 239.9,209.4 Z M 251.4,206.7 L 250.0,208.4 L 249.0,207.5 L 250.2,206.2 L 251.4,206.7 Z M 244.0,207.0 L 243.3,207.7 L 242.6,207.0 L 243.2,206.0 L 244.0,207.0 Z M 94.4,148.5 L 100.8,142.7 L 103.5,142.6 L 104.9,144.3 L 108.5,143.9 L 109.6,142.4 L 108.6,140.0 L 107.3,139.9 L 107.1,136.1 L 109.4,136.4 L 115.1,139.5 L 114.1,141.7 L 115.6,146.6 L 117.7,146.5 L 119.0,148.7 L 124.9,149.7 L 124.4,154.1 L 126.0,158.9 L 127.4,159.9 L 129.0,158.8 L 130.4,162.3 L 135.9,165.3 L 141.4,170.5 L 144.6,171.3 L 144.7,173.6 L 145.7,173.8 L 144.5,175.7 L 142.5,176.2 L 142.2,180.8 L 138.4,184.6 L 131.5,184.5 L 131.8,189.0 L 134.6,193.1 L 134.9,195.1 L 133.7,197.1 L 129.6,199.7 L 127.2,196.9 L 125.9,194.1 L 126.9,191.4 L 126.4,189.1 L 122.3,183.4 L 120.5,177.5 L 117.8,176.8 L 118.0,172.4 L 116.7,169.5 L 106.9,158.7 L 105.3,153.4 L 98.8,150.0 L 98.1,148.5 L 94.4,148.5 Z M 113.1,158.4 L 113.4,160.2 L 114.4,160.3 L 114.5,158.3 L 113.9,157.6 L 113.1,158.4 Z M 119.7,163.0 L 119.4,163.8 L 120.4,165.4 L 121.5,165.7 L 120.5,163.3 L 119.7,163.0 Z M 96.4,185.3 L 95.9,186.7 L 93.4,187.0 L 88.0,183.3 L 83.8,175.9 L 84.9,171.3 L 89.6,170.0 L 90.1,172.8 L 95.6,183.1 L 96.7,183.6 L 96.4,185.3 Z M 118.4,209.4 L 119.1,212.1 L 117.7,212.2 L 117.6,213.1 L 119.2,215.7 L 116.7,214.1 L 116.5,211.9 L 113.8,209.2 L 113.5,205.7 L 114.7,205.2 L 118.4,209.4 Z M 110.2,204.7 L 110.1,200.0 L 114.4,204.5 L 112.4,206.3 L 110.5,205.8 L 110.2,204.7 Z M 106.9,196.4 L 106.4,197.5 L 102.7,195.9 L 101.3,193.4 L 102.2,193.3 L 102.1,191.3 L 104.4,192.0 L 106.9,196.4 Z M 312.3,209.5 L 313.8,207.8 L 320.7,204.0 L 318.2,195.2 L 319.2,190.7 L 317.2,189.7 L 317.6,184.8 L 316.0,185.3 L 314.9,183.7 L 317.2,181.9 L 319.9,182.0 L 319.7,180.9 L 321.1,181.0 L 324.2,177.1 L 326.8,177.0 L 326.9,175.9 L 328.2,175.7 L 329.4,171.4 L 334.7,169.3 L 334.7,167.5 L 335.6,168.3 L 336.4,166.6 L 340.2,164.5 L 342.1,166.7 L 347.7,165.8 L 350.6,163.6 L 357.8,161.4 L 359.6,161.8 L 360.3,161.0 L 359.5,159.3 L 363.3,152.7 L 362.9,150.3 L 360.4,148.4 L 365.0,146.8 L 371.2,140.3 L 376.1,139.7 L 378.1,142.8 L 381.9,143.5 L 384.4,141.0 L 391.9,138.3 L 395.3,145.9 L 393.8,147.2 L 390.9,147.3 L 389.1,151.1 L 390.8,151.9 L 392.0,156.5 L 393.8,156.5 L 398.6,153.5 L 399.0,154.6 L 397.3,158.6 L 400.4,168.4 L 402.3,168.9 L 407.1,174.1 L 408.9,174.8 L 407.1,177.7 L 400.8,179.7 L 399.1,187.0 L 400.7,191.7 L 399.1,191.9 L 398.5,194.8 L 393.7,197.2 L 389.3,201.5 L 388.5,204.2 L 385.4,205.9 L 385.8,207.2 L 384.8,206.9 L 383.5,209.7 L 384.4,210.7 L 382.2,212.7 L 380.7,218.0 L 375.6,216.0 L 370.4,218.0 L 366.2,217.9 L 367.1,215.5 L 366.5,212.6 L 363.9,212.8 L 361.9,214.8 L 355.8,209.2 L 354.3,211.4 L 355.5,212.5 L 348.5,217.0 L 346.8,217.8 L 341.2,215.4 L 334.2,220.0 L 332.2,219.2 L 333.3,210.8 L 331.5,207.1 L 327.8,209.7 L 324.4,207.8 L 317.2,210.7 L 314.0,209.1 L 312.3,209.5 Z M 219.3,230.5 L 218.4,231.0 L 216.8,229.9 L 216.0,227.2 L 212.3,224.1 L 211.1,224.4 L 210.9,223.2 L 204.7,231.5 L 200.5,233.2 L 197.0,232.7 L 191.9,236.3 L 191.2,240.5 L 192.2,244.3 L 191.5,245.0 L 183.1,245.6 L 183.1,244.2 L 181.4,243.3 L 178.7,238.7 L 175.8,238.9 L 174.4,237.7 L 175.6,234.8 L 170.6,232.9 L 169.2,228.7 L 162.9,227.4 L 159.9,224.7 L 161.7,223.6 L 163.3,219.5 L 165.3,220.6 L 166.4,219.3 L 166.6,216.4 L 164.7,216.5 L 162.5,214.7 L 159.2,215.7 L 157.2,214.0 L 156.3,210.5 L 152.6,209.9 L 152.2,208.1 L 149.2,205.0 L 153.2,202.2 L 155.6,203.6 L 159.2,203.3 L 162.9,200.6 L 164.5,196.3 L 169.1,197.3 L 170.8,196.5 L 169.9,194.7 L 171.9,193.5 L 172.5,195.1 L 175.3,197.1 L 175.1,194.6 L 176.7,193.7 L 177.4,190.6 L 175.1,189.0 L 176.2,187.9 L 177.2,188.5 L 178.1,187.1 L 183.1,186.9 L 184.2,185.9 L 185.3,187.0 L 191.3,186.3 L 193.5,183.6 L 195.9,185.4 L 194.6,188.9 L 195.4,189.2 L 196.1,187.8 L 198.6,190.4 L 201.6,190.7 L 202.8,193.4 L 201.7,196.0 L 206.8,197.8 L 208.8,196.9 L 215.0,198.5 L 216.1,197.9 L 216.4,202.7 L 219.3,204.0 L 219.8,207.8 L 224.2,209.3 L 224.8,214.1 L 221.7,216.7 L 219.9,221.7 L 222.5,225.4 L 220.3,231.3 L 219.3,230.5 Z M 134.6,195.9 L 134.6,193.1 L 131.8,189.0 L 131.5,184.5 L 138.4,184.6 L 142.2,180.8 L 142.5,176.2 L 145.3,174.7 L 144.6,171.3 L 147.6,169.5 L 152.0,170.7 L 153.7,170.2 L 155.4,172.3 L 160.0,174.0 L 167.0,167.1 L 175.9,167.4 L 180.9,171.5 L 189.6,173.1 L 192.6,172.1 L 193.4,174.2 L 195.4,184.5 L 193.5,183.6 L 191.3,186.3 L 185.3,187.0 L 184.2,185.9 L 183.1,186.9 L 178.1,187.1 L 177.2,188.5 L 176.2,187.9 L 175.1,189.0 L 177.4,190.6 L 176.7,193.7 L 175.1,194.6 L 175.3,197.1 L 172.5,195.1 L 171.9,193.5 L 169.9,194.7 L 170.8,196.5 L 169.1,197.3 L 164.5,196.3 L 162.9,200.6 L 159.2,203.3 L 155.6,203.6 L 153.2,202.2 L 149.2,205.0 L 145.5,204.3 L 141.8,200.6 L 139.4,201.1 L 139.6,199.1 L 134.6,195.9 Z M 137.9,193.7 L 139.1,193.9 L 139.0,193.0 L 137.9,193.0 L 137.9,193.7 Z M 181.4,243.3 L 183.1,244.2 L 183.1,245.6 L 191.5,245.0 L 192.2,244.3 L 191.2,240.5 L 191.9,236.3 L 197.0,232.7 L 200.5,233.2 L 204.7,231.5 L 210.9,223.2 L 211.1,224.4 L 212.3,224.1 L 216.0,227.2 L 216.8,229.9 L 218.4,231.0 L 219.4,230.5 L 221.4,237.1 L 221.7,240.5 L 220.7,242.9 L 221.5,246.0 L 219.1,262.9 L 215.9,262.8 L 214.9,260.2 L 212.2,258.9 L 210.0,255.5 L 207.3,262.4 L 196.9,256.5 L 195.6,257.3 L 199.2,264.7 L 196.8,264.8 L 191.3,259.2 L 191.3,257.9 L 185.6,253.2 L 183.9,251.0 L 183.9,249.5 L 178.1,245.7 L 181.4,243.3 Z M 181.4,243.3 L 176.9,245.5 L 172.6,243.0 L 168.9,239.2 L 164.9,237.5 L 153.2,227.4 L 153.6,225.3 L 152.0,221.7 L 140.8,213.9 L 135.2,204.5 L 132.0,202.6 L 129.6,199.7 L 134.6,195.9 L 139.6,199.1 L 139.4,201.1 L 141.8,200.6 L 145.5,204.3 L 149.2,205.0 L 152.2,208.1 L 152.6,209.9 L 156.3,210.5 L 157.2,214.0 L 159.2,215.7 L 162.5,214.7 L 164.7,216.5 L 166.6,216.4 L 166.4,219.3 L 165.3,220.6 L 163.3,219.5 L 161.7,223.6 L 159.9,224.7 L 162.9,227.4 L 169.2,228.7 L 170.6,232.9 L 175.6,234.8 L 174.4,237.7 L 175.8,238.9 L 178.7,238.7 L 181.4,243.3 Z M 150.9,252.5 L 155.5,254.5 L 154.9,256.6 L 153.1,256.5 L 149.9,253.7 L 150.9,252.5 Z M 77.4,72.0 L 75.3,72.1 L 73.7,73.9 L 73.0,78.1 L 70.7,79.5 L 70.8,80.9 L 68.8,82.5 L 71.6,89.0 L 73.1,90.1 L 70.1,91.6 L 72.1,93.9 L 71.7,98.2 L 74.2,99.7 L 74.9,102.8 L 74.1,105.6 L 76.1,109.2 L 75.4,112.4 L 71.6,110.1 L 68.5,110.7 L 66.1,107.6 L 64.7,98.4 L 61.1,97.0 L 58.7,92.4 L 56.9,91.5 L 51.1,83.3 L 44.8,82.5 L 38.8,75.8 L 26.4,65.1 L 24.0,62.1 L 20.0,52.8 L 20.7,51.7 L 19.7,48.7 L 24.3,46.2 L 25.2,47.1 L 27.4,46.8 L 32.8,49.2 L 36.5,53.2 L 42.2,54.7 L 53.9,53.8 L 57.3,56.0 L 63.0,53.9 L 70.7,60.8 L 72.8,65.9 L 72.4,67.5 L 75.7,68.0 L 77.9,69.6 L 77.4,72.0 Z M 34.8,104.1 L 31.3,103.0 L 29.0,100.6 L 31.2,97.7 L 36.8,101.3 L 36.6,102.9 L 38.6,103.1 L 41.7,106.0 L 42.8,106.0 L 44.1,108.4 L 40.7,108.4 L 40.5,107.2 L 34.8,104.1 Z M 59.2,113.7 L 56.2,111.4 L 56.8,110.7 L 60.0,112.2 L 59.2,113.7 Z M 22.2,44.1 L 21.4,43.9 L 21.4,42.8 L 22.1,42.1 L 23.1,42.7 L 22.2,44.1 Z M 55.8,113.1 L 56.6,113.9 L 55.7,114.9 L 55.0,113.9 L 55.8,113.1 Z M 46.7,112.9 L 47.7,113.5 L 46.9,114.1 L 46.3,113.6 L 46.7,112.9 Z";

  let popupEl = null;
  function closePopup() { if (popupEl) { popupEl.remove(); popupEl = null; } }

  /* ---------- Live map animation helpers -------------------------------
     Native SVG animation (animateMotion / animateTransform) is used for
     the "moving convoy" and radar-sweep effects instead of a JS/rAF loop:
     zero per-frame CPU cost, runs entirely on the compositor, and is
     trivially removed by discarding the SVG (no interval to leak). This
     keeps the "peta lebih aktif" request compatible with the project's
     own performance rules (section 28 of the design brief: no heavy JS
     animation loops). */
  function prefersReducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  // Deterministic-ish pseudo-random pair selection so routes don't jump
  // wildly between the many re-renders that happen every ~20s; reseeded
  // only when the underlying dataset identity changes size (filter change).
  function buildRouteAnimations(dataset, uid) {
    if (prefersReducedMotion() || dataset.length < 2) return "";
    const usable = dataset.filter((s) => s.status !== "offline");
    if (usable.length < 2) return "";
    const pairCount = Math.min(7, Math.max(2, Math.floor(usable.length / 12)));
    const pairs = [];
    // Route any active warning/critical SPPG to its nearest normal/monitoring
    // "hub" — reads as "bantuan/tim sedang menuju lokasi", which is more
    // narratively meaningful than fully random lines.
    const hubs = usable.filter((s) => s.status === "normal" || s.status === "monitoring");
    const needing = usable.filter((s) => s.status === "warning" || s.status === "critical").slice(0, Math.ceil(pairCount / 2));
    needing.forEach((s) => {
      if (!hubs.length) return;
      let nearest = hubs[0], best = Infinity;
      hubs.forEach((h) => {
        const d = (h.lat - s.lat) ** 2 + (h.lng - s.lng) ** 2;
        if (d < best) { best = d; nearest = h; }
      });
      pairs.push([nearest, s, "alert"]);
    });
    // Fill the rest with routine distribution routes between nearby normal
    // hubs, seeded from dataset order so it's stable within a single
    // render pass.
    for (let i = 0; pairs.length < pairCount && i < hubs.length - 1; i += 3) {
      pairs.push([hubs[i], hubs[i + 1], "routine"]);
    }
    if (!pairs.length) return "";
    let svg = `<g class="map-routes" aria-hidden="true">`;
    pairs.forEach(([a, b, kind], i) => {
      const p1 = project(a.lat, a.lng), p2 = project(b.lat, b.lng);
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 8; // slight arc
      const pathId = `${uid}-route${i}`;
      const dur = (kind === "alert" ? 2.4 : 3.6) + (i % 4) * 0.6;
      const color = kind === "alert" ? "var(--accent-orange)" : "var(--accent-cyan)";
      svg += `
        <path id="${pathId}" class="map-route-line ${kind === "alert" ? "is-alert" : ""}" d="M ${p1.x},${p1.y} Q ${mx},${my} ${p2.x},${p2.y}" fill="none"/>
        <circle r="${kind === "alert" ? 2.2 : 1.7}" class="map-convoy-dot" fill="${color}">
          <animateMotion dur="${dur}s" repeatCount="indefinite" rotate="auto">
            <mpath href="#${pathId}"/>
          </animateMotion>
        </circle>`;
    });
    svg += `</g>`;
    return svg;
  }
  // Slow rotating radar sweep centered on the map — pure decoration,
  // reinforces the "command center" read without any JS timer.
  function buildRadarSweep(uid) {
    if (prefersReducedMotion()) return "";
    const cx = MAP_W / 2, cy = MAP_H / 2, r = Math.max(MAP_W, MAP_H) * 0.6;
    return `
      <g class="map-radar" aria-hidden="true">
        <path d="M ${cx},${cy} L ${cx + r},${cy} A ${r},${r} 0 0 1 ${cx + r * Math.cos(0.5)},${cy + r * Math.sin(0.5)} Z"
              fill="url(#${uid}-radarGradient)">
          <animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="9s" repeatCount="indefinite"/>
        </path>
      </g>`;
  }
  // IDs perturbed by the most recent 20s simulation tick — rendered with a
  // one-shot "ping" ring so the map visibly reacts to new data instead of
  // only ever showing a frozen snapshot.
  let lastChangedSppgIds = new Set();
  // Pan/zoom is preserved across re-renders (the live tick used to rebuild
  // the whole SVG every 20s and silently reset any zoom/pan the user had
  // set — fixed by keeping this state outside the render function).
  const mapViewState = { large: { scale: 1, tx: 0, ty: 0 }, mini: { scale: 1, tx: 0, ty: 0 } };

  // Every call gets its own gradient/filter IDs. Without this, the Overview
  // mini map and the full Peta map (both built by this same function, both
  // present in the DOM at once behind [hidden]) would define <linearGradient
  // id="landGradient"> twice — and in some mobile WebViews a url(#id) fill
  // silently fails to paint when the *other* same-ID element it happens to
  // resolve to lives inside a display:none ancestor. Unique IDs per render
  // make each map fully self-contained so this can never happen.
  let mapInstanceSeq = 0;
  function buildMapSVG(dataset, opts) {
    opts = opts || {};
    const uid = `m${++mapInstanceSeq}`;
    const markers = dataset.map((s) => {
      const { x, y } = project(s.lat, s.lng);
      const color = statusColorVar(s.status);
      const ring = (s.status === "critical" || s.status === "warning")
        ? `<circle class="pulse-ring" cx="${x}" cy="${y}" r="4" fill="none" stroke="${color}" stroke-width="1.4"/>` : "";
      const justUpdated = lastChangedSppgIds.has(s.id)
        ? `<circle class="marker-ping" cx="${x}" cy="${y}" r="4" fill="none" stroke="${color}" stroke-width="2"/>` : "";
      return `<g class="map-marker" data-id="${s.id}" tabindex="0" role="button" aria-label="${escapeHtml(s.name)}">
        ${ring}${justUpdated}<circle class="marker-shadow" cx="${x}" cy="${y + 1}" r="${opts.large ? 5 : 4}" fill="rgba(0,0,0,.35)"/>
        <circle cx="${x}" cy="${y}" r="${opts.large ? 5 : 4}" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="0.6"/>
        <circle cx="${x - (opts.large ? 1.6 : 1.3)}" cy="${y - (opts.large ? 1.6 : 1.3)}" r="${opts.large ? 1.4 : 1.1}" fill="rgba(255,255,255,.55)"/>
      </g>`;
    }).join("");
    // Faint cartographic graticule for a command-center feel (a handful of
    // static lines — negligible cost, no per-frame work).
    const graticule = [];
    for (let gx = 100; gx < MAP_W; gx += 100) graticule.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${MAP_H}" />`);
    for (let gy = 80; gy < MAP_H; gy += 80) graticule.push(`<line x1="0" y1="${gy}" x2="${MAP_W}" y2="${gy}" />`);
    const shapes = `
      <path d="${INDONESIA_LAND_PATH}" fill="none" stroke="var(--map-land-glow)" stroke-width="5" opacity="0.55" filter="url(#${uid}-landBlur)"/>
      <path d="${INDONESIA_LAND_PATH}" fill="url(#${uid}-landGradient)" stroke="var(--map-land-stroke)" stroke-width="1.1" stroke-linejoin="round" filter="url(#${uid}-landShadow)"/>`;
    const radar = buildRadarSweep(uid);
    const routes = buildRouteAnimations(dataset, uid);
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="Peta sebaran SPPG Indonesia (simulasi, dengan simulasi pergerakan distribusi)">
      <defs>
        <linearGradient id="${uid}-seaGradient" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stop-color="var(--map-sea-top)"/>
          <stop offset="100%" stop-color="var(--map-sea-bottom)"/>
        </linearGradient>
        <radialGradient id="${uid}-seaVignette" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>
        </radialGradient>
        <linearGradient id="${uid}-landGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--map-land-top)"/>
          <stop offset="100%" stop-color="var(--map-land-bottom)"/>
        </linearGradient>
        <filter id="${uid}-landShadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.4"/>
        </filter>
        <filter id="${uid}-landBlur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5"/>
        </filter>
        <linearGradient id="${uid}-radarGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g class="map-zoom-group">
        <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="url(#${uid}-seaGradient)"/>
        <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="url(#${uid}-seaVignette)"/>
        <g class="map-graticule">${graticule.join("")}</g>
        ${shapes}
        ${radar}
        ${routes}
        ${markers}
      </g>
    </svg>`;
  }

  function attachMapInteractions(container, dataset) {
    container.querySelectorAll(".map-marker").forEach((marker) => {
      function openPopup() {
        closePopup();
        const sppg = dataset.find((s) => s.id === marker.dataset.id);
        if (!sppg) return;
        const rect = marker.getBoundingClientRect();
        const wrapRect = container.getBoundingClientRect();
        popupEl = el(`
          <div class="map-popup" style="left:${Math.max(4, Math.min(rect.left - wrapRect.left + 12, wrapRect.width - 236))}px; top:${Math.max(4, rect.top - wrapRect.top - 10)}px;">
            <h4>${escapeHtml(sppg.name)}</h4>
            <p class="muted" style="margin:2px 0 8px">${escapeHtml(sppg.city)}, ${escapeHtml(sppg.province)}</p>
            <div class="row"><span>Status</span><strong style="color:${statusColorVar(sppg.status)}">● ${statusLabel(sppg.status)}</strong></div>
            <div class="row"><span>Risk Score</span><strong>${sppg.riskScore} / 100</strong></div>
            <div class="row"><span>CCTV</span><strong>${sppg.cctv.status.toUpperCase()}</strong></div>
            <div class="row"><span>Distribusi</span><strong>${sppg.distribution.delayed > 0 ? "TERLAMBAT" : "ON TIME"}</strong></div>
            <div class="row"><span>Last Update</span><strong>${new Date().toLocaleTimeString("id-ID", { hour12: false })} WIB</strong></div>
            <button class="btn-ghost" data-open-detail="${sppg.id}" style="width:100%;margin-top:8px">LIHAT DETAIL</button>
          </div>`);
        container.style.position = "relative";
        container.appendChild(popupEl);
        popupEl.querySelector("[data-open-detail]").addEventListener("click", () => { closePopup(); openDetailModal(sppg.id); });
      }
      marker.addEventListener("click", (e) => { e.stopPropagation(); openPopup(); });
      marker.addEventListener("keypress", (e) => { if (e.key === "Enter") openPopup(); });
      let tip;
      marker.addEventListener("mouseenter", () => {
        const sppg = dataset.find((s) => s.id === marker.dataset.id);
        if (!sppg) return;
        const rect = marker.getBoundingClientRect();
        const wrapRect = container.getBoundingClientRect();
        const left = clamp1(rect.left - wrapRect.left + 10, 4, Math.max(4, wrapRect.width - 190));
        const top = Math.max(4, rect.top - wrapRect.top - 34);
        tip = el(`<div class="map-tooltip" style="left:${left}px; top:${top}px;">
          <strong>${escapeHtml(sppg.name)}</strong><br>${escapeHtml(sppg.city)}, ${escapeHtml(sppg.province)}<br>Risk ${sppg.riskScore} · CCTV ${sppg.cctv.status.toUpperCase()}
        </div>`);
        container.style.position = "relative";
        container.appendChild(tip);
      });
      marker.addEventListener("mouseleave", () => { if (tip) { tip.remove(); tip = null; } });
    });
    container.addEventListener("click", (e) => { if (!e.target.closest(".map-marker") && !e.target.closest(".map-popup")) closePopup(); });
  }

  /* Simple pan/zoom on the SVG group — pointer events unify mouse + touch.
     `key` ("large"/"mini") persists scale/tx/ty in mapViewState across
     re-renders. Previously every live-simulation re-render rebuilt the SVG
     from scratch and silently snapped any zoom/pan the person had set back
     to identity — a real bug where interacting with the map mid-session,
     then waiting ~20s for the live tick, reset your view without warning.
     The transform is now restored immediately on attach. */
  function attachMapPanZoom(wrap, key) {
    const svg = wrap.querySelector("svg");
    const group = wrap.querySelector(".map-zoom-group");
    if (!svg || !group) return;
    const persisted = (key && mapViewState[key]) || { scale: 1, tx: 0, ty: 0 };
    let scale = persisted.scale, tx = persisted.tx, ty = persisted.ty, dragging = false, lastX = 0, lastY = 0;
    function apply() {
      group.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
      if (key && mapViewState[key]) { mapViewState[key].scale = scale; mapViewState[key].tx = tx; mapViewState[key].ty = ty; }
    }
    apply();
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      scale = clamp1(scale + (e.deltaY < 0 ? 0.15 : -0.15), 1, 3.2);
      apply();
    }, { passive: false });
    svg.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      tx += (e.clientX - lastX) * 0.9; ty += (e.clientY - lastY) * 0.9;
      lastX = e.clientX; lastY = e.clientY; apply();
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => svg.addEventListener(ev, () => (dragging = false)));
    const controls = wrap.parentElement.querySelector(".map-zoom-controls");
    if (controls) {
      controls.querySelector("[data-zoom-in]").onclick = () => { scale = clamp1(scale + 0.3, 1, 3.2); apply(); };
      controls.querySelector("[data-zoom-out]").onclick = () => { scale = clamp1(scale - 0.3, 1, 3.2); apply(); };
      controls.querySelector("[data-zoom-reset]").onclick = () => { scale = 1; tx = 0; ty = 0; apply(); };
    }
  }

  function legendHTML() {
    return `<div class="map-legend">
      <span><span class="dot dot-normal"></span>Normal</span>
      <span><span class="dot dot-monitoring"></span>Monitoring</span>
      <span><span class="dot dot-warning"></span>Warning</span>
      <span><span class="dot dot-critical"></span>Critical</span>
      <span><span class="dot dot-offline"></span>Offline</span>
    </div>`;
  }

  function renderMiniMap() {
    const mount = document.getElementById("mapMount");
    mount.innerHTML = `<div class="map-wrap">${buildMapSVG(SPPG_DATA)}</div>${legendHTML()}`;
    attachMapInteractions(mount.querySelector(".map-wrap"), SPPG_DATA);
  }

  function getFilteredSPPG() {
    const q = state.mapSearch.trim().toLowerCase();
    return SPPG_DATA.filter((s) => {
      if (state.mapStatusFilter !== "all" && s.status !== state.mapStatusFilter) return false;
      if (state.mapProvinceFilter !== "all" && s.province !== state.mapProvinceFilter) return false;
      if (q && !(s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.province.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderLargeMap() {
    const filtered = getFilteredSPPG();
    const mount = document.getElementById("mapMountLarge");
    mount.innerHTML = `<div class="map-wrap">${buildMapSVG(filtered, { large: true })}</div>${legendHTML()}`;
    attachMapInteractions(mount.querySelector(".map-wrap"), filtered);
    attachMapPanZoom(mount.querySelector(".map-wrap"), "large");

    document.getElementById("mapResultCount").textContent = filtered.length;
    const grid = document.getElementById("sppgGrid");
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    filtered.forEach((s) => {
      const card = el(`
        <div class="sppg-card" data-id="${s.id}">
          <div class="sppg-top"><span class="sppg-name">${escapeHtml(s.name)}</span><span class="dot dot-${s.status}"></span></div>
          <div class="sppg-loc">${escapeHtml(s.city)}, ${escapeHtml(s.province)}</div>
          <div class="sppg-score">Risk ${s.riskScore}/100 · CCTV ${s.cctv.status}</div>
        </div>`);
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    grid.querySelectorAll(".sppg-card").forEach((card) => card.addEventListener("click", () => openDetailModal(card.dataset.id)));
  }

  function populateProvinceFilter() {
    const select = document.getElementById("provinceFilter");
    Array.from(new Set(SPPG_DATA.map((s) => s.province))).sort().forEach((p) => {
      const opt = document.createElement("option"); opt.value = p; opt.textContent = p; select.appendChild(opt);
    });
  }

  document.getElementById("statusFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip"); if (!btn) return;
    state.mapStatusFilter = btn.dataset.status;
    document.querySelectorAll("#statusFilters .chip").forEach((c) => c.classList.toggle("is-active", c === btn));
    persistFilters(); renderLargeMap();
  });
  document.getElementById("provinceFilter").addEventListener("change", (e) => { state.mapProvinceFilter = e.target.value; persistFilters(); renderLargeMap(); });
  document.getElementById("mapSearch").addEventListener("input", debounce((e) => { state.mapSearch = e.target.value; renderLargeMap(); }, 150));
  document.getElementById("resetFilters").addEventListener("click", () => {
    state.mapStatusFilter = "all"; state.mapProvinceFilter = "all"; state.mapSearch = "";
    document.getElementById("provinceFilter").value = "all"; document.getElementById("mapSearch").value = "";
    document.querySelectorAll("#statusFilters .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.status === "all"));
    persistFilters(); renderLargeMap();
  });
  function persistFilters() { storageSet(STORAGE_KEYS.filters, { status: state.mapStatusFilter, province: state.mapProvinceFilter }); }

  document.getElementById("globalSearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || state.appMode !== "admin") return;
    state.mapSearch = e.target.value;
    setView("map");
    document.getElementById("mapSearch").value = e.target.value;
    renderLargeMap();
  });

  /* =======================================================================
     ALERTS / EARLY WARNING SYSTEM (with workflow)
     ======================================================================= */
  function alertCard(a) {
    const card = el(`
      <div class="alert-item level-${a.level}" data-id="${a.id}">
        <div class="alert-top">
          <span class="alert-level">${statusLabel(a.level)} · ${a.category}</span>
          <span class="alert-time">${a.time}</span>
        </div>
        <div class="alert-sppg">${escapeHtml(a.sppgName)}</div>
        <div class="alert-msg">${escapeHtml(a.message)}</div>
        <div class="alert-foot">
          <span class="workflow-pill workflow-${a.status.toLowerCase()}">${a.status}</span>
          <button class="btn-ghost" data-alert-open="${a.id}">VERIFIKASI</button>
        </div>
      </div>`);
    card.querySelector("[data-alert-open]").addEventListener("click", () => openAlertModal(a.id));
    return card;
  }
  function renderAlertsPreview() {
    const wrap = document.getElementById("alertPreview");
    wrap.innerHTML = "";
    ALERTS.filter((a) => a.status !== "RESOLVED").slice(0, 3).forEach((a) => wrap.appendChild(alertCard(a)));
    if (!wrap.children.length) wrap.innerHTML = `<p class="muted" style="padding:16px">Tidak ada alert aktif saat ini.</p>`;
  }
  function renderAlertsFull() {
    const wrap = document.getElementById("alertFullList");
    wrap.innerHTML = "";
    const filtered = state.alertFilter === "all" ? ALERTS : ALERTS.filter((a) => a.level === state.alertFilter);
    if (!filtered.length) { wrap.innerHTML = `<p class="muted" style="padding:16px">Tidak ada alert pada kategori ini.</p>`; return; }
    filtered.forEach((a) => wrap.appendChild(alertCard(a)));
  }
  document.getElementById("alertFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip"); if (!btn) return;
    state.alertFilter = btn.dataset.level;
    document.querySelectorAll("#alertFilters .chip").forEach((c) => c.classList.toggle("is-active", c === btn));
    renderAlertsFull();
  });

  /* Alert workflow modal: OPEN -> ASSIGNED -> VERIFYING -> RESOLVED */
  const alertModal = document.getElementById("alertModal");
  function openAlertModal(id) {
    const a = ALERTS.find((x) => x.id === id);
    if (!a) return;
    state.activeAlertId = id;
    document.getElementById("alertModalBody").innerHTML = `
      <div class="am-head">
        <span class="workflow-pill workflow-${a.status.toLowerCase()}" id="amStatusPill">${a.status}</span>
        <h3>ALERT #${a.id}</h3>
      </div>
      <p class="muted" style="margin:0 0 4px">${escapeHtml(a.sppgName)} · ${a.category}</p>
      <p style="margin:0 0 14px">${escapeHtml(a.message)}</p>
      <div class="detail-grid">
        <div class="detail-tile"><div class="dt-label">Level</div><div class="dt-value">${statusLabel(a.level)}</div></div>
        <div class="detail-tile"><div class="dt-label">Risk Impact</div><div class="dt-value">${a.riskImpact}</div></div>
        <div class="detail-tile"><div class="dt-label">Waktu</div><div class="dt-value">${a.time}</div></div>
        <div class="detail-tile"><div class="dt-label">Status</div><div class="dt-value">${a.status}</div></div>
      </div>
      <label class="am-label" for="amNote">Catatan petugas</label>
      <textarea id="amNote" class="am-textarea" placeholder="Tulis catatan verifikasi...">${escapeHtml(a.note || "")}</textarea>
      <div class="am-actions">
        <button class="btn-ghost" data-am-action="ASSIGNED">ASSIGN</button>
        <button class="btn-ghost" data-am-action="VERIFYING">START VERIFICATION</button>
        <button class="btn-primary" data-am-action="RESOLVED">RESOLVE</button>
      </div>
      <button class="btn-ghost" id="amSave" style="width:100%;margin-top:10px">SIMPAN CATATAN</button>`;
    alertModal.hidden = false;
    alertModal.querySelectorAll("[data-am-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        a.status = btn.dataset.amAction;
        a.note = document.getElementById("amNote").value;
        persistAlert(a);
        document.getElementById("amStatusPill").textContent = a.status;
        document.getElementById("amStatusPill").className = `workflow-pill workflow-${a.status.toLowerCase()}`;
        refreshAlertUI();
      });
    });
    document.getElementById("amSave").addEventListener("click", () => {
      a.note = document.getElementById("amNote").value;
      persistAlert(a);
      alertModal.hidden = true;
    });
  }
  function refreshAlertUI() {
    renderAlertsPreview(); renderAlertsFull(); renderCriticalStrip(); renderNotifList();
  }
  document.getElementById("closeAlertModal").addEventListener("click", () => (alertModal.hidden = true));
  alertModal.addEventListener("click", (e) => { if (e.target === alertModal) alertModal.hidden = true; });

  /* =======================================================================
     CCTV
     ======================================================================= */
  function cctvCamerasForGrid() {
    const areas = ["Area Produksi", "Area Packing", "Area Gudang", "Loading Area"];
    const featured = [FEATURED.bogor, FEATURED.depok, FEATURED.bandung, FEATURED.jakarta];
    // Spread the rest across the dataset (every ~25th SPPG) so the grid
    // reflects the full 300-SPPG demo instead of always the same 4 kitchens
    // — mixes in a few offline/critical ones too, for a realistic feed.
    const extra = [];
    for (let i = 7; i < SPPG_DATA.length && extra.length < 8; i += 25) extra.push(SPPG_DATA[i]);
    const all = featured.concat(extra);
    return all.map((s, i) => ({ id: `CAM ${String(i + 1).padStart(2, "0")}`, sppg: s, area: areas[i % areas.length] }));
  }
  function cctvFeedMarkup(cam, big) {
    const isLive = cam.sppg.cctv.status === "online";
    return `
      <div class="cctv-feed ${big ? "cctv-feed-lg" : ""} ${isLive ? "" : "is-offline"}">
        <div class="cctv-noise"></div>
        <div class="cctv-scanline"></div>
        ${isLive ? '<div class="cctv-sweep"></div>' : '<div class="cctv-nosignal-pattern"></div>'}
        <div class="cctv-corners">
          <span class="cc-corner cc-tl"></span><span class="cc-corner cc-tr"></span>
          <span class="cc-corner cc-bl"></span><span class="cc-corner cc-br"></span>
        </div>
        ${isLive ? '<div class="cctv-crosshair" aria-hidden="true"><span></span><span></span></div>' : `<div class="cctv-nosignal-label">NO SIGNAL</div>`}
        <div class="cctv-overlay">
          <div class="cctv-top">
            <span>${cam.id} · ${escapeHtml(cam.sppg.name)}</span>
            <span class="cctv-live ${isLive ? "" : "is-offline"}"><span class="pulse"></span>${isLive ? "LIVE" : "OFFLINE"}</span>
          </div>
          <div class="cctv-bottom">
            <span class="cctv-area">${cam.area}</span>
            <span class="cctv-ts">00:00:00</span>
            ${isLive ? '<span class="cctv-rec">REC</span>' : ""}
          </div>
          <div class="cctv-mini-overlay">
            <span>Temp ${cam.sppg.sensors.temperature}°C</span>
            <span>Operator ${isLive ? "ONLINE" : "OFFLINE"}</span>
          </div>
        </div>
      </div>`;
  }
  function renderCCTV() {
    const grid = document.getElementById("cctvGrid");
    grid.innerHTML = "";
    cctvCamerasForGrid().forEach((cam) => {
      const card = el(`<div class="cctv-card" data-cam="${cam.id}">${cctvFeedMarkup(cam)}
        <div class="cctv-meta"><div class="cctv-sppg">${escapeHtml(cam.sppg.name)}</div><div class="cctv-area">${cam.area}</div></div>
      </div>`);
      card.addEventListener("click", () => openCctvModal(cam));
      grid.appendChild(card);
    });
  }
  const cctvModal = document.getElementById("cctvModal");
  function openCctvModal(cam) {
    document.getElementById("cctvModalBody").innerHTML = `
      ${cctvFeedMarkup(cam, true)}
      <div class="detail-grid" style="margin-top:14px">
        <div class="detail-tile"><div class="dt-label">SPPG</div><div class="dt-value">${escapeHtml(cam.sppg.name)}</div></div>
        <div class="detail-tile"><div class="dt-label">Lokasi</div><div class="dt-value">${cam.area}</div></div>
        <div class="detail-tile"><div class="dt-label">Status</div><div class="dt-value">${cam.sppg.cctv.status.toUpperCase()}</div></div>
        <div class="detail-tile"><div class="dt-label">Kamera</div><div class="dt-value">${cam.sppg.cctv.camerasOnline}/${cam.sppg.cctv.camerasTotal} online</div></div>
      </div>`;
    cctvModal.hidden = false;
  }
  document.getElementById("closeCctvModal").addEventListener("click", () => (cctvModal.hidden = true));
  cctvModal.addEventListener("click", (e) => { if (e.target === cctvModal) cctvModal.hidden = true; });

  /* =======================================================================
     PRODUCTION / DISTRIBUTION
     ======================================================================= */
  function renderProductionChart() {
    const max = Math.max(...PRODUCTION_WEEK.map((d) => d.target)) * 1.05;
    const bars = PRODUCTION_WEEK.map((d) => `
      <div class="bar-cols">
        <div class="bar-group">
          <div class="bar" style="height:${(d.target / max) * 180}px;background:var(--accent-gray)"></div>
          <div class="bar" style="height:${(d.produksi / max) * 180}px;background:var(--accent-cyan)"></div>
          <div class="bar" style="height:${(d.distribusi / max) * 180}px;background:var(--accent-green)"></div>
        </div>
        <div class="bar-group-label">${d.day}</div>
      </div>`).join("");
    document.getElementById("productionChart").innerHTML = `
      <div class="chart-legend">
        <span><span class="legend-swatch" style="background:var(--accent-gray)"></span>Target</span>
        <span><span class="legend-swatch" style="background:var(--accent-cyan)"></span>Produksi</span>
        <span><span class="legend-swatch" style="background:var(--accent-green)"></span>Distribusi</span>
      </div>
      <div class="bar-chart">${bars}</div>`;

    const agg = SPPG_DATA.reduce((acc, s) => ({ target: acc.target + s.production.target, produced: acc.produced + s.production.produced }), { target: 0, produced: 0 });
    document.getElementById("productionSummary").innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><span class="kpi-label">TARGET</span><span class="kpi-value">${fmt(agg.target)}</span></div>
        <div class="kpi"><span class="kpi-label">PRODUKSI</span><span class="kpi-value">${fmt(agg.produced)}</span></div>
        <div class="kpi"><span class="kpi-label">COMPLETION</span><span class="kpi-value">${((agg.produced / agg.target) * 100).toFixed(1)}%</span></div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${(agg.produced / agg.target) * 100}%"></div></div>`;
  }

  function renderDistributionFlow() {
    const agg = SPPG_DATA.reduce((acc, s) => {
      acc.produksi += s.production.produced;
      acc.packing += Math.round(s.production.produced * 0.99);
      acc.berangkat += Math.round(s.distribution.delivered * 1.02);
      acc.diterima += s.distribution.delivered;
      return acc;
    }, { produksi: 0, packing: 0, berangkat: 0, diterima: 0 });
    const steps = [["Produksi", agg.produksi], ["Packing", agg.packing], ["Kendaraan", agg.berangkat], ["Sekolah/Penerima", agg.diterima]];
    const diff = agg.produksi - agg.diterima;
    const stepsHtml = steps.map(([label, val], i) => `
      ${i > 0 ? '<span class="flow-arrow">→</span>' : ""}
      <div class="flow-step"><div class="flow-num">${fmt(val)}</div><div class="flow-label">${label}</div></div>`).join("");
    document.getElementById("distributionFlow").innerHTML = `
      <div class="flow-wrap">${stepsHtml}</div>
      ${diff > 0 ? `<div class="flow-warning">⚠ Selisih ${fmt(diff)} porsi — Status: NEEDS VERIFICATION</div>` : `<div class="flow-ok">✓ Seluruh porsi terverifikasi diterima</div>`}`;

    const delayed = SPPG_DATA.filter((s) => s.distribution.delayed > 0);
    document.getElementById("distributionDelayList").innerHTML = delayed.length
      ? delayed.slice(0, 8).map((s) => `<div class="attention-row" style="cursor:default"><span class="attention-main"><span class="attention-name">${escapeHtml(s.name)}</span><span class="attention-loc muted">${escapeHtml(s.city)}, ${escapeHtml(s.province)}</span></span><span class="attention-score">${s.distribution.delayed} titik terlambat</span></div>`).join("")
      : `<p class="muted" style="padding:14px">Tidak ada keterlambatan distribusi saat ini.</p>`;
  }

  function sparkline(values, color) {
    const w = 90, h = 28, max = Math.max(...values), min = Math.min(...values);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }
  function renderSensors() {
    const grid = document.getElementById("sensorGrid");
    const s = FEATURED.bogor.sensors;
    const rows = [
      ["Temperature", `${s.temperature}°C`, s.temperature <= 8],
      ["Freezer", `${s.freezer}°C`, s.freezer <= -14],
      ["Humidity", `${s.humidity}%`, s.humidity <= 75],
      ["Power", `${s.power}%`, s.power >= 85],
      ["Internet", `${s.internet} Mbps`, s.internet >= 8],
      ["Door Sensor", s.door, s.door === "CLOSED"],
    ];
    grid.innerHTML = rows.map(([label, val, ok]) => `
      <div class="sensor-card">
        <div class="s-label">${label}</div>
        <div class="s-value">${val}</div>
        <div class="s-status" style="color:${ok ? "var(--accent-green)" : "var(--accent-orange)"}">● ${ok ? "NORMAL" : "PERHATIAN"}</div>
        ${sparkline(s.history, ok ? "var(--accent-green)" : "var(--accent-orange)")}
      </div>`).join("");
  }

  /* =======================================================================
     RISK CENTER
     ======================================================================= */
  function riskRing(score, size) {
    size = size || 72;
    const r = (size - 8) / 2, c = 2 * Math.PI * r, offset = c * (1 - score / 100);
    const color = score >= 80 ? "var(--accent-green)" : score >= 60 ? "var(--accent-cyan)" : score >= 40 ? "var(--accent-orange)" : "var(--accent-red)";
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border-soft)" stroke-width="6"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
      <text x="50%" y="53%" text-anchor="middle" fill="var(--text-hi)" font-size="${size*0.24}" font-family="JetBrains Mono, monospace" font-weight="700">${score}</text>
    </svg>`;
  }
  function renderRiskCenter() {
    const avg = Math.round(SPPG_DATA.reduce((a, s) => a + s.riskScore, 0) / SPPG_DATA.length);
    document.getElementById("riskOverallHealth").innerHTML = `
      <div class="risk-overall-ring">${riskRing(avg, 120)}</div>
      <div>
        <div class="risk-overall-label">OVERALL OPERATIONAL HEALTH</div>
        <div class="risk-overall-tag">${healthLabel(avg)}</div>
        <p class="muted" style="max-width:440px">Risk Score menunjukkan tingkat kesehatan operasional. Nilai lebih tinggi menunjukkan kondisi lebih baik. Risk Score adalah indikator prioritas pemeriksaan, bukan bukti pelanggaran.</p>
      </div>`;

    const grid = document.getElementById("riskGrid");
    grid.innerHTML = "";
    const top = [...SPPG_DATA].sort((a, b) => a.riskScore - b.riskScore).slice(0, 12);
    top.forEach((s) => {
      const b = s.riskBreakdown;
      const card = el(`
        <div class="risk-card" data-id="${s.id}">
          <div class="risk-card-head">
            <div><div class="r-name">${escapeHtml(s.name)}</div><div class="r-loc">${escapeHtml(s.city)}, ${escapeHtml(s.province)}</div></div>
            <span class="dot dot-${s.status}"></span>
          </div>
          <div class="risk-ring-wrap">
            ${riskRing(s.riskScore)}
            <div class="risk-breakdown">
              ${riskBarRow("CCTV", b.cctv)}${riskBarRow("Produksi", b.production)}${riskBarRow("Distribusi", b.distribution)}${riskBarRow("Sensor", b.sensors)}${riskBarRow("Audit", b.audit)}
            </div>
          </div>
        </div>`);
      card.addEventListener("click", () => openDetailModal(s.id));
      grid.appendChild(card);
    });
  }
  function riskBarRow(label, val) {
    return `<div class="risk-bar-row"><span style="width:64px">${label}</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${(val/20)*100}%"></div></div><span>${val}/20</span></div>`;
  }

  /* =======================================================================
     AUDIT & INSPEKSI
     ======================================================================= */
  function renderAuditSummary() {
    document.getElementById("auditSummary").innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><span class="kpi-label">TOTAL AUDIT</span><span class="kpi-value">${AUDIT_SUMMARY.total}</span></div>
        <div class="kpi"><span class="kpi-label">COMPLETED</span><span class="kpi-value" style="color:var(--accent-green)">${AUDITS.filter(a=>a.status==="Completed").length}</span></div>
        <div class="kpi"><span class="kpi-label">FOLLOW UP</span><span class="kpi-value" style="color:var(--accent-orange)">${AUDITS.filter(a=>a.status==="Follow Up").length}</span></div>
        <div class="kpi"><span class="kpi-label">CRITICAL</span><span class="kpi-value" style="color:var(--accent-red)">${AUDITS.filter(a=>a.status==="Critical").length}</span></div>
      </div>`;
  }
  function renderAuditTable() {
    const tbody = document.querySelector("#auditTable tbody");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    AUDITS.slice(0, 30).forEach((a) => {
      const cls = a.status === "Completed" ? "completed" : a.status === "Follow Up" ? "followup" : "critical";
      const tr = el(`<tr data-audit="${a.id}">
        <td data-label="Tanggal">${a.date}</td>
        <td data-label="SPPG">${escapeHtml(a.sppgName)}</td>
        <td data-label="Petugas">${a.officer}</td>
        <td data-label="Jenis Audit">${a.category}</td>
        <td data-label="Status"><span class="audit-status ${cls}">${a.status}</span></td>
        <td data-label="Score">${a.score}</td>
        <td data-label=""><button class="link-btn" data-audit-open="${a.id}">Lihat Detail</button></td>
      </tr>`);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    tbody.querySelectorAll("[data-audit-open]").forEach((btn) => btn.addEventListener("click", () => openAuditModal(btn.dataset.auditOpen)));
  }
  const auditModal = document.getElementById("auditModal");
  function openAuditModal(id) {
    const a = AUDITS.find((x) => x.id === id);
    if (!a) return;
    state.activeAuditId = id;
    document.getElementById("auditModalBody").innerHTML = `
      <div class="detail-grid">
        <div class="detail-tile"><div class="dt-label">Tanggal</div><div class="dt-value">${a.date}</div></div>
        <div class="detail-tile"><div class="dt-label">SPPG</div><div class="dt-value">${escapeHtml(a.sppgName)}</div></div>
        <div class="detail-tile"><div class="dt-label">Petugas</div><div class="dt-value">${a.officer}</div></div>
        <div class="detail-tile"><div class="dt-label">Kategori</div><div class="dt-value">${a.category}</div></div>
        <div class="detail-tile"><div class="dt-label">Score</div><div class="dt-value">${a.score}/100</div></div>
        <div class="detail-tile"><div class="dt-label">Status</div><div class="dt-value">${a.status}</div></div>
      </div>
      <p style="margin:14px 0 4px"><strong>Temuan</strong></p>
      <p class="muted">${escapeHtml(a.findings)}</p>
      <label class="am-label" for="auditNotes">Catatan</label>
      <textarea id="auditNotes" class="am-textarea">${escapeHtml(a.notes || "")}</textarea>
      <button class="btn-ghost" id="markFollowUp" style="width:100%;margin-top:10px">MARK AS FOLLOW UP</button>`;
    auditModal.hidden = false;
    document.getElementById("markFollowUp").addEventListener("click", () => {
      a.status = "Follow Up"; a.notes = document.getElementById("auditNotes").value;
      persistAudit(a); auditModal.hidden = true; renderAuditTable(); renderAuditSummary();
    });
  }
  document.getElementById("closeAuditModal").addEventListener("click", () => (auditModal.hidden = true));
  auditModal.addEventListener("click", (e) => { if (e.target === auditModal) auditModal.hidden = true; });

  /* =======================================================================
     REPORTS — real simulated daily report + working CSV export (Blob)
     ======================================================================= */
  function renderReports() {
    const r = DAILY_REPORT;
    document.getElementById("reportBody").innerHTML = `
      <div class="report-head">
        <h3>DAILY OPERATION REPORT</h3>
        <span class="muted">${r.date} · Simulasi berbasis ${r.monitored} SPPG demo</span>
      </div>
      <div class="kpi-row wrap">
        <div class="kpi"><span class="kpi-label">SPPG MONITORED</span><span class="kpi-value">${r.monitored}</span></div>
        <div class="kpi"><span class="kpi-label">NORMAL</span><span class="kpi-value" style="color:var(--accent-green)">${r.normal}</span></div>
        <div class="kpi"><span class="kpi-label">MONITORING</span><span class="kpi-value" style="color:var(--accent-cyan)">${r.monitoring}</span></div>
        <div class="kpi"><span class="kpi-label">WARNING</span><span class="kpi-value" style="color:var(--accent-orange)">${r.warning}</span></div>
        <div class="kpi"><span class="kpi-label">CRITICAL</span><span class="kpi-value" style="color:var(--accent-red)">${r.critical}</span></div>
      </div>
      <div class="kpi-row wrap" style="margin-top:8px">
        <div class="kpi"><span class="kpi-label">CCTV INCIDENTS</span><span class="kpi-value">${r.cctvIncidents}</span></div>
        <div class="kpi"><span class="kpi-label">DISTRIBUTION DELAYS</span><span class="kpi-value">${r.distributionDelays}</span></div>
        <div class="kpi"><span class="kpi-label">SENSOR WARNINGS</span><span class="kpi-value">${r.sensorWarnings}</span></div>
      </div>
      <button class="btn-primary" id="exportCsvBtn" style="margin-top:16px">EXPORT CSV</button>`;
    document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
  }
  function exportCSV() {
    const header = ["id", "name", "province", "city", "status", "riskScore", "cctv_status", "production_completion", "distribution_completion", "audit_lastScore"];
    const rows = SPPG_DATA.map((s) => [s.id, s.name, s.province, s.city, s.status, s.riskScore, s.cctv.status, s.production.completion, s.distribution.completion, s.audit.lastScore]);
    const csv = [header.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `mbg-watch-report-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* =======================================================================
     ANALYTICS
     ======================================================================= */
  function renderAnalytics() {
    const counts = { normal: 0, monitoring: 0, warning: 0, critical: 0, offline: 0 };
    SPPG_DATA.forEach((s) => counts[s.status]++);
    const total = SPPG_DATA.length;
    document.getElementById("statusBreakdown").innerHTML = `<div style="padding:18px">` +
      Object.entries(counts).map(([status, count]) => {
        const pct = Math.round((count / total) * 100);
        return `<div class="risk-bar-row" style="font-size:12.5px;margin-bottom:10px">
          <span style="width:100px;text-transform:capitalize">${status}</span>
          <div class="risk-bar-track" style="height:8px"><div class="risk-bar-fill" style="width:${pct}%;background:${statusColorVar(status)}"></div></div>
          <span style="width:80px;text-align:right">${count} (${pct}%)</span>
        </div>`;
      }).join("") + `</div>`;

    const cctvUp = Math.round((SPPG_DATA.filter((s) => s.cctv.status === "online").length / total) * 100);
    const prodAvg = Math.round(SPPG_DATA.reduce((a, s) => a + s.production.completion, 0) / total);
    const distAvg = Math.round(SPPG_DATA.reduce((a, s) => a + s.distribution.completion, 0) / total);
    document.getElementById("analyticsKpis").innerHTML = `
      <div class="kpi-row wrap">
        <div class="kpi"><span class="kpi-label">CCTV UPTIME</span><span class="kpi-value">${cctvUp}%</span></div>
        <div class="kpi"><span class="kpi-label">PRODUCTION COMPLETION</span><span class="kpi-value">${prodAvg}%</span></div>
        <div class="kpi"><span class="kpi-label">DISTRIBUTION PUNCTUALITY</span><span class="kpi-value">${distAvg}%</span></div>
      </div>`;

    const catCounts = {};
    ALERTS.forEach((a) => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
    document.getElementById("alertsByCategory").innerHTML = Object.entries(catCounts).map(([cat, count]) => {
      const pct = Math.round((count / ALERTS.length) * 100) || 0;
      return `<div class="risk-bar-row" style="font-size:12.5px;margin-bottom:10px">
        <span style="width:100px">${cat}</span>
        <div class="risk-bar-track" style="height:8px"><div class="risk-bar-fill" style="width:${pct}%"></div></div>
        <span style="width:60px;text-align:right">${count}</span>
      </div>`;
    }).join("");
  }

  /* =======================================================================
     DETAIL MODAL (per-SPPG)
     ======================================================================= */
  const detailModal = document.getElementById("detailModal");
  function getFavorites() { return storageGet(STORAGE_KEYS.favorites, []); }
  function toggleFavorite(id) {
    const favs = getFavorites(); const idx = favs.indexOf(id);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(id);
    storageSet(STORAGE_KEYS.favorites, favs);
    renderFavoriteBtn(id); renderFavoriteList();
  }
  function renderFavoriteBtn(id) { document.getElementById("favoriteBtn").textContent = getFavorites().includes(id) ? "★" : "☆"; }
  function renderFavoriteList() {
    const favs = getFavorites(); const wrap = document.getElementById("favoriteList");
    if (!favs.length) { wrap.textContent = "Belum ada favorit"; wrap.classList.add("muted"); return; }
    wrap.classList.remove("muted");
    wrap.innerHTML = favs.map((id) => { const s = sppgById(id); return s ? `<button class="btn-ghost" data-fav-open="${id}" style="margin:3px">${escapeHtml(s.name)}</button>` : ""; }).join("");
    wrap.querySelectorAll("[data-fav-open]").forEach((b) => b.addEventListener("click", () => openDetailModal(b.dataset.favOpen)));
  }

  function detailTabContent(s, tab) {
    switch (tab) {
      case "overview":
        return `<div class="detail-grid">
          <div class="detail-tile"><div class="dt-label">CCTV</div><div class="dt-value">${s.cctv.status.toUpperCase()}</div></div>
          <div class="detail-tile"><div class="dt-label">Production</div><div class="dt-value">${s.production.completion}%</div></div>
          <div class="detail-tile"><div class="dt-label">Distribution</div><div class="dt-value">${s.distribution.completion}%</div></div>
          <div class="detail-tile"><div class="dt-label">Sensor</div><div class="dt-value">${s.riskBreakdown.sensors >= 16 ? "NORMAL" : "PERHATIAN"}</div></div>
          <div class="detail-tile"><div class="dt-label">Risk Score</div><div class="dt-value">${s.riskScore}/100</div></div>
          <div class="detail-tile"><div class="dt-label">Last Update</div><div class="dt-value" data-last-updated>LAST UPDATED —</div></div>
        </div>`;
      case "cctv":
        return cctvFeedMarkup({ id: "CAM 01", sppg: s, area: "Area Produksi" }, true);
      case "production":
        return `<div class="kpi-row"><div class="kpi"><span class="kpi-label">TARGET</span><span class="kpi-value">${fmt(s.production.target)}</span></div>
          <div class="kpi"><span class="kpi-label">PRODUKSI</span><span class="kpi-value">${fmt(s.production.produced)}</span></div>
          <div class="kpi"><span class="kpi-label">COMPLETION</span><span class="kpi-value">${s.production.completion}%</span></div></div>
          <div class="progress-track"><div class="progress-fill" style="width:${s.production.completion}%"></div></div>`;
      case "distribution":
        return `<div class="kpi-row"><div class="kpi"><span class="kpi-label">TARGET</span><span class="kpi-value">${fmt(s.distribution.target)}</span></div>
          <div class="kpi"><span class="kpi-label">DELIVERED</span><span class="kpi-value">${fmt(s.distribution.delivered)}</span></div>
          <div class="kpi"><span class="kpi-label">DELAYED</span><span class="kpi-value">${s.distribution.delayed}</span></div></div>
          ${s.distribution.delayed > 0 ? `<p class="flow-warning" style="margin-top:10px">⚠ NEEDS VERIFICATION</p>` : `<p class="flow-ok" style="margin-top:10px">✓ ON TIME</p>`}`;
      case "sensor":
        return `<div class="sensor-grid" style="padding:0">
          <div class="sensor-card"><div class="s-label">Temperature</div><div class="s-value">${s.sensors.temperature}°C</div></div>
          <div class="sensor-card"><div class="s-label">Freezer</div><div class="s-value">${s.sensors.freezer}°C</div></div>
          <div class="sensor-card"><div class="s-label">Humidity</div><div class="s-value">${s.sensors.humidity}%</div></div>
          <div class="sensor-card"><div class="s-label">Power</div><div class="s-value">${s.sensors.power}%</div></div>
          <div class="sensor-card"><div class="s-label">Internet</div><div class="s-value">${s.sensors.internet} Mbps</div></div>
          <div class="sensor-card"><div class="s-label">Door</div><div class="s-value">${s.sensors.door}</div></div>
        </div>`;
      case "audit":
        return `<p class="muted">Skor audit terakhir: <strong style="color:var(--text-hi)">${s.audit.lastScore}/100</strong> (${s.audit.lastDate}).</p>
          <p class="muted">Komponen audit pada Risk Score: <strong style="color:var(--text-hi)">${s.riskBreakdown.audit}/20</strong>.</p>`;
      case "history":
        return `<ul class="timeline" style="margin-left:0;padding:14px 0 0 18px">
          <li><span class="t-time">${s.operations.distributionStarted}</span>Distribusi dimulai</li>
          <li><span class="t-time">${s.operations.packingStarted}</span>Packing dimulai</li>
          <li><span class="t-time">${s.operations.productionStarted}</span>Produksi dimulai</li>
        </ul>`;
      default: return "";
    }
  }
  function renderDetailTab() {
    const s = sppgById(state.activeSPPGId); if (!s) return;
    document.getElementById("detailBody").innerHTML = detailTabContent(s, state.activeDetailTab);
  }
  function openDetailModal(id) {
    const s = sppgById(id); if (!s) return;
    state.activeSPPGId = id; state.activeDetailTab = "overview";
    document.getElementById("detailTitle").textContent = s.name;
    document.getElementById("detailLocation").innerHTML = `${escapeHtml(s.city)}, ${escapeHtml(s.province)} · <span class="dot dot-${s.status}"></span> ${statusLabel(s.status)} · Risk ${s.riskScore}/100`;
    document.querySelectorAll("#detailTabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === "overview"));
    renderFavoriteBtn(id); renderDetailTab(); detailModal.hidden = false;
    const lastVisited = storageGet(STORAGE_KEYS.lastVisited, []);
    storageSet(STORAGE_KEYS.lastVisited, [id, ...lastVisited.filter((x) => x !== id)].slice(0, 5));
  }
  document.getElementById("closeDetailModal").addEventListener("click", () => (detailModal.hidden = true));
  detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.hidden = true; });
  document.getElementById("favoriteBtn").addEventListener("click", () => toggleFavorite(state.activeSPPGId));
  document.getElementById("detailTabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab"); if (!tab) return;
    state.activeDetailTab = tab.dataset.tab;
    document.querySelectorAll("#detailTabs .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    renderDetailTab();
  });

  /* =======================================================================
     SYSTEM STATUS
     ======================================================================= */
  function renderSystemStatus() {
    const items = [
      ["Frontend", "normal", "Operational"],
      ["Local Storage", storageSet("mbgwatch:__test", 1) ? "normal" : "warning", storageSet("mbgwatch:__test", 1) ? "Operational" : "Unavailable"],
      ["Map Engine", "normal", "Operational"],
      ["Alert Engine", "normal", "Operational"],
      ["Simulation Engine", "normal", "Running"],
      ["API Gateway", "offline", "Not Connected"],
      ["CCTV Gateway", "offline", "Simulation Mode"],
    ];
    document.getElementById("systemStatusList").innerHTML = items.map(([label, cls, text]) =>
      `<li><span>${label}</span><span class="status-pill"><span class="dot dot-${cls === "offline" ? "offline" : "normal"}"></span>${text}</span></li>`).join("");
  }

  /* =======================================================================
     SETTINGS
     ======================================================================= */
  document.getElementById("clearStorage").addEventListener("click", () => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    applyTheme("dark"); renderFavoriteList();
    alert("Data lokal berhasil dihapus.");
  });

  /* =======================================================================
     ESCAPE closes modals / panels
     ======================================================================= */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    detailModal.hidden = true; cctvModal.hidden = true; alertModal.hidden = true; auditModal.hidden = true;
    document.getElementById("confirmModal").hidden = true;
    notifPanel.hidden = true; closeMobileSheet(); closePopup();
  });

  /* =======================================================================
     INIT
     ======================================================================= */
  function restoreFilters() {
    const saved = storageGet(STORAGE_KEYS.filters, null);
    if (saved) { state.mapStatusFilter = saved.status || "all"; state.mapProvinceFilter = saved.province || "all"; }
  }

  function initDashboard() {
    hydrateAlerts();
    hydrateAudits();
    restoreFilters();

    renderStatsAndSummary();
    renderCriticalStrip();
    renderAttention();
    populateProvinceFilter();
    document.getElementById("provinceFilter").value = state.mapProvinceFilter;
    document.querySelectorAll("#statusFilters .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.status === state.mapStatusFilter));
    renderMiniMap();
    renderLargeMap();
    renderOps();
    renderAlertsPreview();
    renderAlertsFull();
    renderActivity();
    startLiveTicker();
    renderCCTV();
    renderProductionChart();
    renderDistributionFlow();
    renderSensors();
    renderRiskCenter();
    renderAuditSummary();
    renderAuditTable();
    renderReports();
    renderAnalytics();
    renderSystemStatus();
    renderNotifList();
    renderFavoriteList();
    setLastUpdatedNow();
    setView("overview");
    appTicker.start();
  }

  /* =======================================================================
     DAPUR DASHBOARD — scoped entirely to the logged-in kitchen. Reuses
     detailTabContent()/cctvFeedMarkup() from the admin modules above so
     production/distribution/sensor/CCTV rendering logic isn't duplicated.
     ======================================================================= */
  function renderDapurHeader(sppg) {
    document.getElementById("dapurName").textContent = sppg.name;
    document.getElementById("dapurLocation").textContent = `${sppg.city}, ${sppg.province}`;
    document.getElementById("dapurStatusPill").innerHTML = `<span class="dot dot-${sppg.status}"></span>${statusLabel(sppg.status)} · Risk ${sppg.riskScore}/100`;
  }
  function renderDapurStats(sppg, profile) {
    const hadir = profile.staff.filter((s) => s.status === "Hadir").length;
    const stats = [
      { label: "STAF HADIR HARI INI", value: `${hadir}/${profile.staff.length}`, cls: "accent-green" },
      { label: "PRODUKSI", value: `${sppg.production.completion}%`, cls: "accent-gold" },
      { label: "DISTRIBUSI", value: sppg.distribution.delayed > 0 ? "TERLAMBAT" : "TEPAT WAKTU", cls: sppg.distribution.delayed > 0 ? "accent-orange" : "accent-green" },
      { label: "CCTV", value: sppg.cctv.status.toUpperCase(), cls: sppg.cctv.status === "online" ? "accent-cyan" : "accent-gray" },
    ];
    const grid = document.getElementById("dapurStatsGrid");
    grid.innerHTML = "";
    stats.forEach((s) => grid.appendChild(el(`<div class="stat-card ${s.cls}"><span class="stat-label">${s.label}</span><span class="stat-value" style="font-size:20px">${escapeHtml(String(s.value))}</span></div>`)));
  }
  function renderDapurAlertStrip(sppg) {
    const strip = document.getElementById("dapurAlertStrip");
    const mine = ALERTS.filter((a) => a.sppgId === sppg.id && a.status !== "RESOLVED");
    if (!mine.length) { strip.hidden = true; strip.innerHTML = ""; return; }
    strip.hidden = false;
    strip.innerHTML = `
      <div class="strip-head">
        <span class="strip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg></span>
        <strong>${mine.length} PERHATIAN UNTUK DAPUR ANDA</strong>
      </div>
      <div class="strip-list">${mine.map((a) => `<div class="strip-item"><div class="strip-sppg">${a.category}</div><div class="strip-msg">${escapeHtml(a.message)}</div></div>`).join("")}</div>`;
  }
  function renderDapurToday(sppg) {
    const ops = sppg.operations;
    document.getElementById("dapurTodayTimeline").innerHTML = `
      <li><span class="t-time">${ops.productionStarted}</span>Produksi dimulai</li>
      <li><span class="t-time">${ops.packingStarted}</span>Packing dimulai</li>
      <li><span class="t-time">${ops.distributionStarted}</span>Distribusi dimulai</li>`;
  }
  function renderDapurTodayMenu(profile) {
    const dayIdx = (new Date().getDay() + 6) % 7; // Mon=0..Sun=6
    const today = profile.weeklyMenu[dayIdx];
    document.getElementById("dapurTodayMenu").innerHTML = `
      <div style="padding:16px 18px">
        <div class="menu-day-name">${today.day} <span class="menu-today-badge">HARI INI</span></div>
        <div class="menu-desc">${escapeHtml(today.menu)}</div>
        <div class="menu-chips"><span class="menu-chip">${today.kalori} kkal</span><span class="menu-chip">${today.protein}g protein</span></div>
      </div>`;
  }
  function renderDapurOrgChart(profile) {
    document.getElementById("dapurOrgChart").innerHTML = profile.orgLayers.map((layer) => `
      <div class="org-connector"></div>
      <div class="org-layer">${layer.map((role) => `<div class="org-node">${role}</div>`).join("")}</div>
    `).join("");
  }
  function renderDapurStaffTable(profile) {
    const hadir = profile.staff.filter((s) => s.status === "Hadir").length;
    document.getElementById("dapurAttendanceSummary").textContent = `${hadir}/${profile.staff.length} hadir hari ini`;
    const tbody = document.querySelector("#dapurStaffTable tbody");
    tbody.innerHTML = "";
    profile.staff.forEach((s) => {
      const cls = s.status === "Hadir" ? "hadir" : s.status === "Izin" ? "izin" : "sakit";
      tbody.appendChild(el(`<tr>
        <td data-label="Nama">${escapeHtml(s.name)}</td>
        <td data-label="Jabatan">${escapeHtml(s.role)}</td>
        <td data-label="Shift">${s.shift}</td>
        <td data-label="Status"><span class="attendance-badge attendance-${cls}">${s.status}</span></td>
      </tr>`));
    });
  }
  function renderDapurMenuGrid(profile) {
    const dayIdx = (new Date().getDay() + 6) % 7;
    document.getElementById("dapurMenuGrid").innerHTML = profile.weeklyMenu.map((m, i) => `
      <div class="menu-day-card ${i === dayIdx ? "is-today" : ""}">
        <div class="menu-day-name">${m.day} ${i === dayIdx ? '<span class="menu-today-badge">HARI INI</span>' : ""}</div>
        <div class="menu-desc">${escapeHtml(m.menu)}</div>
        <div class="menu-chips"><span class="menu-chip">${m.kalori} kkal</span><span class="menu-chip">${m.protein}g protein</span></div>
      </div>`).join("");
  }
  function renderDapurOps(sppg) {
    document.getElementById("dapurProduction").innerHTML = detailTabContent(sppg, "production");
    document.getElementById("dapurDistribution").innerHTML = detailTabContent(sppg, "distribution");
  }
  function renderDapurCctv(sppg) {
    const cams = [
      { id: "CAM 01", sppg, area: "Area Produksi" },
      { id: "CAM 02", sppg, area: "Area Packing" },
    ];
    const grid = document.getElementById("dapurCctvGrid");
    grid.innerHTML = "";
    cams.forEach((cam) => {
      const card = el(`<div class="cctv-card" data-cam="${cam.id}">${cctvFeedMarkup(cam)}
        <div class="cctv-meta"><div class="cctv-sppg">${escapeHtml(cam.sppg.name)}</div><div class="cctv-area">${cam.area}</div></div>
      </div>`);
      card.addEventListener("click", () => openCctvModal(cam));
      grid.appendChild(card);
    });
  }
  function renderDapurSensor(sppg) {
    document.getElementById("dapurSensorGrid").innerHTML = detailTabContent(sppg, "sensor");
  }
  function renderDapurAudit(sppg) {
    const mine = AUDITS.filter((a) => a.sppgId === sppg.id);
    document.getElementById("dapurRiskSummary").innerHTML = `
      <div class="risk-overall-ring">${riskRing(sppg.riskScore, 110)}</div>
      <div>
        <div class="risk-overall-label">SKOR AUDIT & KEPATUHAN</div>
        <div class="risk-overall-tag">${healthLabel(sppg.riskScore)}</div>
        <p class="muted" style="max-width:420px">Skor audit terakhir: <strong style="color:var(--text-hi)">${sppg.audit.lastScore}/100</strong> (${sppg.audit.lastDate}). Nilai lebih tinggi menunjukkan kondisi lebih baik.</p>
      </div>`;
    const tbody = document.querySelector("#dapurAuditTable tbody");
    tbody.innerHTML = "";
    if (!mine.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:18px">Belum ada riwayat audit untuk dapur ini.</td></tr>`;
      return;
    }
    mine.forEach((a) => {
      const cls = a.status === "Completed" ? "completed" : a.status === "Follow Up" ? "followup" : "critical";
      tbody.appendChild(el(`<tr>
        <td data-label="Tanggal">${a.date}</td>
        <td data-label="Kategori">${a.category}</td>
        <td data-label="Petugas">${a.officer}</td>
        <td data-label="Status"><span class="audit-status ${cls}">${a.status}</span></td>
        <td data-label="Score">${a.score}</td>
      </tr>`));
    });
  }

  function initDapurDashboard(session) {
    const sppg = sppgById(session.sppgId);
    if (!sppg) { showLoginGate(); return; }
    const profile = buildDapurProfile(sppg);

    document.getElementById("dapurGreeting").textContent = `Selamat datang kembali, ${session.name}.`;
    renderDapurHeader(sppg);
    renderDapurStats(sppg, profile);
    renderDapurAlertStrip(sppg);
    renderDapurToday(sppg);
    renderDapurTodayMenu(profile);
    renderDapurOrgChart(profile);
    renderDapurStaffTable(profile);
    renderDapurMenuGrid(profile);
    renderDapurOps(sppg);
    renderDapurCctv(sppg);
    renderDapurSensor(sppg);
    renderDapurAudit(sppg);
    renderFavoriteList();

    // Lightweight live refresh — only the small set of dapur widgets that
    // show live-ish numbers, not the whole (much heavier) admin pipeline.
    appTicker.every20s(() => {
      const fresh = sppgById(session.sppgId);
      if (!fresh) return;
      renderDapurHeader(fresh);
      renderDapurStats(fresh, profile);
      renderDapurAlertStrip(fresh);
    });

    const clockNode = document.getElementById("dapurClock");
    appTicker.every1s(() => {
      if (clockNode) clockNode.textContent = new Date().toLocaleTimeString("id-ID", { hour12: false }) + " WIB";
    });

    setView("dapur-overview");
    appTicker.start();
  }

  /* =======================================================================
     SPLASH SCREEN
     ======================================================================= */
  const SPLASH_STEPS = [
    { pct: 18, text: "Menginisialisasi Command Center..." },
    { pct: 40, text: "Memuat data SPPG simulasi..." },
    { pct: 62, text: "Menyiapkan Peta & Early Warning Engine..." },
    { pct: 84, text: "Menghitung Risk Score seluruh dapur..." },
    { pct: 100, text: "Siap." },
  ];
  function runSplashSequence(done) {
    const screen = document.getElementById("splashScreen");
    const fill = document.getElementById("splashProgressFill");
    const status = document.getElementById("splashStatus");
    let i = 0;
    function step() {
      if (i >= SPLASH_STEPS.length) {
        setTimeout(() => {
          screen.classList.add("is-done");
          setTimeout(done, 650);
        }, 300);
        return;
      }
      const s = SPLASH_STEPS[i++];
      fill.style.width = s.pct + "%";
      status.style.opacity = "0";
      setTimeout(() => { status.textContent = s.text; status.style.opacity = "1"; }, 150);
      setTimeout(step, 480);
    }
    step();
  }

  /* =======================================================================
     LOGIN GATE — simulated auth only. No real credential is ever checked
     or stored; this exists purely to demonstrate the two user contexts
     ("Tim Admin & Audit Nasional" vs "Akun Dapur SPPG") in the prototype.
     ======================================================================= */
  const loginGate = document.getElementById("loginGate");
  const loginRolesEl = document.getElementById("loginRoles");
  const loginFormEl = document.getElementById("loginForm");
  let selectedRole = null;

  function showLoginGate() { loginGate.hidden = false; }

  function populateDemoButtons(role) {
    const wrap = document.getElementById("loginDemoButtons");
    wrap.innerHTML = "";
    (DEMO_ACCOUNTS[role] || []).forEach((acc) => {
      const b = el(`<button type="button" class="btn-ghost">${escapeHtml(acc.name)} — ${escapeHtml(acc.title)}</button>`);
      b.addEventListener("click", () => loginWithAccount(acc));
      wrap.appendChild(b);
    });
  }

  loginRolesEl.addEventListener("click", (e) => {
    const card = e.target.closest(".role-card");
    if (!card) return;
    selectedRole = card.dataset.role;
    document.getElementById("loginFormTitle").textContent =
      selectedRole === "admin" ? "Masuk sebagai Tim Admin & Audit" : "Masuk sebagai Akun Dapur (SPPG)";
    populateDemoButtons(selectedRole);
    loginRolesEl.hidden = true;
    loginFormEl.hidden = false;
  });
  document.getElementById("loginBack").addEventListener("click", () => {
    loginFormEl.hidden = true;
    loginRolesEl.hidden = false;
  });
  loginFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = document.getElementById("loginUser").value.trim();
    const fallback = DEMO_ACCOUNTS[selectedRole] && DEMO_ACCOUNTS[selectedRole][0];
    const account = fallback
      ? (typed ? { ...fallback, name: typed } : fallback)
      : { id: "guest", name: typed || "Pengguna Demo", title: selectedRole === "admin" ? "Tim Admin & Audit" : "Akun Dapur", role: selectedRole };
    loginWithAccount(account);
  });

  function loginWithAccount(account) {
    const session = { role: account.role, name: account.name, title: account.title, sppgId: account.sppgId || null };
    sessionSet(SESSION_KEY, session);
    loginGate.hidden = true;
    showApp(session);
  }

  /* =======================================================================
     SHOW APP — reveals the dashboard shell and personalizes it for the
     logged-in role, then boots the correct dashboard renderers exactly
     once. Admin/audit logins get the full national command center;
     dapur logins get a separate, scoped-down kitchen dashboard.
     ======================================================================= */
  let dashboardBooted = false;
  function showApp(session) {
    document.getElementById("protoBanner").hidden = false;
    document.getElementById("appShell").hidden = false;

    const initials = (session.name || "PM").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "PM";
    document.getElementById("operatorName").textContent = session.name;
    document.getElementById("operatorRole").textContent = session.title;
    document.getElementById("operatorAvatar").textContent = initials;
    document.getElementById("topbarOperatorName").textContent = session.name;
    document.getElementById("topbarAvatar").textContent = initials;
    document.getElementById("settingsAccountInfo").textContent = `${session.name} — ${session.title}`;

    state.appMode = session.role === "dapur" ? "dapur" : "admin";
    document.getElementById("sidebarNavAdmin").hidden = state.appMode !== "admin";
    document.getElementById("sidebarNavDapur").hidden = state.appMode !== "dapur";
    document.getElementById("bottomNavAdmin").hidden = state.appMode !== "admin";
    document.getElementById("bottomNavDapur").hidden = state.appMode !== "dapur";
    document.getElementById("topbarSub").textContent = state.appMode === "dapur" ? "Dashboard Dapur Saya" : "National Monitoring Command Center";
    document.getElementById("globalSearch").closest(".topbar-search").hidden = state.appMode === "dapur";

    if (!dashboardBooted) {
      dashboardBooted = true;
      if (state.appMode === "dapur" && session.sppgId) {
        initDapurDashboard(session);
      } else {
        initDashboard();
      }
    }
  }

  function doLogout() {
    sessionClear(SESSION_KEY);
    location.reload();
  }
  function showConfirm(message, onConfirm) {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmMessage").textContent = message;
    modal.hidden = false;
    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");
    function cleanup() { modal.hidden = true; okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); }
    function onOk() { cleanup(); onConfirm(); }
    function onCancel() { cleanup(); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  }
  document.getElementById("logoutBtn").addEventListener("click", () => showConfirm("Keluar dari sesi ini?", doLogout));
  document.getElementById("userChipLogout").addEventListener("click", () => showConfirm("Keluar dari sesi ini?", doLogout));

  /* =======================================================================
     BOOTSTRAP
     ======================================================================= */
  document.addEventListener("DOMContentLoaded", () => {
    runSplashSequence(() => {
      const existing = sessionGet(SESSION_KEY, null);
      if (existing && existing.role) showApp(existing);
      else showLoginGate();
    });
  });
})();

// PWA: register the service worker so the app qualifies as installable and
// keeps working if the connection drops. Kept outside the main IIFE / off
// the critical path — registration failing (e.g. file:// preview) must
// never block the dashboard itself.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* preview/offline contexts: ignore */ });
  });
}
