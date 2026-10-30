import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';

const STAGGER_LIMIT = 12;
const STAGGER_STEP = 0.035;

export function LibraryMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Entrada com stagger limitado aos primeiros itens; o restante entra sem atraso. */
export function cardEntrance(index: number) {
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const, delay: Math.min(index, STAGGER_LIMIT) * STAGGER_STEP }
  };
}

export const cardInteraction = {
  whileHover: { y: -3 },
  whileTap: { scale: 0.97 }
} as const;
