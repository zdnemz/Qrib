"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useRef } from "react";

/**
 * Pointer-tracked 3D tilt for the hero receipt card. Max 10 degrees,
 * eases back flat on leave. Transform-only, reduced-motion renders flat.
 */
export default function Tilt({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 200, damping: 20 });
  const sry = useSpring(ry, { stiffness: 200, damping: 20 });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div className={className} style={{ perspective: 800 }}>
      <motion.div
        ref={ref}
        style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }}
        onMouseMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          ry.set(((e.clientX - r.left) / r.width - 0.5) * 10);
          rx.set(-((e.clientY - r.top) / r.height - 0.5) * 10);
        }}
        onMouseLeave={() => {
          rx.set(0);
          ry.set(0);
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
