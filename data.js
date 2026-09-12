/* =========================================================================
   MBG WATCH v2 — data.js
   -------------------------------------------------------------------------
   SELURUH DATA DI FILE INI ADALAH DATA DUMMY / SIMULASI.
   Tidak ada data pribadi, tidak ada feed CCTV nyata, dan tidak ada kaitan
   dengan sistem resmi pemerintah / BGN mana pun. Semua nilai dihasilkan
   secara deterministik (seeded) supaya angka konsisten setiap kali dibuka,
   namun tetap "berhubungan secara logis" satu sama lain — bukan angka acak
   tanpa arti.

   Struktur SPPG:
   {
     id, name, province, city, lat, lng,
     status,                // NORMAL | MONITORING | WARNING | CRITICAL | OFFLINE (diturunkan, bukan acak)
     riskScore,              // 0-100, dihitung dari breakdown 5 komponen
     riskBreakdown: { cctv, production, distribution, sensors, audit }, // masing2 0-20
     cctv: { status, camerasOnline, camerasTotal, offlineMinutes, lastSeen },
     production: { target, produced, completion },
     distribution: { target, delivered, delayed, completion },
     sensors: { temperature, humidity, freezer, power, internet, door, history:[...] },
     operations: { productionStarted, packingStarted, distributionStarted },
     audit: { lastScore, lastDate }
   }
   ========================================================================= */

