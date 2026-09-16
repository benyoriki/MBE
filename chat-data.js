/* =========================================================================
   MBG WATCH v2 — chat-data.js
   -------------------------------------------------------------------------
   SELURUH ISI PESAN DI FILE INI ADALAH DATA DUMMY / SIMULASI, dibuat untuk
   menguji tampilan & performa fitur "Chat & Pesan" (grup chat gaya WhatsApp
   antara tiap Dapur/SPPG dan Pusat Audit Nasional). Tidak ada pesan
   sungguhan, tidak ada nomor telepon nyata, dan tidak terhubung ke sistem
   perpesanan apa pun.

   Struktur:
   - CHAT_THREAD_SUMMARIES : daftar ringkas 1 baris per SPPG untuk panel
     daftar chat (nama grup, pratinjau pesan terakhir, badge belum dibaca).
     Dihitung sekali secara deterministik (seeded), jadi ringan di memori.
   - generateChatMessages(sppg) : menghasilkan (dan meng-cache) isi
     percakapan lengkap untuk SATU dapur, hanya saat thread-nya dibuka.
     Dapur unggulan (SPPG Bogor, akun demo login) memakai skrip percakapan
     "Alis & Nyat" yang ditulis tangan untuk mendemokan seluruh elemen UI
     chat (foto, status terkirim/dibaca, pesan sistem, tes performa).
     Dapur lain memakai generator prosedural yang tetap kontekstual
     terhadap data SPPG tsb (keterlambatan distribusi, CCTV offline, dst).
   ========================================================================= */

/* ---------------- Nama auditor pusat (rotasi per dapur, seeded) -------- */
const CHAT_AUDITOR_POOL = [
  "Nyat Pramudya", "Sari Handayani", "Dimas Kurniawan", "Retno Wulandari",
  "Farhan Ardiansyah", "Intan Permatasari",
];

function chatSeed(sppgId, salt) {
  const base = sppgId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return base * 131 + (salt || 0) + 7;
}

