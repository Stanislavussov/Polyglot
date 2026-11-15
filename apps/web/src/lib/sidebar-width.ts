export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 256;
export const SIDEBAR_RAIL = 68;
// Dragging the edge left past this point folds the menu to icons, as claude.ai does.
export const SIDEBAR_COLLAPSE_AT = 160;

export interface SidebarLayout {
  width: number;
  collapsed: boolean;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

export function layoutForDrag(pointerX: number, current: SidebarLayout): SidebarLayout {
  if (pointerX < SIDEBAR_COLLAPSE_AT) return { width: current.width, collapsed: true };
  return { width: clampSidebarWidth(pointerX), collapsed: false };
}

export function parseSidebarLayout(raw: string | null): SidebarLayout {
  try {
    const value = JSON.parse(raw ?? "{}") as { width?: unknown; collapsed?: unknown };
    return {
      width: typeof value.width === "number" ? clampSidebarWidth(value.width) : SIDEBAR_DEFAULT,
      collapsed: value.collapsed === true,
    };
  } catch {
    return { width: SIDEBAR_DEFAULT, collapsed: false };
  }
}
