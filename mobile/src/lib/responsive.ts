/**
 * Viewport-size hooks. The UX spec (§3.3) is written for a handset, but the same bundle is
 * served as a website, where the window can be any width — a phone column stretched across a
 * desktop monitor is unreadable, and a bottom tab bar spanning 1920px is not a navigation.
 *
 * Width alone decides; no Platform check is needed, because a handset is always narrower than
 * the tablet breakpoint and so keeps exactly the layout it had before.
 */
import { useWindowDimensions } from 'react-native';

/** Below `tablet` the layout is the original single phone column. At `desktop` the navigation
 *  moves to a side rail and content is allowed a second column. */
export const BREAKPOINT = { tablet: 720, desktop: 1080 } as const;

export type LayoutSize = 'phone' | 'tablet' | 'desktop';

export function useLayoutSize(): LayoutSize {
  const { width } = useWindowDimensions();
  if (width >= BREAKPOINT.desktop) return 'desktop';
  if (width >= BREAKPOINT.tablet) return 'tablet';
  return 'phone';
}

/**
 * Readable measure per size. `null` on a phone means "no cap" — the screen keeps the full
 * viewport width it has always used, so nothing about the handset layout changes.
 */
export const CONTENT_MAX_WIDTH: Record<LayoutSize, number | null> = {
  phone: null,
  tablet: 760,
  desktop: 1120,
};

/** True once the viewport is wide enough for the side rail and two-column content. */
export function useIsWide(): boolean {
  return useLayoutSize() !== 'phone';
}

/** Width of the desktop navigation rail, in points. */
export const NAV_RAIL_WIDTH = 232;

/**
 * Style that caps a block at the readable measure and centres it, or `null` on a phone where
 * no cap applies. Screens that render their own root (a map, onboarding) apply this to the
 * parts that are text or controls, and leave the parts that want the whole canvas uncapped.
 */
export function useMeasureStyle(): { width: '100%'; maxWidth: number; alignSelf: 'center' } | null {
  const maxWidth = CONTENT_MAX_WIDTH[useLayoutSize()];
  return maxWidth ? { width: '100%', maxWidth, alignSelf: 'center' } : null;
}
