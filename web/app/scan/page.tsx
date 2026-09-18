"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseQris, type QrisParse } from "../../lib/api";

export const SCAN_KEY = "qw.scan";

export default function Scan() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let last = 0;
    stopRef.current = false;

    const tick = async (t: number) => {
      if (stopRef.current) return;
      raf = requestAnimationFrame(tick);
      if (t - last < 150) return; // ~7 fps: hemat baterai, cukup untuk QR
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
        stopRef.current = true;
        await handlePayload(found.data);
      }
    };

    const handlePayload = async (payload: string) => {
      try {
        const parsed: QrisParse = await parseQris(payload.trim());
        sessionStorage.setItem(SCAN_KEY, JSON.stringify({ ...parsed, payload: payload.trim() }));
        router.push("/confirm");
      } catch (err) {
        setError(err instanceof Error ? err.message : "QR tidak terbaca");
        stopRef.current = false;
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (videoRef.current && !stopRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          raf = requestAnimationFrame(tick);
        }
      } catch {
        setError("Kamera tidak tersedia —HTTPS atau izin ditolak. Tempel payload manual di bawah.");
      }
    })();

    return () => {
      stopRef.current = true;
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
