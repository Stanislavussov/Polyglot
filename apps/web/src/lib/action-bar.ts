import type { Component } from "vue";

/** One action for ActionBar: a button, a link, or a submenu of further actions. */
export interface BarAction {
  key: string;
  label: string;
  icon: Component;
  danger?: boolean;
  href?: string;
  onSelect?: () => void;
  children?: BarAction[];
}

export const MENU = "z-50 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-lg";
export const MENU_ITEM =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none data-[highlighted]:bg-surface-muted";