function chatInitials(name) {
  return String(name || "??").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

/* Kepala Dapur & Ahli Gizi tiap SPPG diambil dari buildDapurProfile (data.js)
   supaya nama di chat konsisten dengan halaman "Struktur & Tim" dapur
   tsb. SPPG unggulan (Bogor) memakai nama tetap "Alis" & auditor "Nyat"
   sesuai skenario demo yang diminta. */
function chatParticipants(sppg) {
  if (sppg.id === FEATURED.bogor.id) {
    return { kepala: "Alis Purnama", ahliGizi: "Sari Nirmala", auditor: "Nyat Pramudya" };
  }
  const profile = buildDapurProfile(sppg);
  const kepalaStaff = profile.staff.find((s) => s.role === "Kepala Dapur") || profile.staff[0];
  const giziStaff = profile.staff.find((s) => s.role === "Ahli Gizi");
  const r = seededRandom(chatSeed(sppg.id, 3));
  const auditor = CHAT_AUDITOR_POOL[Math.floor(r() * CHAT_AUDITOR_POOL.length)];
  return { kepala: kepalaStaff.name, ahliGizi: giziStaff ? giziStaff.name : null, auditor };
}

function chatRelativeTime(minutesAgo) {
  if (minutesAgo < 1) return "Baru saja";
  if (minutesAgo < 60) return `${minutesAgo}m`;
  if (minutesAgo < 1440) return `${Math.floor(minutesAgo / 60)}j`;
  return `${Math.floor(minutesAgo / 1440)}h`;
}

/* ---------------- Ringkasan daftar chat (1 per SPPG) -------------------- */
function buildChatSummary(sppg) {
  const r = seededRandom(chatSeed(sppg.id, 1));
  const { kepala } = chatParticipants(sppg);
  const isAlert = sppg.status === "warning" || sppg.status === "critical" || sppg.status === "offline";

  let lastMessage;
  if (sppg.id === FEATURED.bogor.id) {
    lastMessage = "Nyat: Siap, laporan sudah kami terima. Terima kasih Alis 🙏";
  } else if (sppg.cctv.status === "offline") {
    lastMessage = `${kepala}: CCTV sempat offline ${sppg.cctv.offlineMinutes} menit, sudah nyala lagi.`;
  } else if (sppg.distribution.delayed > 0) {
    lastMessage = `${kepala}: Mohon info, ${sppg.distribution.delayed} titik distribusi agak telat.`;
  } else if (sppg.audit.lastScore < 70) {
    lastMessage = `Pusat: Mohon tindak lanjuti catatan audit tanggal ${sppg.audit.lastDate} ya.`;
  } else if (sppg.production.completion >= 99) {
    lastMessage = `${kepala}: Produksi hari ini selesai 100%, siap distribusi ✅`;
  } else {
    lastMessage = `${kepala}: Laporan pagi sudah dikirim, mohon dicek Bu/Pak 🙏`;
  }

  const minutesAgo = isAlert ? Math.floor(r() * 90) : Math.floor(r() * 600) + 10;
  const unread = r() < (isAlert ? 0.55 : 0.2) ? Math.floor(1 + r() * 4) : 0;

  return {
    sppgId: sppg.id,
    name: sppg.name,
    province: sppg.province,
    city: sppg.city,
    kepala,
    avatar: chatInitials(kepala),
    lastMessage,
    minutesAgo,
    unread,
    pinned: sppg.status === "critical",
    statusDot: sppg.status,
  };
}

const CHAT_THREAD_SUMMARIES = SPPG_DATA.map(buildChatSummary);
function chatSummaryFor(sppgId) { return CHAT_THREAD_SUMMARIES.find((c) => c.sppgId === sppgId); }

/* ---------------- Skrip percakapan unggulan: Alis & Nyat ---------------
   Dipakai untuk SPPG Bogor (akun demo "Kepala Dapur" saat login). Ditulis
   lengkap agar bisa dipakai menguji seluruh elemen UI chat: pesan sistem,
   pemisah tanggal, foto/lampiran (disimulasikan sebagai teks), status
   terkirim/dibaca, dan momen "tes performa grup chat" itu sendiri. */
function buildFlagshipScript(sppg) {
  const d = "Hari ini";
  let i = 0;
  const m = (from, name, text, time, status) => ({ id: `flag-${++i}`, from, name, text, time, status: status || "read", day: d });
  const sys = (text) => ({ id: `flag-${++i}`, from: "system", text, day: d });

  return [
    sys("Grup \u201cSPPG Bogor 301 ⇄ Pusat Audit\u201d dibuat oleh Admin Pusat"),
    sys("Nyat Pramudya (Petugas Audit Pusat) ditambahkan ke grup"),
    m("dapur", "Alis Purnama", "Selamat pagi Pak/Bu, izin lapor: produksi pagi ini sudah mulai pukul 05:10, sesuai jadwal 🙏", "05:12"),
    m("admin", "Nyat Pramudya", "Pagi Alis, siap diterima. Ditunggu update setelah packing ya.", "05:14", "read"),
    m("dapur", "Alis Purnama", `Packing selesai pukul ${sppg.operations.packingStarted}, total ${sppg.production.produced} porsi dari target ${sppg.production.target}.`, "08:22"),
    m("dapur", "Alis Purnama", "[Foto] dokumentasi hasil packing & suhu makanan sebelum dikirim.jpg", "08:23"),
    m("admin", "Nyat Pramudya", "Diterima, foto sudah kami simpan untuk arsip audit. Suhu terlihat aman di kisaran normal.", "08:26", "read"),
    m("dapur", "Alis Purnama", `Distribusi mulai jalan pukul ${sppg.operations.distributionStarted} ke seluruh titik sekolah.`, "08:31"),
    sys("Sari Nirmala (Ahli Gizi) ditambahkan ke grup"),
    m("dapur", "Sari Nirmala", "Menambahkan info gizi: menu hari ini sudah sesuai standar AKG untuk anak sekolah, protein 22g per porsi.", "08:40"),
    m("admin", "Nyat Pramudya", "Terima kasih Sari, tercatat. Alis, boleh minta tolong satu hal dulu ya, Nyat mau tes performa grup chat ini sebentar 🙏", "09:02", "read"),
    m("dapur", "Alis Purnama", "Baik siap Nyat, silakan.", "09:02"),
    m("admin", "Nyat Pramudya", "Tes kirim pesan ke grup dapur ya, mau cek apakah pesan masuk realtime dan urutannya rapi.", "09:03", "read"),
    m("dapur", "Alis Purnama", "Diterima dengan baik Nyat, pesan masuk langsung, urutan waktu juga rapi di layar kami 👍", "09:03"),
    m("admin", "Nyat Pramudya", "Mantap, berarti chat grup dapur ke dashboard audit sudah lancar. Nanti fitur ini dipakai buat semua 300 dapur simulasi ya.", "09:04", "read"),
    m("dapur", "Alis Purnama", "Siap Nyat, kami tunggu info selanjutnya 🙏", "09:04"),
    sys("Kemarin"),
    m("dapur", "Alis Purnama", "Malam Pak/Bu, izin lapor ada kendala kecil: 1 titik distribusi telat 12 menit karena hujan deras di jalan.", "16:45"),
    m("admin", "Nyat Pramudya", "Baik, dicatat sebagai kendala cuaca — tidak masuk pelanggaran. Mohon konfirmasi begitu makanan sudah sampai ya.", "16:50", "read"),
    m("dapur", "Alis Purnama", "Sudah sampai semua pukul 12:52, diterima baik oleh pihak sekolah. Terlampir tanda terima.", "17:05"),
    m("dapur", "Alis Purnama", "[Dokumen] tanda-terima-distribusi-bogor301.pdf", "17:05"),
    m("admin", "Nyat Pramudya", "Siap, laporan sudah kami terima. Terima kasih Alis 🙏", "17:10", "read"),
    sys(d),
    m("admin", "Nyat Pramudya", "Alis, pengingat: jadwal audit rutin berikutnya untuk SPPG Bogor 301 minggu depan. Mohon siapkan dokumen produksi & distribusi 2 minggu terakhir.", "07:15", "delivered"),
    m("dapur", "Alis Purnama", "Baik Nyat, akan kami siapkan dari sekarang supaya tidak terburu-buru nanti.", "07:20"),
  ];
}

/* ---------------- Generator prosedural untuk 299 dapur lainnya --------- */
const CHAT_AUTO_REPLIES_TO_ADMIN = [
  "Baik, diterima dengan baik. Terima kasih infonya 🙏",
  "Siap, akan segera kami tindak lanjuti.",
  "Noted, akan kami koordinasikan dengan tim di dapur.",
  "Terima kasih Bu/Pak, sudah kami catat.",
  "Siap laksanakan, mohon doanya lancar terus 🙏",
];
const CHAT_AUTO_REPLIES_TO_DAPUR = [
  "Diterima, terima kasih laporannya. Sudah kami catat di sistem.",
  "Baik, tetap semangat ya, lanjutkan kerja baiknya 👍",
  "Noted, akan kami tindak lanjuti dari sisi pusat.",
  "Terima kasih atas updatenya, sangat membantu monitoring kami.",
  "Siap, kami tandai selesai di dashboard audit.",
];

function buildProceduralScript(sppg) {
  const r = seededRandom(chatSeed(sppg.id, 5));
  const { kepala, auditor } = chatParticipants(sppg);
  const d = "Hari ini";
  let i = 0;
  const m = (from, name, text, time, status) => ({ id: `${sppg.id}-${++i}`, from, name, text, time, status: status || (from === "admin" ? "read" : undefined), day: d });
  const sys = (text) => ({ id: `${sppg.id}-${++i}`, from: "system", text, day: d });

  const msgs = [sys(`Grup "${sppg.name} ⇄ Pusat Audit" dibuat oleh Admin Pusat`)];

  msgs.push(m("dapur", kepala, `Selamat pagi, izin lapor produksi hari ini: ${sppg.production.produced}/${sppg.production.target} porsi (${sppg.production.completion}%) telah selesai.`, "06:5" + Math.floor(r() * 9)));
  msgs.push(m("admin", auditor, pick(CHAT_AUTO_REPLIES_TO_DAPUR), "07:0" + Math.floor(r() * 9), "read"));

  if (sppg.cctv.status === "offline") {
    msgs.push(m("dapur", kepala, `Izin info, CCTV dapur sempat offline sekitar ${sppg.cctv.offlineMinutes} menit tadi, saat ini sudah menyala kembali.`, "09:1" + Math.floor(r() * 9)));
    msgs.push(m("admin", auditor, "Baik, kami cek log CCTV-nya dari pusat. Mohon pastikan tidak terulang ya.", "09:2" + Math.floor(r() * 9), "read"));
  }

  if (sppg.distribution.delayed > 0) {
    msgs.push(m("dapur", kepala, `Mohon info, distribusi ke ${sppg.distribution.delayed} titik agak terlambat karena kendala di jalan.`, "12:0" + Math.floor(r() * 9)));
    msgs.push(m("admin", auditor, "Diterima, ditandai sebagai kendala teknis. Mohon konfirmasi begitu semua titik sudah menerima.", "12:1" + Math.floor(r() * 9), "read"));
    msgs.push(m("dapur", kepala, "Sudah selesai semua, diterima baik oleh pihak sekolah. Terima kasih.", "13:0" + Math.floor(r() * 9)));
  } else {
    msgs.push(m("dapur", kepala, "Distribusi ke seluruh titik sudah selesai tepat waktu, diterima baik oleh sekolah ✅", "12:2" + Math.floor(r() * 9)));
  }

  if (sppg.sensors.temperature > 7.5) {
    msgs.push(m("dapur", kepala, `Izin lapor, sensor suhu penyimpanan sempat menunjukkan ${sppg.sensors.temperature}°C, sudah kami cek ulang dan stabilkan.`, "13:4" + Math.floor(r() * 9)));
    msgs.push(m("admin", auditor, "Baik, mohon terus dipantau. Jika berulang mohon segera hubungi tim teknis pusat.", "13:5" + Math.floor(r() * 9), "read"));
  }

  if (sppg.audit.lastScore < 70) {
    msgs.push(m("admin", auditor, `Mengingatkan, skor audit terakhir (${sppg.audit.lastScore}) di tanggal ${sppg.audit.lastDate} masih perlu tindak lanjut. Mohon perbaikannya disiapkan.`, "15:0" + Math.floor(r() * 9), "delivered"));
    msgs.push(m("dapur", kepala, pick(CHAT_AUTO_REPLIES_TO_ADMIN), "15:2" + Math.floor(r() * 9)));
  } else if (r() < 0.5) {
    msgs.push(m("admin", auditor, "Pengingat jadwal audit rutin bulan ini, mohon siapkan dokumen produksi & distribusi ya.", "15:1" + Math.floor(r() * 9), "delivered"));
    msgs.push(m("dapur", kepala, "Siap, akan kami siapkan dari sekarang 🙏", "15:2" + Math.floor(r() * 9)));
  }

  return msgs;
}

/* ---------------- Cache pesan per dapur (dibangkitkan saat dibuka saja) */
const CHAT_MESSAGE_CACHE = new Map();
function generateChatMessages(sppg) {
  if (CHAT_MESSAGE_CACHE.has(sppg.id)) return CHAT_MESSAGE_CACHE.get(sppg.id);
  const msgs = sppg.id === FEATURED.bogor.id ? buildFlagshipScript(sppg) : buildProceduralScript(sppg);
  CHAT_MESSAGE_CACHE.set(sppg.id, msgs);
  return msgs;
}

function chatAutoReply(sppg, repliedToAdmin) {
  const { kepala, auditor } = chatParticipants(sppg);
  const now = new Date();
  const time = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (repliedToAdmin) {
    return { id: `${sppg.id}-auto-${Date.now()}`, from: "dapur", name: kepala, text: pick(CHAT_AUTO_REPLIES_TO_ADMIN), time, day: "Hari ini" };
  }
  return { id: `${sppg.id}-auto-${Date.now()}`, from: "admin", name: auditor, text: pick(CHAT_AUTO_REPLIES_TO_DAPUR), time, status: "read", day: "Hari ini" };
}
