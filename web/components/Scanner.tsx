"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { errorCard, muted, primary, secondary } from "../lib/ui";

type Phase = "idle" | "starting" | "scanning" | "denied" | "unsupported";

/**
 * Rear-camera QR reader (getUserMedia + jsQR). On success the payload goes
 * to the parent, which parses it like a pasted payload. Any camera failure
 * falls back to the paste box below, never a blank screen.
 */
export default function Scanner({ onPayload, disabled }: { onPayload: (text: string) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const raf = useRef(0);
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const cb = useRef(onPayload);
  useEffect(() => {
    cb.current = onPayload;
  }, [onPayload]);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    const stream = video.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video.current) video.current.srcObject = null;
  };

  useEffect(() => stop, []);

  const start = async () => {
    setDetail(null);
    if (!window.isSecureContext) {
      setPhase("unsupported");
      setDetail("Kamera butuh konteks aman: localhost atau HTTPS.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      setDetail("Peramban ini tidak mendukung kamera.");
      return;
    }
    setPhase("starting");
    done.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const el = video.current;
      if (!el) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      el.srcObject = stream;
      await el.play();
      setPhase("scanning");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("canvas 2d tidak tersedia");
      const tick = () => {
        if (done.current || !el.videoWidth) {
          raf.current = requestAnimationFrame(tick);
          return;
        }
        canvas.width = el.videoWidth;
        canvas.height = el.videoHeight;
        ctx.drawImage(el, 0, 0);
        const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (found?.data) {
          done.current = true;
          stop();
          setPhase("idle");
          cb.current(found.data);
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setPhase(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "unsupported");
      setDetail(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Izin kamera ditolak. Tempel payload di bawah."
          : e instanceof Error
            ? e.message
            : "Kamera tidak bisa dinyalakan. Tempel payload di bawah.",
      );
    }
  };

  const live = phase === "scanning" || phase === "starting";

  return (
    <div>
      <video
        ref={video}
        playsInline
        muted
        className={
          live
            ? "aspect-square w-full rounded-2xl border border-zinc-200 bg-zinc-950 object-cover dark:border-zinc-800"
            : "hidden"
        }
      />
      {!live ? (
        <div>
          <button onClick={start} disabled={disabled} className={primary}>
            Nyalakan kamera
          </button>
          {phase === "denied" || phase === "unsupported" ? (
            <p role="alert" className={`${errorCard} mt-4`}>
              {detail}
            </p>
          ) : (
            <p className={`mt-2 text-sm ${muted}`}>Arahkan ke kode QRIS. Atau tempel payload di bawah.</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => {
            stop();
            setPhase("idle");
          }}
          className={`${secondary} mt-4`}
        >
          Matikan kamera
        </button>
      )}
    </div>
  );
}
