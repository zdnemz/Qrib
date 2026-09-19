"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "/fitur", label: "Fitur" },
  { href: "/biaya", label: "Biaya" },
  { href: "/keamanan", label: "Keamanan" },
  { href: "/faq", label: "FAQ" },
];

/** Mobile menu. Desktop links stay inline; the panel only exists below md. */
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Tutup menu" : "Buka menu"}
        className="rounded-full p-2 transition-colors hover:bg-zinc-100 active:scale-[0.98] dark:hover:bg-zinc-800"
      >
        {open ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
      </button>
      {open && (
        <div className="absolute inset-x-4 top-16 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-950">
          {[{ href: "/", label: "Beranda" }, ...LINKS].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-2xl px-4 py-3 font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/scan"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-full bg-emerald-700 px-4 py-3 text-center font-semibold text-white dark:bg-emerald-400 dark:text-zinc-950"
          >
            Pindai QR
          </Link>
        </div>
      )}
    </div>
  );
}
