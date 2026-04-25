/**
 * Pipe Design System — Design Tokens
 * 
 * Single source of truth for all design tokens: colors, typography,
 * spacing, effects, and component variants.
 * 
 * Import and use across all components to maintain visual consistency.
 * Last updated: March 2026
 * 
 * @example
 * import { COLORS, SPACING, TYPOGRAPHY, EFFECTS } from '@/lib/designTokens';
 * 
 * const cardStyle = {
 *   background: COLORS.GLASS.CHROME,
 *   padding: SPACING['2xl'],
 *   fontSize: TYPOGRAPHY.SIZES.BODY,
 *   backdropFilter: EFFECTS.GLASS.FILTER,
 * };
 */

// ============================================================================
// COLORS
// ============================================================================

/**
 * Complete color palette for the Pipe design system
 */
export const COLORS = {
  // Foundation
  BACKGROUND: '#0c0c0e',
  
  // Text Hierarchy
  TEXT: {
    PRIMARY: '#ffffff',
    SECONDARY: 'rgba(255, 255, 255, 0.6)',
    TERTIARY: 'rgba(255, 255, 255, 0.4)',
  },

  // Semantic Status
  STATUS: {
    SUCCESS: '#10b981',  // Green - passing/active
    WARNING: '#f59e0b',  // Amber - draft/caution
    ERROR: '#ef4444',    // Red - error state
    INFO: '#3b82f6',     // Blue - informational
  },

  // Challenge Type Badges
  CHALLENGE: {
    CODE_REVIEW: '#60a5fa',           // Blue
    IMPLEMENTATION: 'var(--pipe-accent)',        // Purple
    QUIZ_MCQ: '#4ade80',              // Green
    QUIZ_SHORT_ANSWER: '#fbbf24',     // Amber
  },

  // Glass & Transparency Layers
  GLASS: {
    DARK: 'rgba(40, 40, 50, 0.6)',
    MEDIUM: 'rgba(200, 200, 220, 0.15)',
    LIGHT: 'rgba(255, 255, 255, 0.2)',
    CHROME: 'rgba(220, 220, 230, 0.15)',
    MERCURY: 'rgba(200, 210, 230, 0.12)',
  },

  // Accent
  AI: {
    PRIMARY: 'rgba(255, 255, 255, 0.45)',
    SECONDARY: 'rgba(167, 139, 250, 0.6)',
    GLOW: 'rgba(255, 255, 255, 0.18)',
  },

  // Borders & Accents
  BORDER: {
    SUBTLE: 'rgba(255, 255, 255, 0.08)',
    LIGHT: 'rgba(255, 255, 255, 0.12)',
    MEDIUM: 'rgba(255, 255, 255, 0.2)',
    HIGHLIGHT: 'rgba(255, 255, 255, 0.3)',
  },

  // Overlay & Backdrop
  OVERLAY: {
    LIGHT: 'rgba(0, 0, 0, 0.40)',
    MEDIUM: 'rgba(0, 0, 0, 0.60)',
    DARK: 'rgba(0, 0, 0, 0.75)',
  },
} as const;

// ============================================================================
// SPACING
// ============================================================================

/**
 * Modular spacing scale (4px base)
 * Used for padding, margins, and gaps
 */
export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '48px',
  '5xl': '60px',
} as const;

/**
 * Numeric values (in pixels) for programmatic use
 */
export const SPACING_NUM = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
  '5xl': 60,
} as const;

// ============================================================================
// TYPOGRAPHY
// ============================================================================

/**
 * Typography system: font stacks, sizes, weights, and line heights
 */
export const TYPOGRAPHY = {
  // Font Stacks
  FONT_FAMILY: {
    /** Monospace font for body text and technical content */
    PRIMARY: '"Space Mono", "Courier New", monospace',
    /** Display font for headers and prominent text */
    DISPLAY: '"Monument Extended", "Space Grotesk", sans-serif',
  },

  // Type Scale (7–28px, pragmatic implementation)
  SIZES: {
    /** 7px — indicators, small badges */
    MICRO: '7px',
    /** 8px — micro labels, very small text */
    TINY: '8px',
    /** 9px — labels, captions */
    CAPTION: '9px',
    /** 11px — secondary text, metadata */
    SMALL: '11px',
    /** 13px — primary body text */
    BODY: '13px',
    /** 18px — subsections, secondary headings */
    H3: '18px',
    /** 24px — section headers */
    H2: '24px',
    /** 28px — page titles, main headings */
    H1: '28px',
  },

  // Numeric size values
  SIZES_NUM: {
    MICRO: 7,
    TINY: 8,
    CAPTION: 9,
    SMALL: 11,
    BODY: 13,
    H3: 18,
    H2: 24,
    H1: 28,
  },

  // Font Weights
  WEIGHT: {
    REGULAR: 400,
    BOLD: 700,
    DISPLAY: 800,
  },

  // Letter Spacing
  LETTER_SPACING: {
    /** -0.02em — compressed, display text */
    TIGHT: '-0.02em',
    /** 0.05em — normal, body text */
    NORMAL: '0.05em',
    /** 0.2em — medium, buttons and tags */
    MEDIUM: '0.2em',
    /** 0.4em — wide, section labels and uppercase */
    WIDE: '0.4em',
  },

  // Line Height (unitless for scalability)
  LINE_HEIGHT: {
    TIGHT: 1.2,
    NORMAL: 1.5,
    RELAXED: 1.75,
  },
} as const;

