<template>
  <div class="border-t border-sidebar-hover px-3 py-3">
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover"
      @click="signOut"
    >
      <LogOut class="size-5" aria-hidden="true" />
      {{ t("web.nav.signOut") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { LogOut } from "lucide-vue-next";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

async function signOut(): Promise<void> {
  // Even if the call fails the cookie may be gone; the login page re-checks the session either way.
  await api.logout().catch(() => undefined);
  window.location.replace("/login/");
}
</script>
