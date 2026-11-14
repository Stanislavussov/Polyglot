<template>
  <DropdownMenuSub v-if="action.children">
    <DropdownMenuSubTrigger :class="[MENU_ITEM, action.danger && 'text-danger']">
      <component :is="action.icon" class="size-4" aria-hidden="true" />{{ action.label }}
      <ChevronRight class="ml-auto size-4" aria-hidden="true" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent :side-offset="6" :class="MENU">
        <ActionMenuItem v-for="child in action.children" :key="child.key" :action="child" />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
  <DropdownMenuItem
    v-else
    :as="action.href ? 'a' : 'div'"
    :href="action.href"
    :class="[MENU_ITEM, action.danger && 'text-danger']"
    @select="action.onSelect?.()"
  >
    <component :is="action.icon" class="size-4" aria-hidden="true" />{{ action.label }}
  </DropdownMenuItem>
</template>

<script setup lang="ts">
import { ChevronRight } from "lucide-vue-next";
import { DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "reka-ui";
import { type BarAction, MENU, MENU_ITEM } from "../lib/action-bar";

defineProps<{ action: BarAction }>();
</script>