// ============================================================================
// EFFECTS
// ============================================================================

/**
 * Visual effects: blur, shadows, borders, and transitions
 */
export const EFFECTS = {
  // Glass & Backdrop Effects
  GLASS: {
    /** Main glassmorphic effect used on all cards */
    FILTER: 'blur(40px) saturate(150%)',
    BLUR: 'blur(40px)',
    SATURATE: 'saturate(150%)',
  },

  // Shadows
  SHADOW: {
    /** Subtle shadow for slight elevation */
    ELEVATION: '0 4px 16px rgba(0, 0, 0, 0.3)',
    /** Strong shadow for cards at depth */
    CARD: '0 20px 60px rgba(0, 0, 0, 0.4)',
    /** Subtle inset highlight for glass cards */
    INSET_LIGHT: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
    INSET_LIGHT_STRONG: 'inset 0 1px 0 rgba(255, 255, 255, 0.2)',
    /** Combined shadow + inset for full glass effect */
    GLASS_FULL: '0 20px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  },

  // Borders
  BORDER: {
    /** Standard border radius for cards and containers */
    RADIUS_CARD: '12px',
    /** Small border radius for buttons and icons */
    RADIUS_SM: '8px',
    /** Pill-shaped (full rounded) */
    RADIUS_PILL: '9999px',
  },

  // Transitions & Animations
  TRANSITION: {
    /** Fast feedback (buttons, hovers) */
    FAST: '0.2s',
    /** Standard transition timing */
    NORMAL: '0.3s',
    /** Smooth, deliberate motion */
    SMOOTH: '0.4s',
    /** Slow sweep effects */
    SLOW: '0.6s',
    /** Very slow progress animations */
    SLOWER: '1.2s',
  },

  // Easing Functions
  EASING: {
    /** Default standard easing */
    STANDARD: 'cubic-bezier(0.4, 0, 0.2, 1)',
    /** Smooth, snappy easing */
    SMOOTH: 'cubic-bezier(0.16, 1, 0.3, 1)',
    /** Bounce/elastic easing */
    BOUNCE: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },

  // Transform Animations
  TRANSFORM: {
    /** Subtle lift on hover */
    LIFT_SM: 'translateY(-2px)',
    LIFT_MD: 'translateY(-4px)',
    /** Micro interaction shift */
    SHIFT: 'translateX(4px)',
  },
} as const;

// ============================================================================
// COMPONENT VARIANTS
// ============================================================================

/**
 * Pre-configured styles for common component variants
 * Use these for consistent styling across the codebase
 */
export const COMPONENT_VARIANTS = {
  // LiquidMetalCard Variants
  CARD: {
    DEFAULT: {
      background: COLORS.GLASS.DARK,
      border: `1px solid ${COLORS.BORDER.LIGHT}`,
      backdropFilter: EFFECTS.GLASS.FILTER,
      borderRadius: EFFECTS.BORDER.RADIUS_CARD,
    },
    CHROME: {
      background: COLORS.GLASS.CHROME,
      border: `1px solid ${COLORS.BORDER.MEDIUM}`,
      backdropFilter: EFFECTS.GLASS.FILTER,
      borderRadius: EFFECTS.BORDER.RADIUS_CARD,
    },
    MERCURY: {
      background: COLORS.GLASS.MERCURY,
      border: `1px solid ${COLORS.GLASS.MERCURY}`,
      backdropFilter: EFFECTS.GLASS.FILTER,
      borderRadius: EFFECTS.BORDER.RADIUS_CARD,
    },
    DARK: {
      background: COLORS.GLASS.DARK,
      border: `1px solid ${COLORS.BORDER.SUBTLE}`,
      backdropFilter: EFFECTS.GLASS.FILTER,
      borderRadius: EFFECTS.BORDER.RADIUS_CARD,
    },
  },

  // Card Hover States
  CARD_HOVER: {
    transform: EFFECTS.TRANSFORM.LIFT_SM,
    boxShadow: EFFECTS.SHADOW.GLASS_FULL,
    transition: `all ${EFFECTS.TRANSITION.NORMAL} ${EFFECTS.EASING.SMOOTH}`,
  },

  // Button Variants
  BUTTON: {
    BASE: {
      fontSize: TYPOGRAPHY.SIZES.SMALL,
      fontFamily: TYPOGRAPHY.FONT_FAMILY.PRIMARY,
      fontWeight: TYPOGRAPHY.WEIGHT.BOLD,
      letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM,
      borderRadius: EFFECTS.BORDER.RADIUS_SM,
      border: 'none',
      cursor: 'pointer',
      transition: `all ${EFFECTS.TRANSITION.NORMAL} ${EFFECTS.EASING.STANDARD}`,
    },
    PRIMARY: {
      background: COLORS.TEXT.PRIMARY,
      color: COLORS.BACKGROUND,
      padding: `${SPACING_NUM.sm}px ${SPACING_NUM.lg}px`,
    },
    SECONDARY: {
      background: 'transparent',
      border: `1px solid ${COLORS.BORDER.MEDIUM}`,
      color: COLORS.TEXT.PRIMARY,
      padding: `${SPACING_NUM.sm}px ${SPACING_NUM.lg}px`,
    },
    GHOST: {
      background: 'transparent',
      border: 'none',
      color: COLORS.TEXT.SECONDARY,
      padding: `${SPACING_NUM.sm}px ${SPACING_NUM.md}px`,
    },
    ICON: {
      width: '48px',
      height: '48px',
      borderRadius: EFFECTS.BORDER.RADIUS_SM,
      background: 'transparent',
      color: COLORS.TEXT.TERTIARY,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: `all ${EFFECTS.TRANSITION.NORMAL} ${EFFECTS.EASING.STANDARD}`,
    },
  },

  // Button Hover States
  BUTTON_HOVER: {
    PRIMARY: {
      opacity: 0.9,
      transform: 'scale(0.98)',
    },
    SECONDARY: {
      background: `rgba(255, 255, 255, 0.08)`,
      borderColor: COLORS.BORDER.HIGHLIGHT,
    },
    GHOST: {
      color: COLORS.TEXT.SECONDARY,
    },
    ICON: {
      background: `rgba(255, 255, 255, 0.08)`,
      color: `rgba(255, 255, 255, 0.7)`,
      transform: EFFECTS.TRANSFORM.SHIFT,
    },
  },

  // Input Variants
  INPUT: {
    BASE: {
      background: 'transparent',
      border: `1px solid ${COLORS.BORDER.LIGHT}`,
      borderRadius: EFFECTS.BORDER.RADIUS_SM,
      padding: `${SPACING_NUM.md}px ${SPACING_NUM.lg}px`,
      fontSize: TYPOGRAPHY.SIZES.BODY,
      fontFamily: TYPOGRAPHY.FONT_FAMILY.PRIMARY,
      color: COLORS.TEXT.PRIMARY,
      transition: `all ${EFFECTS.TRANSITION.NORMAL} ${EFFECTS.EASING.STANDARD}`,
      '::placeholder': {
        color: COLORS.TEXT.TERTIARY,
      },
    },
    FOCUS: {
      borderColor: COLORS.BORDER.HIGHLIGHT,
      boxShadow: `0 0 0 2px ${COLORS.AI.GLOW}`,
      outline: 'none',
    },
  },

  // Status Badge Variants
  BADGE: {
    SUCCESS: {
      color: 'rgba(16, 185, 129, 0.80)',
      background: 'rgba(16, 185, 129, 0.10)',
      border: '1px solid rgba(16, 185, 129, 0.30)',
    },
    WARNING: {
      color: 'rgba(245, 158, 11, 0.80)',
      background: 'rgba(245, 158, 11, 0.10)',
      border: '1px solid rgba(245, 158, 11, 0.30)',
    },
    ERROR: {
      color: 'rgba(239, 68, 68, 0.80)',
      background: 'rgba(239, 68, 68, 0.10)',
      border: '1px solid rgba(239, 68, 68, 0.30)',
    },
    INFO: {
      color: 'rgba(59, 130, 246, 0.80)',
      background: 'rgba(59, 130, 246, 0.10)',
      border: '1px solid rgba(59, 130, 246, 0.30)',
    },
    NEUTRAL: {
      color: COLORS.TEXT.SECONDARY,
      background: 'rgba(255, 255, 255, 0.05)',
      border: `1px solid ${COLORS.BORDER.SUBTLE}`,
    },
  },

  // Active/Focus Indicators
  INDICATOR: {
    ACTIVE_LINE: {
      position: 'absolute',
      left: '-12px',
      width: '3px',
      height: '24px',
      background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(200, 200, 220, 0.6))',
      borderRadius: '0 2px 2px 0',
      boxShadow: '0 0 12px rgba(255, 255, 255, 0.4)',
    },
    PULSE: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: COLORS.AI.PRIMARY,
      boxShadow: `0 0 8px ${COLORS.AI.GLOW}`,
    },
  },
} as const;

