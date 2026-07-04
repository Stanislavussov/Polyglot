<template>
  <form class="space-y-4" @submit.prevent="submit">
    <FormField
      id="email"
      v-model="email"
      label="Email"
      type="email"
      required
      autocomplete="email"
      placeholder="admin@polyglot.app"
    />
    <FormField
      id="password"
      v-model="password"
      label="Password"
      type="password"
      required
      autocomplete="current-password"
      placeholder="••••••••"
    />
    <AlertMessage v-if="error">{{ error }}</AlertMessage>
    <AppButton type="submit" :disabled="loading" class="w-full py-2.5 font-semibold">
      {{ loading ? "Signing in..." : "Sign in" }}
    </AppButton>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { auth } from "../lib/api";
import { loginSchema, zodErrorMessage } from "@polyglot/admin-contracts";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import FormField from "./ui/FormField.vue";

const email = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function submit(): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    const parsed = loginSchema.safeParse({ email: email.value, password: password.value });
    if (!parsed.success) {
      error.value = zodErrorMessage(parsed.error);
      return;
    }
    await auth.login(parsed.data.email, parsed.data.password);
    window.location.href = "/";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Login failed";
  } finally {
    loading.value = false;
  }
}
</script>
