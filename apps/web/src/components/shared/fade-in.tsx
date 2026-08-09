"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { duration, easing } from "@/theme/tokens";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.standard },
  },
};

/** Staggered fade-in-up entrance — wrap a grid of cards with `FadeInStagger`, each card with `FadeInItem`. */
export function FadeInStagger({
  children,
  className,
  ...ariaProps
}: {
  children: ReactNode;
  className?: string;
} & React.AriaAttributes) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className={className}
      {...ariaProps}
    >
      {children}
    </motion.div>
  );
}

export function FadeInItem({ children }: { children: ReactNode }) {
  return <motion.div variants={itemVariants}>{children}</motion.div>;
}
