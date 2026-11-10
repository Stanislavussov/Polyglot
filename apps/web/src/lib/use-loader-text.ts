import { onBeforeUnmount, type Ref, ref, watch } from "vue";
import { api } from "./api";
import type { LoaderPhrases } from "./types";

// Same uneven schedule as the bot loader: move early, then space out as the wait grows.
const TICK_OFFSETS_MS = [3_000, 5_000, 7_000, 10_000, 15_000] as const;

let phrases: Promise<LoaderPhrases | null> | null = null;

function loadPhrases(): Promise<LoaderPhrases | null> {
  phrases ??= api.loaderPhrases("translate").catch(() => {
    phrases = null;
    return null;
  });
  return phrases;
}

function randomOf<T>(options: readonly T[]): T | undefined {
  return options[Math.floor(Math.random() * options.length)];
}

function pick(data: LoaderPhrases, stage: number, current: string): string {
  const stagePhrases = data.stages[Math.min(stage, data.stages.length - 1)] ?? [];
  const options = stagePhrases.filter((phrase) => !current.includes(phrase));
  const phrase = randomOf(options) ?? randomOf(stagePhrases);
  if (phrase === undefined) return current;
  const emoji = randomOf(data.emoji);
  return emoji === undefined ? phrase : `${emoji} ${phrase}...`;
}

/** The bot's rotating wait phrase while `busy` is true; empty until the phrases arrive. */
export function useLoaderText(busy: Ref<boolean>): Ref<string> {
  const text = ref("");
  void loadPhrases();
  let timers: ReturnType<typeof setTimeout>[] = [];

  const stop = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  watch(busy, async (active) => {
    stop();
    text.value = "";
    if (!active) return;
    const data = await loadPhrases();
    if (!data || !busy.value) return;
    text.value = pick(data, 0, "");
    timers = TICK_OFFSETS_MS.map((offset, index) =>
      setTimeout(() => {
        text.value = pick(data, index + 1, text.value);
      }, offset),
    );
  });

  onBeforeUnmount(stop);
  return text;
}
