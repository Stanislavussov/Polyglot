/**
 * Curated starter videos for the video-vocabulary feature (Task 72).
 *
 * The empty state used to be a cold "send me a YouTube link", which is a dead end
 * for someone who has just finished onboarding and has no idea what kind of video
 * works. These are the answer to "like what?".
 *
 * Selection constraints, all of them load-bearing:
 *
 * - **Short.** The whole transcript goes into one AI request and `computePhraseTarget`
 *   scales with duration, so a two-hour podcast is slow and expensive. 5–20 minutes.
 * - **Captioned in the target language.** No captions means no transcript means
 *   nothing to extract — the run fails and the user's first impression is an error.
 * - **Spoken by native speakers, in the learning language.** Not English content
 *   about the language.
 * - **From an established channel** (Easy Languages, DW, public broadcasters), so
 *   the link is still alive in a year.
 * - **Safe for a first run**: no politics, no vulgarity, nothing age-restricted.
 *
 * Every URL here was verified as live, correctly attributed and captioned at the
 * time it was added. They are still third-party links and can rot; a dead one
 * surfaces as a normal "transcript unavailable" failure rather than a crash, and
 * costs the user nothing because the onboarding trial only counts once it
 * completes.
 */

export interface VideoSuggestion {
  /** Title as it appears on YouTube. */
  title: string;
  /** Channel handle, e.g. `@easygerman`. */
  channel: string;
  /** Canonical short URL (`https://youtu.be/<id>`). */
  url: string;
}

/** A suggestion resolved for a specific language, carrying its lookup key. */
export interface ResolvedVideoSuggestion extends VideoSuggestion {
  lang: string;
  /** Index within that language's list — what the callback data carries. */
  index: number;
}

/**
 * Upper bound on suggestion buttons across all learning languages. A four-language
 * user would otherwise get a wall; entries are taken round-robin so every learning
 * language is represented before any language gets a second one.
 */
export const MAX_VIDEO_SUGGESTIONS = 4;

/**
 * Verified 2026-08-04. Each entry was confirmed against YouTube's own player
 * response: exact title, channel, duration, `availability: public`,
 * `age_limit: 0`, and — the part that actually matters — a **native-language**
 * caption track.
 *
 * The caption check is subtler than it looks: YouTube marks the language its
 * speech recognition actually ran on with a `<lang>-orig` key. A video whose only
 * tracks are auto-*translations* has no such key, and feeding it to the extractor
 * yields phrases in the wrong language. That test rejected more candidates than
 * every other criterion combined — most Easy Czech uploads, for instance, have
 * captions disabled outright.
 *
 * **Kazakh is deliberately absent, and must stay absent until a video with
 * hand-written `kk` subtitles is found.** YouTube has no Kazakh ASR model: across
 * a dozen Kazakh videos the auto-tracks came back as `ru-orig`, `tr-orig` and even
 * `uz-orig`. A `kk` entry would silently hand the AI a Russian or Turkish
 * transcript and produce confident nonsense — strictly worse than the empty state
 * a Kazakh learner gets today.
 *
 * Only the BBC `en` and Easy Spanish 344 entries have human-written captions; the
 * rest rely on ASR, so expect no punctuation and occasional errors in their
 * transcripts. Adequate for phrase extraction, but those two produce visibly
 * better output.
 */
