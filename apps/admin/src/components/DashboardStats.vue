<template>
  <div class="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
    <StatCard label="Total Users" :value="statsData.totalUsers" icon="👥" icon-bg-class="bg-blue-50 text-blue-600" />
    <StatCard label="Active Today" :value="statsData.activeToday" icon="✅" icon-bg-class="bg-emerald-50 text-emerald-600" />
    <StatCard
      label="Translations Today"
      :value="statsData.translationsToday"
      icon="🌐"
      icon-bg-class="bg-violet-50 text-violet-600"
    />
    <StatCard
      label="Total Translations"
      :value="statsData.totalTranslations"
      icon="📊"
      icon-bg-class="bg-amber-50 text-amber-600"
    />
  </div>
  <p v-if="error" class="mt-4 text-sm text-red-600">{{ error }}</p>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { stats, type Stats } from "../lib/api";
import StatCard from "./StatCard.vue";

const statsData = ref<Stats>({
  totalUsers: 0,
  activeToday: 0,
  translationsToday: 0,
  totalTranslations: 0,
});
const error = ref("");

onMounted(async () => {
  try {
    statsData.value = await stats.get();
  } catch {
    error.value = "Failed to load dashboard stats";
  }
});
</script>
