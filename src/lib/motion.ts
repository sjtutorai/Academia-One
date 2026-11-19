import type { Transition, Variants } from 'motion/react';

/**
 * Shared AcademiaOne Motion Design Tokens
 * Timing: Micro 120–180ms | Standard 180–280ms | Dialog/Page 240–380ms | Hero 500–900ms
 * Easing: ease-out for entering, ease-in for exiting, gentle ease-in-out for state changes.
 * Only transform and opacity are animated for 60fps administrative workflows.
 */
export const MOTION_DURATION = {
  micro: 0.15,
  standard: 0.22,
  dialog: 0.26,
  page: 0.26,
  hero: 0.65,
} as const;

export const MOTION_EASE = {
  out: [0.16, 1, 0.3, 1] as const,
  in: [0.4, 0, 1, 1] as const,
  inOut: [0.4, 0, 0.2, 1] as const,
};

export const MOTION_DISTANCE = {
  subtle: 6,
  normal: 10,
  reveal: 14,
  stepX: 16,
} as const;

export const MOTION_STAGGER = {
  fast: 0.05,
  card: 0.07,
  hero: 0.09,
} as const;

export const TRANSITION_MICRO: Transition = {
  duration: MOTION_DURATION.micro,
  ease: MOTION_EASE.out,
};

export const TRANSITION_STANDARD: Transition = {
  duration: MOTION_DURATION.standard,
  ease: MOTION_EASE.out,
};

export const TRANSITION_DIALOG: Transition = {
  duration: MOTION_DURATION.dialog,
  ease: MOTION_EASE.out,
};

export function getPageEntranceVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, y: MOTION_DISTANCE.subtle },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.12 : MOTION_DURATION.page, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { opacity: 0, y: -4, transition: { duration: 0.14, ease: MOTION_EASE.in } },
  };
}

export function getModalBackdropVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: reducedMotion ? 0.1 : 0.2, ease: MOTION_EASE.out } },
    exit: { opacity: 0, transition: { duration: reducedMotion ? 0.08 : 0.16, ease: MOTION_EASE.in } },
  };
}

export function getModalDialogVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 },
    animate: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.1 : MOTION_DURATION.dialog, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.16, ease: MOTION_EASE.in } },
  };
}

export function getDrawerVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: reducedMotion ? { opacity: 0 } : { x: '-100%', opacity: 0.85 },
    animate: {
      x: 0,
      opacity: 1,
      transition: { duration: reducedMotion ? 0.12 : 0.26, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { x: '-100%', opacity: 0.85, transition: { duration: 0.2, ease: MOTION_EASE.in } },
  };
}

export function getDropdownVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 },
    animate: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.08 : 0.16, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12, ease: MOTION_EASE.in } },
  };
}

export function getToastVariants(reducedMotion: boolean | null): Variants {
  return {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: reducedMotion ? 0.1 : 0.22, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { opacity: 0, x: 16, transition: { duration: 0.16, ease: MOTION_EASE.in } },
  };
}

export function getWizardStepVariants(direction: number, reducedMotion: boolean | null): Variants {
  const offset = direction >= 0 ? MOTION_DISTANCE.stepX : -MOTION_DISTANCE.stepX;
  return {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, x: offset },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: reducedMotion ? 0.1 : 0.24, ease: MOTION_EASE.out },
    },
    exit: reducedMotion
      ? { opacity: 0, transition: { duration: 0.08 } }
      : { opacity: 0, x: -offset * 0.65, transition: { duration: 0.16, ease: MOTION_EASE.in } },
  };
}

export function getStaggerContainerVariants(
  reducedMotion: boolean | null,
  stagger: number = MOTION_STAGGER.card,
): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: reducedMotion ? 0 : stagger,
      },
    },
  };
}

export function getStaggerItemVariants(reducedMotion: boolean | null, rise: number = MOTION_DISTANCE.reveal): Variants {
  return {
    hidden: reducedMotion ? { opacity: 0 } : { opacity: 0, y: rise },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reducedMotion ? 0.12 : 0.32, ease: MOTION_EASE.out },
    },
  };
}
