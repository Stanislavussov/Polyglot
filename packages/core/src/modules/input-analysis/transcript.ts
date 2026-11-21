import { classifyInput } from "./input-analyzer.js";

// Speech-to-text ends nearly everything with a full stop. On a single word or a short phrase
// that dot is noise: it lands in the dictionary as "Apple." Sentences keep their punctuation,
// and a question or exclamation mark always stays — it carries meaning.
const TRAILING_STOPS = /[.。…]+$/u;

export function tidyTranscript(text: string): string {
  const trimmed = text.trim();
  const bare = trimmed.replace(TRAILING_STOPS, "").trimEnd();
  if (bare === "" || classifyInput(bare).type === "sentence") return trimmed;
  return bare;
}