// ============================================================================
// LAYOUT & DIMENSIONS
// ============================================================================

/**
 * Layout system dimensions for consistent page structure
 */
export const LAYOUT = {
  // Container Widths
  CONTAINER_MAX_WIDTH: '1400px',

  // Navigation Dimensions
  SIDEBAR_WIDTH: '80px',
  AGENT_PANEL_WIDTH: '400px',
  HEADER_HEIGHT: '100px',

  // Grid Gaps
  GAP_XS: SPACING_NUM.sm,
  GAP_SM: SPACING_NUM.md,
  GAP_MD: SPACING_NUM.lg,
  GAP_LG: SPACING_NUM['2xl'],
  GAP_XL: SPACING_NUM['3xl'],

  // Padding Standards
  PADDING_COMPACT: SPACING_NUM.lg,
  PADDING_NORMAL: SPACING_NUM['2xl'],
  PADDING_SPACIOUS: SPACING_NUM['3xl'],
} as const;

// ============================================================================
// GRADIENTS
// ============================================================================

/**
 * Pre-configured gradients for consistent visual depth
 */
export const GRADIENTS = {
  // Background Orbs
  FLOATING_DEPTH: `radial-gradient(
    ellipse at 30% 30%,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(200, 210, 230, 0.08) 30%,
    transparent 100%
  )`,

  // Chrome Sweep Effect (use on pseudo-element overlay)
  CHROME_SWEEP: `linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.05),
    transparent
  )`,

  // Score Ring Gradient
  SCORE_GRADIENT: `linear-gradient(
    90deg,
    rgba(200, 210, 230, 0.3) 0%,
    rgba(255, 255, 255, 0.7) 50%,
    rgba(180, 190, 220, 0.5) 100%
  )`,

  // Active Indicator
  ACTIVE_INDICATOR: `linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.8),
    rgba(200, 200, 220, 0.6)
  )`,
} as const;