const VIDEO_SUGGESTIONS: Readonly<Record<string, readonly VideoSuggestion[]>> = {
  en: [
    // Human-written captions, and a plain `en` track rather than `en-GB` — the
    // other 6 Minute English episodes use `en-GB`, which a strict lookup misses.
    {
      title: "What and where is Little Italy? ⏲️ 6 Minute English",
      channel: "@bbclearningenglish",
      url: "https://youtu.be/Y5sSvaAKF90",
    },
    {
      title: "English Conversations about JOBS and WORK | Easy English 210",
      channel: "@easyenglishvideos",
      url: "https://youtu.be/BNq17ed4Bc8",
    },
  ],
  ru: [
    {
      title: "Grocery Shopping in Russia | Easy Russian 64",
      channel: "@easyrussian",
      url: "https://youtu.be/DZPR3UVoHCU",
    },
    {
      title: "Do Russians Know How to Smalltalk? | Easy Russian 94",
      channel: "@easyrussian",
      url: "https://youtu.be/tkJ5aiWOkXs",
    },
  ],
  cs: [
    { title: "How do Czech people live? | Easy Czech 39", channel: "@easyczech", url: "https://youtu.be/t7EUctReSjc" },
    {
      title: "What Weather do Czechs Like Best? | Easy Czech 35",
      channel: "@easyczech",
      url: "https://youtu.be/Wp-HreykAxo",
    },
  ],
  de: [
    {
      title: "How Important Is Money to You? (German Street Interview)",
      channel: "@easygerman",
      url: "https://youtu.be/Lfoai_nP7lc",
    },
    {
      title: "Münster, What Are You Doing Today? | Easy German 595",
      channel: "@easygerman",
      url: "https://youtu.be/Qo_kusD5oQ4",
    },
  ],
  fr: [
    {
      title: "Friday Night in Paris: What Are Your Plans? | Easy French 230",
      channel: "@easyfrench",
      url: "https://youtu.be/Dvx6IAiDx_c",
    },
    {
      title: "What French People Listen To: Music Vocabulary and Real Conversations",
      channel: "@easyfrench",
      url: "https://youtu.be/Nib5ZZaA4Ps",
    },
  ],
  es: [
    // Manual `es` captions — the best transcript quality in the catalogue.
    // (Title is verbatim from YouTube, missing "in" and all.)
    {
      title: "What's the Most Important Thing Life? | Easy Spanish 344",
      channel: "@easyspanish",
      url: "https://youtu.be/mECAxJYzj0Y",
    },
    {
      title: "What are you doing today? | Easy Spanish 186",
      channel: "@easyspanish",
      url: "https://youtu.be/SCS1dJ35lig",
    },
  ],
  it: [
    {
      title: "Italy for a Weekend? Locals Share Their Go-To Places & Tips! | Super Easy Italian 64",
      channel: "@easyitalian",
      url: "https://youtu.be/rRJJYlWGzjI",
    },
    {
      title: "Italian Family Food Memories | Easy Italian 191",
      channel: "@easyitalian",
      url: "https://youtu.be/4rHIWxeGVk8",
    },
  ],
  pt: [
    {
      title: "Brazilians Talk About Their Daily Routines | Easy Portuguese 105",
      channel: "@easyportuguese",
      url: "https://youtu.be/3RncX6cLYvI",
    },
    {
      title: "80+ Real Life Questions in Portuguese | EP164",
      channel: "@easyportuguese",
      url: "https://youtu.be/tRUJZUtXShA",
    },
  ],
  // Easy Languages has no Ukrainian content in the 5–20 min range — its whole
  // back-catalogue is under 5 minutes — so these come from smaller (but real and
  // established) channels. Most likely of the set to rot; revisit if one dies.
  uk: [
    {
      title: "ПРО мову – Як правильно говорить про час українською",
      channel: "@novyichernihiv",
      url: "https://youtu.be/JM6tz6KhAB8",
    },
    {
      title: "Ukraine, how many languages do you speak? | Street Interviews",
      channel: "@realukraine",
      url: "https://youtu.be/qyUYZHxqVFc",
    },
  ],
  pl: [
    {
      title: "What Do Poles Think About Life in Poland? | Easy Polish 180",
      channel: "@easypolish",
      url: "https://youtu.be/mcmav7jxOfk",
    },
    {
      title: "What Locals Love & Hate About Wrocław | Easy Polish 166",
      channel: "@easypolish",
      url: "https://youtu.be/aa-GEfukFpE",
    },
  ],
};

/** Curated videos for a learning language; empty for a language with no verified picks. */
export function getVideoSuggestions(lang: string): readonly VideoSuggestion[] {
  return VIDEO_SUGGESTIONS[lang] ?? [];
}

/** Languages that have at least one verified suggestion. */
export function getVideoSuggestionLanguages(): readonly string[] {
  return Object.keys(VIDEO_SUGGESTIONS);
}

/**
 * Suggestions for the user's learning languages, round-robin across languages and
 * capped at {@link MAX_VIDEO_SUGGESTIONS}.
 */
export function getVideoSuggestionsForLangs(learningLangs: readonly string[]): ResolvedVideoSuggestion[] {
  const perLang = learningLangs.map((lang) => ({ lang, videos: getVideoSuggestions(lang) }));
  const longest = perLang.reduce((max, entry) => Math.max(max, entry.videos.length), 0);
  const picked: ResolvedVideoSuggestion[] = [];

  for (let index = 0; index < longest && picked.length < MAX_VIDEO_SUGGESTIONS; index++) {
    for (const { lang, videos } of perLang) {
      if (picked.length >= MAX_VIDEO_SUGGESTIONS) break;
      const video = videos[index];
      if (video) picked.push({ ...video, lang, index });
    }
  }

  return picked;
}

/** Resolve the video a `vid:try:<lang>:<index>` callback refers to. */
export function resolveVideoSuggestion(lang: string, index: number): VideoSuggestion | null {
  return getVideoSuggestions(lang)[index] ?? null;
}
