<template>
  <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
    <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
      <thead class="bg-gray-50">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            scope="col"
            class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase cursor-pointer select-none hover:bg-gray-100 transition-colors"
            @click="sortBy(col.key)"
          >
            <span class="inline-flex items-center gap-1">
              {{ col.label }}
              <span v-if="sortKey === col.key" class="text-indigo-600">
                {{ sortOrder === "asc" ? "↑" : "↓" }}
              </span>
            </span>
          </th>
          <th v-if="$slots.actions" scope="col" class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">
            Actions
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr
          v-for="(row, i) in sortedRows"
          :key="i"
          class="transition-colors hover:bg-gray-50"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="whitespace-nowrap px-4 py-3 text-sm text-gray-700"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] }}
            </slot>
          </td>
          <td v-if="$slots.actions" class="whitespace-nowrap px-4 py-3 text-right text-sm">
            <slot name="actions" :row="row" />
          </td>
        </tr>
        <tr v-if="sortedRows.length === 0">
          <td :colspan="columns.length + ($slots.actions ? 1 : 0)" class="px-4 py-8 text-center text-sm text-gray-400">
            No data available
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

export interface Column {
  key: string;
  label: string;
}

export type TableCellValue = string | number | boolean | null | undefined;
export type TableRow = Record<string, TableCellValue>;

const props = defineProps<{
  columns: Column[];
  rows: TableRow[];
}>();

const sortKey = ref("");
const sortOrder = ref<"asc" | "desc">("asc");

function sortBy(key: string) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortOrder.value = "asc";
  }
}

const sortedRows = computed(() => {
  if (!sortKey.value) return props.rows;
  const rows = [...props.rows];
  rows.sort((a, b) => {
    const av = a[sortKey.value];
    const bv = b[sortKey.value];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortOrder.value === "asc" ? cmp : -cmp;
  });
  return rows;
});
</script>