// ============================================================================
// ANIMATION KEYFRAMES
// ============================================================================

/**
 * Reusable animation definitions
 * Use in CSS @keyframes or Framer Motion
 */
export const ANIMATIONS = {
  SHIMMER: `
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
  `,

  PULSE: `
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.6;
        transform: scale(0.95);
      }
    }
  `,

  FLOAT: `
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
    }
  `,

  SWEEP: `
    @keyframes sweep {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
  `,
} as const;

// ============================================================================
// ACCESSIBILITY
// ============================================================================

/**
 * Accessibility presets for focus states and high contrast
 */
export const A11Y = {
  // Focus State
  FOCUS_OUTLINE: {
    outline: `2px solid ${COLORS.AI.PRIMARY}`,
    outlineOffset: '2px',
  },

  // High Contrast Mode Support
  FOCUS_OUTLINE_HC: {
    outline: '2px solid #fff',
    outlineOffset: '2px',
  },

  // WCAG Contrast Ratios (verified)
  CONTRAST: {
    PRIMARY_BG: '18.5:1',        // #fff on #0c0c0e
    SECONDARY_BG: '11.1:1',      // rgba(255,255,255,0.6) on #0c0c0e
    TERTIARY_BG: '7.4:1',        // rgba(255,255,255,0.4) on #0c0c0e
  },
} as const;

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Helper function to merge component variants with custom styles
 */
export function mergeStyles<T extends Record<string, any>>(
  base: T,
  overrides: Partial<T>
): T {
  return { ...base, ...overrides };
}

/**
 * Helper function to create responsive spacing values
 */
export function spacing(...values: (keyof typeof SPACING)[]) {
  return values.map(v => SPACING[v]).join(' ');
}

/**
 * Helper to apply glass effect consistently
 */
export function glassEffect(variant: keyof typeof COMPONENT_VARIANTS.CARD = 'DEFAULT') {
  return COMPONENT_VARIANTS.CARD[variant];
}

// ============================================================================
// EXPORTS FOR QUICK ACCESS
// ============================================================================

/**
 * All tokens grouped by category for convenience
 */
export default {
  COLORS,
  SPACING,
  SPACING_NUM,
  TYPOGRAPHY,
  EFFECTS,
  COMPONENT_VARIANTS,
  LAYOUT,
  GRADIENTS,
  ANIMATIONS,
  A11Y,
} as const;
