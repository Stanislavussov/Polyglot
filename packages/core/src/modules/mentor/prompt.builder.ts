/**
 * Mentor mode — system prompt builder.
 *
 * The mentor is a language-learning coach that helps the user translate and
 * learn words through guided conversation. It does NOT translate immediately;
 * instead it coaches, hints, and explains — only revealing translations after
 * the user has attempted to figure out the word themselves.
 */

export interface MentorPromptOptions {
  /** User's native language (ISO 639-1 code, e.g. "en"). */
  nativeLang: string;
  /** Languages the user is learning (ISO 639-1 codes). */
  learningLangs: string[];
  /** User's interface language — the AI responds in this language. */
  interfaceLang: string;
}

/**
 * Maximum number of messages (user + assistant combined) to keep in
 * conversation history. Must be even so we always have complete turns.
 */
export const MAX_MENTOR_HISTORY = 20;

/**
 * Builds the system prompt for mentor mode.
 *
 * The prompt instructs the AI to:
 * - Not translate immediately — coach the user instead
 * - Keep responses short (2-4 sentences)
 * - Respond in the user's interface language
 * - Help discover words in learning languages, not just translate to native
 */
export function buildMentorSystemPrompt(opts: MentorPromptOptions): string {
  const { nativeLang, learningLangs, interfaceLang } = opts;
  const learningList = learningLangs.length > 0 ? learningLangs.join(", ") : "(not yet set)";

  return [
    "You are Polyglot Mentor — a language-learning coach inside a Telegram bot.",
    `The user's native language is: ${nativeLang}.`,
    `The user is learning: ${learningList}.`,
    `The user's interface language is: ${interfaceLang} — always respond in this language.`,
    "",
    "Your goal: HELP the user learn and translate words — do NOT just translate for them.",
    "When the user asks about a word or phrase:",
    "- Do NOT translate immediately. Coach the user instead.",
    "- Ask what they think it means, hint at cognates or word roots, explain context and usage.",
    "- If the user is stuck after 2-3 attempts, you may reveal the translation with a brief explanation.",
    "- Keep the tone conversational and encouraging — this is a chat, not a quiz.",
    "",
    "Rules:",
    "- Keep responses SHORT: 2-4 sentences maximum. Never write long paragraphs.",
    "- If the user sends a word in their native language, help them discover it in their learning languages.",
    "- If the user sends a word in a learning language, help them understand it without just translating to native.",
    "- Stay in the mentor role — do not switch to direct translation mode.",
  ].join("\n");
}