/* ---------------- Deterministic PRNG so numbers stay stable per reload -- */
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const rand = seededRandom(20260908);
function randInt(min, max) { return Math.floor(min + rand() * (max - min + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ---------------- Regional anchor points across Indonesia --------------- */
const REGIONS = [
  ["Aceh", "Banda Aceh", 5.55, 95.32],
  ["Sumatera Utara", "Medan", 3.59, 98.67],
  ["Sumatera Barat", "Padang", -0.95, 100.35],
  ["Riau", "Pekanbaru", 0.51, 101.45],
  ["Jambi", "Jambi", -1.61, 103.61],
  ["Sumatera Selatan", "Palembang", -2.99, 104.76],
  ["Bengkulu", "Bengkulu", -3.79, 102.26],
  ["Lampung", "Bandar Lampung", -5.43, 105.26],
  ["Banten", "Serang", -6.12, 106.15],
  ["DKI Jakarta", "Jakarta", -6.2, 106.82],
  ["Jawa Barat", "Bandung", -6.92, 107.61],
  ["Jawa Barat", "Bogor", -6.6, 106.8],
  ["Jawa Barat", "Depok", -6.4, 106.82],
  ["Jawa Tengah", "Semarang", -6.97, 110.42],
  ["Jawa Tengah", "Solo", -7.57, 110.83],
  ["DI Yogyakarta", "Yogyakarta", -7.8, 110.36],
  ["Jawa Timur", "Surabaya", -7.25, 112.75],
  ["Jawa Timur", "Malang", -7.98, 112.63],
  ["Bali", "Denpasar", -8.65, 115.22],
  ["Nusa Tenggara Barat", "Mataram", -8.58, 116.11],
  ["Nusa Tenggara Timur", "Kupang", -10.18, 123.61],
  ["Kalimantan Barat", "Pontianak", -0.03, 109.33],
  ["Kalimantan Tengah", "Palangka Raya", -2.21, 113.92],
  ["Kalimantan Selatan", "Banjarmasin", -3.32, 114.59],
  ["Kalimantan Timur", "Samarinda", -0.5, 117.15],
  ["Kalimantan Utara", "Tanjung Selor", 2.84, 117.36],
  ["Sulawesi Utara", "Manado", 1.47, 124.85],
  ["Sulawesi Tengah", "Palu", -0.9, 119.87],
  ["Sulawesi Selatan", "Makassar", -5.15, 119.43],
  ["Sulawesi Tenggara", "Kendari", -3.97, 122.51],
  ["Gorontalo", "Gorontalo", 0.54, 123.06],
  ["Maluku", "Ambon", -3.7, 128.18],
  ["Maluku Utara", "Ternate", 0.79, 127.38],
  ["Papua", "Jayapura", -2.53, 140.72],
  ["Papua Barat", "Manokwari", -0.86, 128.5],
];

/* =========================================================================
   RISK ENGINE — semua nilai risiko dihitung, tidak pernah acak langsung.
   Semakin tinggi skor = semakin sehat kondisi operasional SPPG.
   ========================================================================= */
const RISK_THRESHOLDS = [
  { min: 80, status: "normal", label: "NORMAL" },
  { min: 60, status: "monitoring", label: "MONITORING" },
  { min: 40, status: "warning", label: "WARNING" },
  { min: 0, status: "critical", label: "CRITICAL" },
];

function riskStatusFromScore(score) {
  return RISK_THRESHOLDS.find((t) => score >= t.min);
}

/** Komponen CCTV: 20 poin penuh jika online & seluruh kamera aktif.
 *  Setiap kamera offline & setiap kelipatan 15 menit downtime memotong skor. */
function scoreCCTV(cctv) {
  let s = 20;
  if (cctv.status === "offline") s -= 12;
  s -= (cctv.camerasTotal - cctv.camerasOnline) * 3;
  s -= Math.floor(cctv.offlineMinutes / 15) * 2;
  return clamp(Math.round(s), 0, 20);
}

/** Komponen Produksi: berbasis completion rate terhadap target. */
function scoreProduction(p) {
  const completion = p.target > 0 ? p.produced / p.target : 1;
  let s = 20 * clamp(completion, 0, 1.02);
  if (completion < 0.85) s -= 3; // penalti tambahan jika jauh dari target
  return clamp(Math.round(s), 0, 20);
}

/** Komponen Distribusi: completion rate + penalti keterlambatan. */
function scoreDistribution(d) {
  const completion = d.target > 0 ? d.delivered / d.target : 1;
  let s = 20 * clamp(completion, 0, 1.02);
  s -= clamp(d.delayed, 0, 6) * 1.6;
  return clamp(Math.round(s), 0, 20);
}

/** Komponen Sensor: setiap sensor abnormal memotong skor. */
function scoreSensors(sensors) {
  let abnormal = 0;
  if (sensors.temperature > 8 || sensors.temperature < 1) abnormal++;
  if (sensors.freezer > -14) abnormal++;
  if (sensors.humidity > 75 || sensors.humidity < 35) abnormal++;
  if (sensors.power < 85) abnormal++;
  if (sensors.internet < 8) abnormal++;
  if (sensors.door === "OPEN") abnormal++;
  return clamp(20 - abnormal * 4, 0, 20);
}

/** Komponen Audit: berbasis skor audit terakhir (0-100 -> 0-20). */
function scoreAudit(audit) {
  return clamp(Math.round((audit.lastScore / 100) * 20), 0, 20);
}

/** Menghitung Risk Score total (0-100) dari 5 komponen, masing-masing 20 poin. */
function calculateRiskScore(sppg) {
  const cctv = scoreCCTV(sppg.cctv);
  const production = scoreProduction(sppg.production);
  const distribution = scoreDistribution(sppg.distribution);
  const sensors = scoreSensors(sppg.sensors);
  const audit = scoreAudit(sppg.audit);
  const total = cctv + production + distribution + sensors + audit;
  return { total: clamp(total, 0, 100), breakdown: { cctv, production, distribution, sensors, audit } };
}

/** Menurunkan status akhir SPPG dari risk score DAN kombinasi indikator —
 *  bukan dari angka acak. Kombinasi beberapa indikator buruk sekaligus
 *  dapat memaksa status menjadi lebih tinggi tingkat urgensinya. */
function deriveSPPGStatus(sppg) {
  const { total, breakdown } = calculateRiskScore(sppg);
  let statusInfo = riskStatusFromScore(total);
  let status = statusInfo.status;

  const cctvDown = sppg.cctv.status === "offline" && sppg.cctv.offlineMinutes > 30;
  const distributionLate = sppg.distribution.delayed > 0;
  const sensorAbnormal = breakdown.sensors < 14;

  // Kombinasi 3 indikator buruk sekaligus -> paksa CRITICAL walau skor borderline
  if (cctvDown && distributionLate && sensorAbnormal) status = "critical";

  // SPPG dianggap OFFLINE (tidak dapat dipantau) jika CCTV mati lama sekali
  // DAN koneksi internet dapur juga sangat lemah — bukan sekadar 1 indikator.
  if (sppg.cctv.offlineMinutes >= 90 && sppg.sensors.internet < 3) status = "offline";

  return { status, riskScore: total, breakdown };
}

/* =========================================================================
   BUILD SPPG DATASET
   ========================================================================= */
function makeSPPG(index) {
  const region = REGIONS[Math.floor(rand() * REGIONS.length)];
  const [province, city, baseLat, baseLng] = region;
  const code = String(300 + index).padStart(3, "0");

  // --- Raw operational inputs (these drive everything else; never random status) ---
  const cctvOffline = rand() < 0.16;
  const camerasTotal = pick([2, 3, 4]);
  const camerasOnline = cctvOffline ? Math.max(0, camerasTotal - randInt(1, camerasTotal)) : camerasTotal;
  const offlineMinutes = cctvOffline ? randInt(15, 130) : 0;

  const prodTarget = randInt(1500, 2400);
  const prodRate = rand() < 0.12 ? 0.72 + rand() * 0.15 : 0.9 + rand() * 0.11;
  const produced = Math.round(prodTarget * clamp(prodRate, 0, 1.03));

  const distTarget = produced;
  const delayed = rand() < 0.18 ? randInt(1, 4) : 0;
  const delivered = Math.round(distTarget * (delayed > 0 ? 0.88 + rand() * 0.08 : 0.97 + rand() * 0.04));

  const tempAbnormal = rand() < 0.12;
  const sensors = {
    temperature: +(tempAbnormal ? 8.5 + rand() * 4 : 2.5 + rand() * 4).toFixed(1),
    humidity: randInt(45, 70),
    freezer: +(rand() < 0.1 ? -10 - rand() * 3 : -20 + rand() * 3).toFixed(1),
    power: randInt(80, 100),
    internet: +(cctvOffline && rand() < 0.4 ? rand() * 6 : 10 + rand() * 60).toFixed(0),
    door: rand() < 0.06 ? "OPEN" : "CLOSED",
    history: Array.from({ length: 12 }, (_, i) => +(4 + Math.sin(i / 2 + index) * 1.4 + rand() * 0.6).toFixed(1)),
  };

  const auditScore = rand() < 0.15 ? randInt(45, 68) : randInt(70, 98);

  const sppg = {
    id: `SPPG-${String(index).padStart(3, "0")}`,
    name: `SPPG ${city} ${code}`,
    province,
    city,
    lat: +(baseLat + (rand() - 0.5) * 0.7).toFixed(4),
    lng: +(baseLng + (rand() - 0.5) * 0.7).toFixed(4),
    cctv: {
      status: cctvOffline ? "offline" : "online",
      camerasOnline,
      camerasTotal,
      offlineMinutes,
      lastSeen: offlineMinutes > 0 ? `${offlineMinutes} menit lalu` : "Baru saja",
    },
    production: {
      target: prodTarget,
      produced,
      completion: +((produced / prodTarget) * 100).toFixed(1),
    },
    distribution: {
      target: distTarget,
      delivered,
      delayed,
      completion: +((delivered / distTarget) * 100).toFixed(1),
    },
    sensors,
    operations: {
      productionStarted: `0${randInt(5, 6)}:${String(randInt(0, 59)).padStart(2, "0")}`,
      packingStarted: `0${randInt(7, 8)}:${String(randInt(0, 59)).padStart(2, "0")}`,
      distributionStarted: `0${randInt(8, 9)}:${String(randInt(0, 59)).padStart(2, "0")}`,
    },
    audit: {
      lastScore: auditScore,
      lastDate: `${randInt(1, 8)} Sep 2026`,
    },
  };

  const derived = deriveSPPGStatus(sppg);
  sppg.status = derived.status;
  sppg.riskScore = derived.riskScore;
  sppg.riskBreakdown = derived.breakdown;
  return sppg;
}

const SPPG_TOTAL_DEMO = 300;
const SPPG_DATA = Array.from({ length: SPPG_TOTAL_DEMO }, (_, i) => makeSPPG(i + 1));

/* Featured SPPG reused for CCTV grid / storyline continuity */
const FEATURED = {
  bogor: SPPG_DATA.find((s) => s.city === "Bogor") || SPPG_DATA[0],
  depok: SPPG_DATA.find((s) => s.city === "Depok") || SPPG_DATA[1],
  bandung: SPPG_DATA.find((s) => s.city === "Bandung") || SPPG_DATA[2],
  jakarta: SPPG_DATA.find((s) => s.city === "Jakarta") || SPPG_DATA[3],
};

/* =========================================================================
   DEMO ACCOUNTS — untuk simulasi login. TIDAK ADA kredensial sungguhan;
   password apa pun diterima di sisi UI. Murni untuk membedakan tampilan
   "Tim Admin & Audit" vs "Akun Dapur (SPPG)".
   ========================================================================= */
const DEMO_ACCOUNTS = {
  admin: [
    { id: "admin-01", name: "Andi Prasetyo", title: "Petugas Audit Nasional", role: "admin" },
    { id: "admin-02", name: "Sri Wulandari", title: "Supervisor Monitoring", role: "admin" },
  ],
  dapur: [
    { id: "dapur-01", name: "Kepala Dapur", title: FEATURED.bogor.name, role: "dapur", sppgId: FEATURED.bogor.id },
    { id: "dapur-02", name: "Kepala Dapur", title: FEATURED.depok.name, role: "dapur", sppgId: FEATURED.depok.id },
  ],
};

/* =========================================================================
   DAPUR PROFILE — staff, org structure, and weekly menu schedule for a
   single SPPG. Generated deterministically per SPPG id so it stays stable
   across reloads. This powers the separate "Dapur Dashboard" shown to
   kitchen-role logins (as opposed to the national command center shown to
   admin/audit logins).
   ========================================================================= */
const STAFF_NAMES = [
  "Siti Aminah", "Budi Santoso", "Rina Wulandari", "Agus Setiawan", "Dewi Lestari",
  "Fajar Nugroho", "Maya Kusuma", "Rudi Hartono", "Lina Marlina", "Yusuf Hidayat",
  "Putri Ramadhani", "Hendra Gunawan", "Nurul Fadhila", "Wahyu Saputra", "Ayu Puspitasari",
];
const STAFF_ROLES = [
  "Kepala Dapur", "Wakil Kepala Dapur", "Ahli Gizi", "Kepala Produksi",
  "Juru Masak", "Juru Masak", "Staf Packing", "Staf Distribusi", "Staf Kebersihan",
];
const WEEKLY_MENU_BANK = [
  ["Nasi, Ayam Bumbu Bali, Tumis Kangkung, Pisang", 620, 22],
  ["Nasi, Ikan Nila Goreng, Sayur Bayam, Jeruk", 580, 24],
  ["Nasi, Telur Balado, Tempe Orek, Sup Wortel, Semangka", 560, 18],
  ["Nasi, Ayam Kecap, Capcay Sayur, Pepaya", 610, 21],
  ["Nasi, Rendang Daging, Sayur Asem, Pisang", 650, 25],
  ["Nasi, Ikan Kembung Bakar, Tumis Buncis, Jeruk", 590, 23],
  ["Nasi, Soto Ayam, Kerupuk, Melon", 570, 20],
];
const WEEK_DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function buildDapurProfile(sppg) {
  const seed = sppg.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 97 + 13;
  const r = seededRandom(seed);
  const staff = STAFF_ROLES.map((role, i) => {
    const roll = r();
    return {
      id: `${sppg.id}-staff-${i + 1}`,
      name: STAFF_NAMES[Math.floor(r() * STAFF_NAMES.length)],
      role,
      shift: i < 4 ? "Pagi · 05:00–13:00" : "Siang · 09:00–17:00",
      status: roll < 0.85 ? "Hadir" : roll < 0.94 ? "Izin" : "Sakit",
    };
  });
  const weeklyMenu = WEEK_DAYS_ID.map((day, i) => ({
    day, menu: WEEKLY_MENU_BANK[i][0], kalori: WEEKLY_MENU_BANK[i][1], protein: WEEKLY_MENU_BANK[i][2],
  }));
  // Simple layered org structure (rendered top-to-bottom, not a full chart)
  const orgLayers = [
    ["Kepala Dapur"],
    ["Wakil Kepala Dapur"],
    ["Ahli Gizi", "Kepala Produksi"],
    ["Juru Masak", "Staf Packing", "Staf Distribusi"],
    ["Staf Kebersihan"],
  ];
  return { staff, weeklyMenu, orgLayers };
}

/* =========================================================================
   NATIONAL SIMULATION — angka agregat nasional SIMULASI, terpisah dari
   300 SPPG demo yang benar-benar dimuat di browser. Selalu ditampilkan
   dengan badge "SIMULASI NASIONAL" di UI, tidak pernah disamakan dengan
   data demo yang bisa diklik satu per satu.
   ========================================================================= */
const NATIONAL_SIMULATION = {
  totalSPPG: 27381,
  operational: 25902,
  monitoring: 1210,
  warning: 222,
  critical: 47,
};

/* =========================================================================
   LIVE PULSE — angka nasional yang "berjalan" (meals served, kendaraan
   aktif, petugas bertugas, admin online) untuk memberi kesan sistem yang
   benar-benar hidup saat didemokan/diuji. Terpisah total dari SPPG_DATA:
   murni kosmetik, tidak memengaruhi status/risk score dapur mana pun.
   ========================================================================= */
const LIVE_PULSE = {
  mealsToday: 812430,
  childrenServed: 662114,
  vehiclesActive: 1866,
  staffOnDuty: 9820,
  adminOnline: 14,
};
function livePulseRandInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function tickLivePulse() {
  LIVE_PULSE.mealsToday += livePulseRandInt(40, 260);
  LIVE_PULSE.childrenServed += livePulseRandInt(20, 140);
  LIVE_PULSE.vehiclesActive = Math.max(1500, Math.min(2200, LIVE_PULSE.vehiclesActive + livePulseRandInt(-3, 4)));
  LIVE_PULSE.staffOnDuty = Math.max(9000, Math.min(10500, LIVE_PULSE.staffOnDuty + livePulseRandInt(-15, 20)));
  LIVE_PULSE.adminOnline = Math.max(6, Math.min(24, LIVE_PULSE.adminOnline + (Math.random() < 0.5 ? -1 : 1)));
}

/* =========================================================================
   ALERTS — dibangkitkan dari kondisi nyata tiap SPPG (bukan daftar statis),
   supaya Early Warning benar-benar terhubung ke CCTV/Produksi/Distribusi/
   Sensor/Audit tiap dapur.
   ========================================================================= */
function buildAlerts() {
  const alerts = [];
  let counter = 1;
  function push(sppg, level, category, message) {
    counter++;
    alerts.push({
      id: `ALT-${String(counter).padStart(4, "0")}`,
      sppgId: sppg.id,
      sppgName: sppg.name,
      level, // critical | warning | monitoring
      category, // CCTV | PRODUCTION | DISTRIBUTION | SENSOR | AUDIT
      message,
      time: sppg.cctv.lastSeen === "Baru saja" ? "Baru saja" : `${randInt(1, 3)} jam lalu`,
      createdAt: Date.now() - randInt(2, 240) * 60000,
      status: "OPEN", // OPEN | ASSIGNED | VERIFYING | RESOLVED
      riskImpact: -randInt(4, 12),
    });
  }

  SPPG_DATA.forEach((s) => {
    if (s.cctv.status === "offline") {
      push(s, s.cctv.offlineMinutes > 45 ? "critical" : "warning", "CCTV",
        `CCTV ${s.cctv.camerasTotal - s.cctv.camerasOnline}/${s.cctv.camerasTotal} kamera offline selama ${s.cctv.offlineMinutes} menit.`);
    }
    if (s.distribution.delayed > 0) {
      push(s, s.distribution.delayed >= 3 ? "critical" : "warning", "DISTRIBUTION",
        `Distribusi tertunda, ${s.distribution.delayed} titik pengiriman belum terverifikasi.`);
    }
    if (s.sensors.temperature > 8 || s.sensors.freezer > -14) {
      push(s, "warning", "SENSOR", `Suhu penyimpanan di luar ambang batas normal (${s.sensors.temperature}°C).`);
    }
    if (s.sensors.internet < 8) {
      push(s, "monitoring", "SENSOR", `Konektivitas internet dapur rendah (${s.sensors.internet} Mbps).`);
    }
    if (s.audit.lastScore < 70) {
      push(s, s.audit.lastScore < 55 ? "critical" : "warning", "AUDIT",
        `Skor audit terakhir ${s.audit.lastScore}/100 memerlukan tindak lanjut.`);
    }
  });

  // Sort: critical first, then by time desc
  const rank = { critical: 0, warning: 1, monitoring: 2 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level] || b.createdAt - a.createdAt);
  return alerts;
}
const ALERTS = buildAlerts();

/* -------------------------------------------------------------------------
   RUNTIME ALERT SIMULATION — separate from buildAlerts() above (which is
   the deterministic "ground truth" derived from each SPPG's condition at
   load time). These two functions let app.js's live ticker make the Alert
   module / notif bell feel genuinely worked, for testing notification UI:
     - spawnSyntheticAlert(): a new incident "comes in" for a random SPPG
     - progressRandomAlert(): staff move an OPEN alert through its workflow
   Both only ever touch the runtime ALERTS array — SPPG_DATA / risk scores
   are untouched, so this never drifts out of sync with what each SPPG page
   actually shows.
   ------------------------------------------------------------------------- */
const SYNTHETIC_ALERT_TEMPLATES = [
  { level: "warning", category: "CCTV", message: () => `CCTV mengalami gangguan sinyal sesaat, sedang dicek ulang oleh sistem.` },
  { level: "monitoring", category: "PRODUCTION", message: () => `Kecepatan produksi melambat ${randInt(5, 15)}% dari rata-rata jam ini.` },
  { level: "warning", category: "DISTRIBUTION", message: () => `Kendaraan distribusi terlambat berangkat ${randInt(10, 35)} menit dari jadwal.` },
  { level: "monitoring", category: "SENSOR", message: () => `Fluktuasi suhu ringan terdeteksi pada unit pendingin.` },
  { level: "warning", category: "SENSOR", message: () => `Kelembapan ruang penyimpanan di luar rentang ideal.` },
  { level: "monitoring", category: "AUDIT", message: () => `Checklist kebersihan harian belum ditandai selesai oleh petugas.` },
  { level: "critical", category: "DISTRIBUTION", message: () => `${randInt(2, 5)} titik pengiriman melaporkan keterlambatan lebih dari 1 jam.` },
  { level: "warning", category: "STAFF", message: () => `Petugas dapur kurang ${randInt(1, 3)} orang dari jadwal shift hari ini.` },
  { level: "monitoring", category: "STAFF", message: () => `Pergantian shift petugas tercatat, serah terima checklist sedang diverifikasi.` },
  { level: "warning", category: "HYGIENE", message: () => `Checklist sanitasi peralatan masak belum ditandai selesai lebih dari 2 jam.` },
  { level: "critical", category: "HYGIENE", message: () => `Indikasi kontaminasi silang pada area penyimpanan bahan mentah, perlu inspeksi segera.` },
  { level: "monitoring", category: "LOGISTICS", message: () => `Stok bahan baku untuk menu besok tersisa ${randInt(20, 45)}%.` },
  { level: "warning", category: "LOGISTICS", message: () => `Pengiriman bahan baku dari pemasok tertunda ${randInt(1, 4)} jam.` },
];
let syntheticAlertSeq = 1;
/** spawnSyntheticAlert(forcedLevel?, forcedSppg?) — normally called by the
 *  automatic 20s live-simulation tick with no arguments (random SPPG,
 *  random template). The QA/testing panel in Settings reuses the exact
 *  same function but pins the level (and optionally the SPPG) so a tester
 *  can deterministically produce a CRITICAL/WARNING alert on demand
 *  without waiting for the automatic simulation to roll one. */
function spawnSyntheticAlert(forcedLevel, forcedSppg) {
  const sppg = forcedSppg || pick(SPPG_DATA);
  const pool = forcedLevel ? SYNTHETIC_ALERT_TEMPLATES.filter((t) => t.level === forcedLevel) : SYNTHETIC_ALERT_TEMPLATES;
  const tpl = pick(pool.length ? pool : SYNTHETIC_ALERT_TEMPLATES);
  const alert = {
    id: `ALT-RT-${String(syntheticAlertSeq++).padStart(4, "0")}`,
    sppgId: sppg.id,
    sppgName: sppg.name,
    level: tpl.level,
    category: tpl.category,
    message: tpl.message(),
    time: "Baru saja",
    createdAt: Date.now(),
    status: "OPEN",
    riskImpact: -randInt(2, 9),
  };
  ALERTS.unshift(alert);
  return alert;
}
/** qaResolveRandomAlert() — used by the testing panel's "Selesaikan 1 Alert
 *  Acak" button: jumps a random non-resolved alert straight to RESOLVED
 *  instead of stepping it through the workflow one stage at a time
 *  (progressRandomAlert already covers the gradual/automatic case). */
function qaResolveRandomAlert() {
  const open = ALERTS.filter((a) => a.status !== "RESOLVED");
  if (!open.length) return null;
  const a = pick(open);
  a.status = "RESOLVED";
  return a;
}
/** qaForceSppgOffline() — used by the testing panel's "Jadikan 1 SPPG
 *  Offline" button: pushes one random SPPG's CCTV fully offline, lets the
 *  existing deterministic risk engine (deriveSPPGStatus) recompute its
 *  status/score from that new condition, and raises a matching CRITICAL
 *  alert — so testers can see the whole chain (map marker → risk score →
 *  alert → notification) react to a single manual trigger. */
function qaForceSppgOffline(forcedSppg) {
  const s = forcedSppg || pick(SPPG_DATA);
  s.cctv.status = "offline";
  s.cctv.camerasOnline = 0;
  s.cctv.offlineMinutes = randInt ? randInt(60, 120) : 90;
  const derived = deriveSPPGStatus(s);
  s.status = derived.status;
  s.riskScore = derived.riskScore;
  s.riskBreakdown = derived.breakdown;
  const alert = {
    id: `ALT-QA-${String(syntheticAlertSeq++).padStart(4, "0")}`,
    sppgId: s.id,
    sppgName: s.name,
    level: "critical",
    category: "CCTV",
    message: `Seluruh ${s.cctv.camerasTotal} kamera CCTV offline selama ${s.cctv.offlineMinutes} menit (dipicu manual untuk pengujian).`,
    time: "Baru saja",
    createdAt: Date.now(),
    status: "OPEN",
    riskImpact: -18,
  };
  ALERTS.unshift(alert);
  return { sppg: s, alert };
}
/** randomViewerCount(sppgId) — small cosmetic touch for the SPPG detail
 *  modal: shows "N admin lain sedang melihat" so the dashboard feels like
 *  a live multi-user system rather than a single-viewer static page.
 *  Purely decorative, re-rolled each time a detail modal is opened. */
function randomViewerCount() {
  return Math.random() < 0.55 ? 0 : Math.floor(1 + Math.random() * 4);
}

/* =========================================================================
   PENGUMUMAN NASIONAL & KOLABORASI ANTAR DAPUR
   Two lightweight, deliberately-scoped social/informational layers on top
   of the incident-driven ALERTS system:
     - NATIONAL_ANNOUNCEMENTS: top-down broadcasts from "Tim Pusat" to every
       kitchen — same content for everyone, so no privacy concern.
     - DAPUR_COLLAB_LOG: a simulated peer-to-peer "minta bantuan antar
       dapur" flow (borrow ingredients/staff/vehicle from a nearby kitchen).
       Each kitchen only ever sees log entries where it is the sender or
       the recipient (enforced by the render function's filter, mirroring
       how ALERTS is scoped per-kitchen) — nobody sees a *third* kitchen's
       request, only their own two-way exchanges.
   ========================================================================= */
const ANNOUNCEMENT_TEMPLATES = [
  { title: "Pembaruan SOP Kebersihan Dapur", body: "Tim Pusat merilis pembaruan SOP kebersihan alat masak dan area penyimpanan bahan baku, berlaku mulai minggu depan." },
  { title: "Penyesuaian Jadwal Distribusi", body: "Jadwal distribusi di beberapa wilayah disesuaikan menjelang hari libur nasional mendatang — mohon konfirmasi kesiapan dapur masing-masing." },
  { title: "Pelatihan Daring: Manajemen Stok Bahan Baku", body: "Sesi pelatihan daring untuk seluruh kepala dapur akan diadakan pekan ini, membahas efisiensi stok dan pengurangan food waste." },
  { title: "Pembaruan Formulir Laporan Produksi", body: "Formulir pelaporan produksi harian mendapat kolom baru: catatan kualitas bahan baku yang diterima." },
  { title: "Imbauan Musim Hujan", body: "Mohon pastikan area penyimpanan bahan baku terlindung dari kebocoran/rembesan air selama musim hujan." },
  { title: "Verifikasi Data Kontak Dapur", body: "Setiap dapur mohon memverifikasi ulang nomor kontak PIC yang terdaftar di sistem sebelum akhir bulan." },
  { title: "Apresiasi Kinerja Mingguan", body: "Terima kasih atas kinerja distribusi tepat waktu minggu ini — pertahankan dan terus tingkatkan koordinasi antar dapur." },
];
let announcementSeq = 1;
const NATIONAL_ANNOUNCEMENTS = ANNOUNCEMENT_TEMPLATES.slice(0, 3).map((t, i) => ({
  id: `ANN-${String(announcementSeq++).padStart(3, "0")}`,
  title: t.title,
  body: t.body,
  from: "Tim Pusat MBG Watch",
  time: i === 0 ? "1 hari lalu" : `${i + 1} hari lalu`,
  createdAt: Date.now() - (i + 1) * 86400000,
}));
function spawnAnnouncement() {
  const t = pick(ANNOUNCEMENT_TEMPLATES);
  const a = {
    id: `ANN-${String(announcementSeq++).padStart(3, "0")}`,
    title: t.title, body: t.body, from: "Tim Pusat MBG Watch",
    time: "Baru saja", createdAt: Date.now(),
  };
  NATIONAL_ANNOUNCEMENTS.unshift(a);
  while (NATIONAL_ANNOUNCEMENTS.length > 12) NATIONAL_ANNOUNCEMENTS.pop();
  return a;
}

/** nearestSppgTo(sppg, n) — n closest other kitchens by straight-line
 *  lat/lng distance. Used for the "Jaringan Dapur Terdekat" panel; only
 *  ever exposes name/city/status-dot (already effectively public via the
 *  Peta view), never another kitchen's alerts/production/CCTV detail. */
function nearestSppgTo(sppg, n) {
  return SPPG_DATA.filter((s) => s.id !== sppg.id)
    .map((s) => ({ s, d: (s.lat - sppg.lat) ** 2 + (s.lng - sppg.lng) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.s);
}

const COLLAB_KINDS = [
  { kind: "Bahan Baku", detail: () => `${randInt(20, 80)} kg bahan baku cadangan` },
  { kind: "Tenaga Bantuan", detail: () => `${randInt(1, 3)} orang tenaga bantu untuk shift hari ini` },
  { kind: "Kendaraan Distribusi", detail: () => `pinjaman 1 unit kendaraan distribusi` },
];
let collabSeq = 1;
const DAPUR_COLLAB_LOG = []; // { id, fromId, fromName, toId, toName, kind, detail, status, time }
function requestDapurCollab(fromSppg, toSppg, kindOverride) {
  const k = (kindOverride && COLLAB_KINDS.find((c) => c.kind === kindOverride)) || pick(COLLAB_KINDS);
  const rec = {
    id: `COLLAB-${String(collabSeq++).padStart(4, "0")}`,
    fromId: fromSppg.id, fromName: fromSppg.name,
    toId: toSppg.id, toName: toSppg.name,
    kind: k.kind, detail: k.detail(),
    status: "PENDING",
    time: "Baru saja",
    createdAt: Date.now(),
  };
  DAPUR_COLLAB_LOG.unshift(rec);
  while (DAPUR_COLLAB_LOG.length > 40) DAPUR_COLLAB_LOG.pop();
  return rec;
}
/** resolveDapurCollab() — used when the OUTGOING side's request auto-settles
 *  after a short delay (simulating the other kitchen's own response). */
function resolveDapurCollab(rec) {
  rec.status = Math.random() < 0.75 ? "DISETUJUI" : "TIDAK BISA MEMBANTU";
  rec.time = "Baru saja";
  return rec;
}
/** respondDapurCollab() — used when MY kitchen is the recipient of an
 *  incoming request and the user taps Setujui/Tolak themselves. */
function respondDapurCollab(rec, approve) {
  rec.status = approve ? "DISETUJUI" : "DITOLAK";
  rec.time = "Baru saja";
  return rec;
}
/** simulateIncomingCollabRequest() — a nearby kitchen asks MINE for help;
 *  used by the automatic dapur tick and the dapur testing panel. */
function simulateIncomingCollabRequest(mySppg) {
  const others = nearestSppgTo(mySppg, 5);
  if (!others.length) return null;
  return requestDapurCollab(pick(others), mySppg);
}

const ALERT_STATUS_FLOW = ["OPEN", "ASSIGNED", "VERIFYING", "RESOLVED"];
function progressRandomAlert() {
  const open = ALERTS.filter((a) => a.status !== "RESOLVED");
  if (!open.length) return null;
  const a = pick(open);
  const idx = ALERT_STATUS_FLOW.indexOf(a.status);
  a.status = ALERT_STATUS_FLOW[Math.min(idx + 1, ALERT_STATUS_FLOW.length - 1)];
  return a;
}

/* =========================================================================
   AUDITS — total dibuat konsisten dengan angka ringkasan modul Audit.
   ========================================================================= */
function buildAudits() {
  const total = 496, completed = 436, followUp = 48, critical = 12;
  const categories = ["Kebersihan", "Operasional", "Keamanan Pangan", "Kepatuhan SOP"];
  const officers = ["Petugas A", "Petugas B", "Petugas C", "Petugas D"];
  const audits = [];
  for (let i = 0; i < total; i++) {
    const sppg = SPPG_DATA[i % SPPG_DATA.length];
    let status, score;
    if (i < critical) { status = "Critical"; score = randInt(30, 54); }
    else if (i < critical + followUp) { status = "Follow Up"; score = randInt(55, 74); }
    else { status = "Completed"; score = randInt(75, 99); }
    audits.push({
      id: `AUD-${String(i + 1).padStart(4, "0")}`,
      date: `0${randInt(1, 9)} Sep 2026`,
      sppgId: sppg.id,
      sppgName: sppg.name,
      officer: pick(officers),
      category: pick(categories),
      score,
      findings: status === "Completed" ? "Tidak ada temuan signifikan." : "Ditemukan indikasi ketidaksesuaian SOP.",
      notes: "",
      status,
    });
  }
  return { audits, summary: { total, completed, followUp, critical } };
}
const AUDIT_DATA = buildAudits();
const AUDITS = AUDIT_DATA.audits;
const AUDIT_SUMMARY = AUDIT_DATA.summary;

/* =========================================================================
   DAILY REPORT — dihitung LANGSUNG dari 300 SPPG demo, bukan angka statis,
   supaya "Modul Laporan" benar-benar merefleksikan dataset.
   ========================================================================= */
function buildDailyReport() {
  const counts = { normal: 0, monitoring: 0, warning: 0, critical: 0, offline: 0 };
  SPPG_DATA.forEach((s) => counts[s.status]++);
  const cctvIncidents = SPPG_DATA.filter((s) => s.cctv.status === "offline").length;
  const distributionDelays = SPPG_DATA.filter((s) => s.distribution.delayed > 0).length;
  const sensorWarnings = SPPG_DATA.filter((s) => s.sensors.temperature > 8 || s.sensors.freezer > -14).length;
  return {
    date: "08 September 2026",
    monitored: SPPG_DATA.length,
    normal: counts.normal,
    monitoring: counts.monitoring,
    warning: counts.warning,
    critical: counts.critical,
    offline: counts.offline,
    cctvIncidents,
    distributionDelays,
    sensorWarnings,
  };
}
const DAILY_REPORT = buildDailyReport();

/* =========================================================================
   PRODUCTION WEEK (aggregate demo dataset trend, for chart) & ACTIVITIES
   ========================================================================= */
const PRODUCTION_WEEK = [
  { day: "Sen", target: 2200, produksi: 2150, distribusi: 2130 },
  { day: "Sel", target: 2200, produksi: 2180, distribusi: 2160 },
  { day: "Rab", target: 2200, produksi: 2090, distribusi: 2040 },
  { day: "Kam", target: 2200, produksi: 2205, distribusi: 2190 },
  { day: "Jum", target: 2200, produksi: 2140, distribusi: 2100 },
  { day: "Sab", target: 1800, produksi: 1760, distribusi: 1740 },
  { day: "Min", target: 1500, produksi: 1470, distribusi: 1455 },
];

const ACTIVITIES = [
  { time: "08:31", sppg: FEATURED.bogor.name, text: "Production Started" },
  { time: "08:24", sppg: FEATURED.depok.name, text: "Distribution Started" },
  { time: "08:12", sppg: FEATURED.bandung.name, text: "Temperature Warning" },
  { time: "07:58", sppg: FEATURED.jakarta.name, text: "CCTV Reconnected" },
  { time: "07:40", sppg: SPPG_DATA[10].name, text: "Audit Completed" },
  { time: "07:22", sppg: SPPG_DATA[14].name, text: "Packing Started" },
  { time: "07:05", sppg: SPPG_DATA[21].name, text: "Distribution Completed" },
  { time: "06:47", sppg: SPPG_DATA[33].name, text: "Sensor Suhu Normal Kembali" },
  { time: "06:30", sppg: SPPG_DATA[42].name, text: "Production Target Tercapai" },
  { time: "06:15", sppg: SPPG_DATA[5].name, text: "Petugas Check-in" },
  { time: "06:02", sppg: SPPG_DATA[58].name, text: "Kendaraan Distribusi Berangkat" },
  { time: "05:54", sppg: SPPG_DATA[77].name, text: "QC Sampel Lolos" },
  { time: "05:41", sppg: SPPG_DATA[93].name, text: "Stok Bahan Baku Diterima" },
  { time: "05:33", sppg: SPPG_DATA[112].name, text: "Production Started" },
  { time: "05:20", sppg: SPPG_DATA[136].name, text: "Petugas Check-in" },
  { time: "05:09", sppg: SPPG_DATA[151].name, text: "CCTV Reconnected" },
  { time: "04:58", sppg: SPPG_DATA[174].name, text: "Audit Completed" },
  { time: "04:47", sppg: SPPG_DATA[199].name, text: "Distribution Started" },
];

/* -------------------------------------------------------------------------
   LIVE ACTIVITY TICKER — feeds renderActivity()/renderOps() with a rotating
   pool of plausible events so the Overview feels like it's actually being
   watched in real time, not a static screenshot. Purely client-side /
   cosmetic: no data leaves the browser and nothing here touches ALERTS or
   SPPG_DATA (the actual risk engine stays deterministic).
   ------------------------------------------------------------------------- */
const LIVE_EVENT_POOL = [
  "Production Started", "Packing Started", "Distribution Started",
  "Distribution Completed", "CCTV Reconnected", "Audit Completed",
  "Sensor Suhu Normal Kembali", "Production Target Tercapai",
  "Petugas Check-in", "Kendaraan Distribusi Berangkat", "QC Sampel Lolos",
  "Stok Bahan Baku Diterima", "Kendaraan Distribusi Tiba", "Serah Terima Selesai",
  "Checklist Kebersihan Selesai", "Petugas Check-out", "Sampel Menu Diarsipkan",
  "Laporan Harian Dikirim", "Freezer Kembali Normal", "Koneksi Internet Pulih",
];
function nowClock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function pushLiveActivity() {
  const sppg = pick(SPPG_DATA);
  ACTIVITIES.unshift({ time: nowClock(), sppg: sppg.name, text: pick(LIVE_EVENT_POOL) });
  if (ACTIVITIES.length > 12) ACTIVITIES.length = 12;
}

/* =========================================================================
   FUTURE BACKEND — placeholder functions only. Tidak benar-benar memanggil
   API apa pun pada prototype ini.
   ========================================================================= */
// FUTURE API INTEGRATION
async function fetchSPPGData() { return SPPG_DATA; }
// FUTURE API INTEGRATION
async function fetchAlerts() { return ALERTS; }
// FUTURE API INTEGRATION
async function fetchAuditData() { return AUDITS; }
// FUTURE API INTEGRATION
async function fetchSensorData(sppgId) { return SPPG_DATA.find((s) => s.id === sppgId)?.sensors || null; }
// FUTURE API INTEGRATION
async function connectCCTV(sppgId) { return null; }
