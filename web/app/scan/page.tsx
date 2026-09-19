"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseQris, type QrisParse } from "../../lib/api";

export const SCAN_KEY = "qw.scan";

/** Human-readable reason from a getUserMedia rejection, for on-screen display. */
function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError") {
    return "Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser, lalu muat ulang.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Tidak ada kamera yang cocok ditemukan. Coba tempel payload manual di bawah.";
  }
  if (name === "NotReadableError") {
    return "Kamera sedang dipakai aplikasi lain (atau gagal dibuka oleh sistem). Tutup aplikasi lain, lalu muat ulang.";
  }
  if (name === "SecurityError" || !window.isSecureContext) {
    return "Kamera butuh HTTPS. Buka halaman ini lewat alamat https://, bukan http://.";
  }
  return `Kamera gagal dibuka (${name || "penyebab tidak diketahui"}). Tempel payload manual di bawah.`;
}

export default function Scan() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  // Prevents the StrictMode double-mount from racing two getUserMedia calls.
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let last = 0;

    const handlePayload = async (payload: string) => {
      try {
        const parsed: QrisParse = await parseQris(payload.trim());
        sessionStorage.setItem(SCAN_KEY, JSON.stringify({ ...parsed, payload: payload.trim() }));
        router.push("/confirm");
      } catch (err) {
        setError(err instanceof Error ? err.message : "QR tidak terbaca");
      }
    };

    const tick = (t: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (t - last < 150) return; // ~7 fps: enough for a QR, easier on the battery
      last = t;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      if (found?.data) {
        cancelled = true; // one successful decode is enough
        void handlePayload(found.data);
      }
    };

    (async () => {
      // StrictMode mounts effects twice in dev. A second concurrent
      // getUserMedia on the same device is what makes mobile browsers throw;
      // let the first mount own the camera and skip the duplicate.
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Browser ini tidak mendukung akses kamera. Tempel payload manual di bawah.");
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        raf = requestAnimationFrame(tick);
      } catch (err) {
        // Surfacing the real reason beats a generic message: permission,
        // https, and device-in-use are fixed in completely different ways.
        console.error("getUserMedia failed:", err);
        setError(cameraError(err));
      } finally {
        startingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManual = async () => {
    setError(null);
    try {
      const parsed = await parseQris(manual.trim());
      sessionStorage.setItem(SCAN_KEY, JSON.stringify({ ...parsed, payload: manual.trim() }));
      router.push("/confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payload tidak valid");
    }
  };

  return (
    <>
      <h1>Pindai QRIS</h1>
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Atau tempel payload</h2>
        <p className="muted">Untuk uji di laptop tanpa kamera.</p>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="000201010211..." />
        <button onClick={submitManual} disabled={!manual.trim()}>Lanjut</button>
      </div>
    </>
  );
}
