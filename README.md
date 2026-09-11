# MBG WATCH v2 — Integrated Monitoring & Early Warning System

**Status: PROTOTYPE / DEMO — DATA SIMULASI.**
Ini **bukan** situs resmi pemerintah atau BGN. Tidak ada logo resmi pemerintah yang digunakan. Seluruh SPPG, CCTV, sensor, alert, audit, dan statistik nasional pada situs ini adalah **data dummy** yang dibangkitkan secara deterministik di sisi browser.

## 1. Konsep

MBG WATCH mensimulasikan tampilan sebuah **National Monitoring Command Center**: dashboard yang memantau operasional dapur/SPPG program Makan Bergizi Gratis (MBG) — mulai dari CCTV, produksi, distribusi, sensor IoT, hingga audit dan early warning.

## 2. Fitur Utama

- **Operational Summary** dengan badge "SIMULASI NASIONAL" (27.381 SPPG simulasi) terpisah dari **Data Demo** (75 SPPG yang benar-benar dimuat di browser).
- **Critical Alert Strip** — elemen paling menonjol saat ada alert critical.
- **Peta SPPG** — SVG ringan, mendukung zoom (scroll/tombol), pan (drag), search, filter status & provinsi, hover tooltip, klik → popup → detail.
- **SPPG Memerlukan Perhatian** — diurutkan dari Risk Score terendah.
- **Risk Center** — Risk Score dihitung dari 5 komponen (CCTV, Produksi, Distribusi, Sensor, Audit — masing-masing 20 poin, total 100) lewat fungsi `calculateRiskScore()`. **Semakin tinggi skor = semakin sehat.**
- **Status SPPG** diturunkan dari kondisi nyata (bukan angka acak) lewat `deriveSPPGStatus()` — kombinasi beberapa indikator buruk sekaligus dapat memaksa status menjadi CRITICAL/OFFLINE.
- **Early Warning System** dengan workflow nyata: `OPEN → ASSIGNED → VERIFYING → RESOLVED`, disimpan di `localStorage`.
- **CCTV Simulator** — tampilan ala monitoring station (noise, scanline, timestamp, REC/LIVE indicator) tanpa video sungguhan, digerakkan oleh **satu** ticker global (bukan `setInterval` baru setiap render).
- **Audit & Inspeksi** dengan modal detail + tombol "Mark as Follow Up".
- **Laporan** — Daily Operation Report dihitung langsung dari dataset 75 SPPG demo + tombol **Export CSV** (memakai `Blob`, tanpa backend).
- **Analitik** — status breakdown, CCTV uptime, completion produksi/distribusi, alert by category.
- **Mobile-first**: bottom navigation, peta ringkas (40–55vh), filter horizontal-scroll, layout khusus (bukan sekadar mengecilkan desktop).
- **Dark & Light mode**, keduanya didesain penuh (bukan sekadar ganti warna latar).

## 3. Dua Dashboard Terpisah

MBG WATCH v3 memisahkan total pengalaman berdasarkan peran:

- **Tim Admin & Audit Nasional** → dashboard **National Command Center** penuh (peta seluruh Indonesia, Early Warning, Risk Center, Audit, Laporan, Analitik lintas SPPG) — persis seperti sebelumnya.
- **Akun Dapur (SPPG)** → dashboard **terpisah**, hanya berisi data dapur mereka sendiri: Ringkasan, **Struktur & Anggota Tim** (org chart + tabel staf dengan status kehadiran), **Jadwal Menu Mingguan**, Produksi & Distribusi, CCTV, Sensor, dan Audit — semua di-scope ke satu SPPG. Sidebar, bottom nav, dan topbar otomatis berganti total sesuai peran; akun dapur tidak pernah melihat data SPPG lain.

## 4. Peta Indonesia

Siluet peta sekarang di-trace dari referensi outline Indonesia sungguhan (bukan lagi bentuk oval abstrak), disederhanakan jadi satu `<path>` SVG ringan (~25 sub-path, tanpa library peta apa pun) sehingga tetap cepat dimuat di HP maupun PC.

## 5. Alur Masuk (Splash → Login → Dashboard)

Saat dibuka, situs menampilkan **splash screen** animasi (radar sweep + logo bercahaya) selama beberapa detik, lalu masuk ke **Login Gate** dengan dua peran:

- **Tim Admin & Audit Nasional** — akses penuh ke seluruh modul.
- **Akun Dapur (SPPG)** — akses yang sama, ditambah menu pintasan **"Dapur Saya"** di sidebar yang langsung membuka profil SPPG milik akun tersebut.

Login ini **100% simulasi** — tidak ada validasi kredensial sungguhan, tidak ada backend, dan tidak ada password yang disimpan. Sesi (peran + nama) disimpan di `sessionStorage` (bukan `localStorage`) agar otomatis berakhir saat tab ditutup, dan bisa diakhiri kapan saja lewat tombol **Keluar (Logout)** di halaman Pengaturan atau dengan mengklik chip profil di topbar.

## 4. Palet Warna

Palet disesuaikan menjadi **navy + gold** bernuansa institusional (terinspirasi kesan formal sebuah command center pemerintah), **tanpa mereproduksi artwork lambang/seal resmi apa pun**. Warna status (hijau/cyan/oranye/merah/abu-abu untuk Normal/Monitoring/Warning/Critical/Offline) tetap dipertahankan agar makna datanya tidak berubah — emas hanya dipakai untuk elemen "brand" (logo, navigasi aktif, tombol utama, badge simulasi).

