<template>
  <!-- Each settled piece of the card fades in whole: typing it out letter by letter read as slow, not live. -->
  <span :key="text" class="stream-fade">{{ text }}</span>
</template>

<script setup lang="ts">
defineProps<{ text: string }>();
</script>
