/**
 * Single source of truth for the Cevoryn brand mark's geometry — an open
 * ring with a node at the gap ("C" for Cevoryn, always listening).
 *
 * Consumed both by regular React components (LogoMark) and by the
 * Next.js metadata image routes (icon.tsx, apple-icon.tsx,
 * opengraph-image.tsx), which render through Satori rather than the
 * normal DOM and can't share a component tree with the rest of the app.
 * Keeping the coordinates here means those four render paths can never
 * drift out of sync with each other.
 */
export const BRAND_MARK_VIEWBOX = "0 0 100 100";
export const BRAND_MARK_RING_PATH = "M74.5 29.4 A32 32 0 1 0 74.5 70.6";
export const BRAND_MARK_RING_STROKE_WIDTH = 13;
export const BRAND_MARK_NODE = { cx: 74.5, cy: 29.4, r: 8 } as const;
