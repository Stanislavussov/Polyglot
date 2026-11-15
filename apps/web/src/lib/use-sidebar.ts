import { onMounted, ref } from "vue";
import { layoutForDrag, parseSidebarLayout, type SidebarLayout } from "./sidebar-width";

// Same key the inline script in BaseLayout reads before first paint.
const STORAGE_KEY = "web.sidebar";

export function useSidebar() {
  const layout = ref<SidebarLayout>(parseSidebarLayout(null));
  const collapsed = ref(false);
  const dragging = ref(false);

  function apply(next: SidebarLayout): void {
    layout.value = next;
    collapsed.value = next.collapsed;
    const root = document.documentElement;
    root.style.setProperty("--sidebar-w", `${next.width}px`);
    root.classList.toggle("sidebar-collapsed", next.collapsed);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Blocked storage (private mode): the menu still works, it is just not remembered.
    }
  }

  function toggle(): void {
    apply({ ...layout.value, collapsed: !layout.value.collapsed });
  }

  function startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging.value = true;
    const body = document.body.style;
    body.cursor = "col-resize";
    body.userSelect = "none";
    const onMove = (move: PointerEvent) => apply(layoutForDrag(move.clientX, layout.value));
    const onUp = () => {
      dragging.value = false;
      body.removeProperty("cursor");
      body.removeProperty("user-select");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  onMounted(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Blocked storage: defaults.
    }
    const saved = parseSidebarLayout(raw);
    layout.value = saved;
    collapsed.value = saved.collapsed;
  });

  return { collapsed, dragging, toggle, startDrag };
}
