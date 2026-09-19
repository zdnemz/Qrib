# DESIGN.md - Source of Truth Desain Qrib

Berlaku untuk: web (Next.js), mobile (Expo), extension (Chrome MV3).
Skill acuan: Anti-Slop Frontend. Aturan estetika skill hanya mengikat
permukaan landing/marketing; alur produk (dompet, pindai, bayar) ikut
token dan lock di bawah, bukan trik visualnya.

## Design Read

Premium-consumer fintech marketing + wallet product UI untuk pembayar QRIS
Indonesia, dengan bahasa premium yang bersih, berbasis Tailwind utilities +
Geist + Motion.

## Dials

DESIGN_VARIANCE 7 / MOTION_INTENSITY 7 / VISUAL_DENSITY 3.
Premium berarti lapang dan berani: seksi jarang (py-16/24), tipe display
besar, foto asli per halaman, motion beralasan per elemen (Reveal, Magnetic,
Tilt, Template, semua statis di prefers-reduced-motion). Tanpa scroll-hijack,
tanpa marquee, tanpa loop.

## Fondasi

- Font: Geist (sans) + Geist Mono (angka, payload, ID). Tanpa serif display.
- Ikon: Phosphor duotone di permukaan marketing saja; produk tetap tipografi.
- Foto: picsum seed per penempatan (ganti foto brand bila ada).
- Tema: satu sistem auto (light + `dark:`), ikut `prefers-color-scheme`.
- Basis: putih / zinc-950. Teks: zinc-900 / zinc-100. Muted: zinc-600 / zinc-400.
- Satu aksen: emerald. Tombol: emerald-700 di light, emerald-400 di dark.
- Bentuk: tombol pill penuh, kartu 16px. Tidak ada sudut lain.
- Foto: tidak ada foto stok. Visual hero = preview komponen asli
  (kartu struk), bukan screenshot palsu dari div.

## Lock (tidak boleh dilanggar diam-diam)

- Satu aksen di semua permukaan. Tidak ada label CTA ganda untuk maksud sama.
- Label CTA baku: "Pindai QR" (bayar), "Lihat riwayat" (riwayat),
  "Cek saldo" (dompet), "Salin" (terima), "Jelajahi fitur" (fitur).
- Bahasa: Indonesia. Tanpa em-dash di teks terlihat.
- Angka harus dari data asli (engine config) atau berlabel contoh.
- Hero: maks 2 baris headline, sub maks 20 kata, CTA terlihat tanpa scroll,
  padding atas maks pt-24, maks 4 elemen teks, tanpa eyebrow bertumpuk.
- Eyebrow: maks 1 per 3 section. Landing saat ini: 0.
- Status pembayaran berbahasa Indonesia via `statusId` (web/lib/api.ts).

## Web (qrib-web, :3100)

Rute grup transparan: `(marketing)` untuk pemasaran, `(app)` untuk produk.
URL tidak berubah.

- `/`: hero split premium (copy + foto + struk contoh), Cara kerja (1 lebar + 2),
  pita foto merchant, Batas yang jelas (angka engine asli), CTA penutup.
- `/fitur`: bento 2x2 berikon, split foto + kunci, CTA.
- `/biaya`: kartu per spesifikasi (angka cermin `src/engine/config.ts`),
  batas harian, CTA.
- `/keamanan`: split foto, 4 prinsip, CTA ke FAQ.
- `/faq`: akordeon native per kelompok, CTA.
- `/scan`: kamera (getUserMedia + jsQR, fallback tempel payload),
  nominal bila statis, quote dengan countdown hidup, Bayar
  (authorize lalu execute), Perbarui status, Batalkan, jejak attempts.
- `/history`: server-rendered, empty state mengarah ke /scan, tiap tile
  taut ke `/history/[id]`.
- `/history/[id]`: struk (nominal, status, quote, jejak attempts).
- `/wallet`: buat/impor (PBKDF2, envelope sama dengan CLI),
  buka/kunci, kirim USDC dari perangkat, saldo, receive URI + QR + salin.
  Kunci mentah tidak pernah keluar dari memori.
- Token bersama di `web/lib/ui.ts` (satu aksen emerald, pill, kartu 16px).

## Mobile (qrib-mobile, Expo SDK 57)

Mengikut token yang sama: Geist diganti font sistem (ponen: tanpa unduh font
di native), aksen emerald, kartu 16px, tombol pill, status via peta yang
sama dengan `statusId`. Layar: Dompet, Pindai, Riwayat. Tab bawah mengikuti
urutan itu.

## Extension (qrib-extension, MV3)

Popup 280px: judul, satu kalimat, satu tombol "Buka Web" (:3100).
Background service worker hanya untuk lifecycle. Tanpa permission baru
tanpa alasan tercatat di sini.

## Verifikasi sebelum klaim selesai

- `tsc` dan `build` tiap permukaan yang diubah.
- E2E alur uang bila DB tersedia: parse, quote, authorize, execute.
- Audit copy: baca ulang semua string terlihat, tanpa angka palsu,
  tanpa em-dash, tanpa label ganda.

## Ditunda (tambah bila diukur butuh)

foto brand pengganti picsum, lib animasi selain Motion.
