<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="$emit('cancel')"
    >
      <div class="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h3 class="text-lg font-semibold text-gray-900">{{ title }}</h3>
        <p class="mt-2 text-sm text-gray-600">{{ message }}</p>
        <div class="mt-6 flex justify-end gap-3">
          <button
            class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            @click="$emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
            @click="$emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>