## 5. Arsitektur Data (`data.js`)

Setiap SPPG punya struktur:

```js
{
  id, name, province, city, lat, lng,
  status,                 // diturunkan oleh deriveSPPGStatus()
  riskScore, riskBreakdown, // dihasilkan oleh calculateRiskScore()
  cctv: { status, camerasOnline, camerasTotal, offlineMinutes, lastSeen },
  production: { target, produced, completion },
  distribution: { target, delivered, delayed, completion },
  sensors: { temperature, humidity, freezer, power, internet, door, history },
  operations: { productionStarted, packingStarted, distributionStarted },
  audit: { lastScore, lastDate }
}
```

Alur logis yang dijaga di seluruh kode:

```
CCTV → Operational Data → Risk Score → Alert → Verification → Audit → Resolution
```

`ALERTS` dibangkitkan otomatis dari kondisi tiap SPPG (`buildAlerts()`), bukan daftar statis. `AUDITS` dan `DAILY_REPORT` juga dihitung/disinkronkan dari dataset yang sama.

## 4. LocalStorage

Kunci yang dipakai (lihat `STORAGE_KEYS` di `app.js`):

| Key | Isi |
|---|---|
| `mbgwatch:theme` | dark/light |
| `mbgwatch:filters` | filter peta terakhir |
| `mbgwatch:favorites` | daftar ID SPPG favorit |
| `mbgwatch:lastVisited` | 5 SPPG terakhir dibuka |
| `mbgwatch:alertState` | status & catatan tiap alert (workflow) |
| `mbgwatch:auditState` | status & catatan tiap audit |

Tidak ada password, token, API key, atau kredensial apa pun yang disimpan. Semua akses `localStorage` dibungkus try/catch (`storageGet`/`storageSet`).

## 5. Cara Menjalankan

Buka langsung `index.html` di browser — tidak perlu server, tidak perlu build step.

## 6. Cara Upload ke GitHub Pages

1. Buat repository baru di GitHub.
2. Upload seluruh isi folder ini (`index.html`, `style.css`, `app.js`, `data.js`, `assets/`, `README.md`).
3. Masuk ke **Settings → Pages**, pilih branch `main` dan folder `/root`.
4. Simpan — situs akan tersedia di `https://<username>.github.io/<repo>/`.

## 7. Cara Mengubah Data Dummy

Semua data ada di `data.js`:

- Ubah `SPPG_TOTAL_DEMO` untuk mengubah jumlah SPPG demo (disarankan 50–100 agar tetap ringan).
- Ubah `NATIONAL_SIMULATION` untuk mengubah angka agregat nasional simulasi.
- Fungsi `calculateRiskScore()` dan `deriveSPPGStatus()` bisa disesuaikan bila ingin mengubah bobot/ambang risiko.

## 8. Menghubungkan Backend / API Sungguhan (Masa Depan)

Placeholder sudah disiapkan di `data.js` (dikomentari `// FUTURE API INTEGRATION`):

```js
fetchSPPGData()
fetchAlerts()
fetchAuditData()
fetchSensorData(sppgId)
connectCCTV(sppgId)
```

Pada versi produksi, fungsi-fungsi ini tinggal diarahkan ke endpoint REST/GraphQL sungguhan, menggantikan pemanggilan `SPPG_DATA`/`ALERTS` lokal.

## 9. Menghubungkan CCTV Sungguhan (Masa Depan)

`connectCCTV(sppgId)` adalah titik integrasi untuk stream nyata (mis. HLS/WebRTC via gateway internal). Prototype ini **tidak** memuat video apa pun — tampilan CCTV murni CSS/SVG untuk mensimulasikan "monitoring station".

## 10. Identitas Visual & Kredit

Ikon MBG Watch adalah **artwork asli** (bulir gandum bergaya, melambangkan gizi/nutrisi) di atas lencana navy+gold — bukan reproduksi lambang resmi pemerintah/BGN mana pun. Peta Indonesia memakai gradasi warna + drop-shadow SVG ringan untuk kesan lebih dimensional tanpa menambah bobot halaman. Dialog konfirmasi (logout, dsb.) memakai modal bergaya sendiri, bukan `confirm()` bawaan browser.

Footer & halaman login mencantumkan keterangan bahwa situs ini murni simulasi/prototype dan saran untuk pemerintah, dikembangkan oleh [benyoriki.com](https://benyoriki.com/).

## 11. Catatan Keamanan

- Tidak ada API key, password, token, atau kredensial di source code.
- Tidak ada pemanggilan API eksternal apa pun.
- Tidak menggunakan logo resmi pemerintah/BGN.
- Seluruh label "PROTOTYPE" / "DATA SIMULASI" wajib tetap ditampilkan pada setiap deployment turunan proyek ini.

## 12. Teknologi

HTML5, CSS3, Vanilla JavaScript ES6+. Tanpa framework, tanpa build step, tanpa dependency eksternal (kecuali Google Fonts untuk tipografi). Kompatibel dengan GitHub Pages sebagai static site murni.
