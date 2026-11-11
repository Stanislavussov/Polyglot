export interface Me {
  id: number;
  username: string | null;
  plan: string;
  onboarded: boolean;
  interfaceLang: string;
}

export interface Language {
  code: string;
  name: string;
  flag: string;
}

export interface Settings {
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  interfaceLanguages: string[];
  languages: Language[];
  notifications: NotificationSettings;
}

export type NotificationType = "suggested" | "srs" | "contextual" | "expressions";

export interface NotificationSettings {
  enabled: boolean;
  /** "HH:MM" half-hour slots in the learner's timezone. */
  times: string[];
  type: NotificationType;
  batchSize: number;
  timezone: string;
  context: string | null;
  channel: NotificationChannel;
  /** VAPID key for this device's subscription; null = the server has Web Push off. */
  pushPublicKey: string | null;
  options: { types: NotificationType[]; batchSizes: number[]; maxTimes: number };
}

export type NotificationChannel = "bot" | "web";

export type NotificationPatch = Partial<
  Pick<NotificationSettings, "enabled" | "times" | "type" | "batchSize" | "timezone" | "context" | "channel">
>;

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  auto: boolean;
}

/** Which recall aids a review card's hidden-answer side shows (core `CardFrontFields`). */
export interface CardFrontFields {
  synonyms: boolean;
  example: boolean;
  hint: boolean;
}

export interface TemplateFields {
  synonyms: boolean;
  examples: boolean;
  alternatives: boolean;
  equivalentNote: boolean;
  connotationWarning: boolean;
}

export interface TemplateState {
  fields: TemplateFields;
  custom: boolean;
}

export interface PlanOffer {
  name: string;
  label: string;
  priceUsdCents: number;
  translationLimit: number | null;
  video: boolean;
  features: string[];
}

export interface PlanInfo {
  current: {
    name: string;
    label: string;
    translationLimit: number | null;
    features: string[];
    periodEnd: string | null;
    trial: boolean;
  };
  plans: PlanOffer[];
  upgradeUrl: string;
}

export type IssueType = "bug" | "suggestion" | "other";

export type SettingsPatch = Partial<Pick<Settings, "interfaceLang" | "nativeLang" | "learningLangs">>;

export interface DictionaryItem {
  id: number;
  original: string;
  sourceLang: string;
  emoji: string | null;
  createdAt: string;
  /** Languages with a voice (never the learner's native one): speakers show only where tapping plays. */
  speakLangs: string[];
  translations: { lang: string; text: string }[];
}

export interface Dictionary {
  id: number;
  name: string;
  icon: string | null;
  isDefault: boolean;
  count: number;
}

export interface DictionaryPage {
  items: DictionaryItem[];
  audio: AudioAccess;
  dictionary: Dictionary;
  total: number;
  page: number;
  pageSize: number;
}

export interface EntryReviewState {
  dueAt: string | null;
  intervalDays: number;
  reviewCount: number;
  mature: boolean;
}

export interface EntryDetailTarget {
  lang: string;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  synonyms: string[];
  alternatives: string[];
  examples: TranslateExample[];
  review: EntryReviewState;
}

export interface EntryDetail {
  id: number;
  original: string;
  sourceLang: string;
  emoji: string | null;
  createdAt: string;
  translations: { lang: string; text: string }[];
  inputType: "word" | "phrase" | "sentence";
  nativeMeaning: string | null;
  difficulty: "hard" | "normal" | "easy" | null;
  sourceUsage: TranslateResult["sourceUsage"];
  details: EntryDetailTarget[];
}

export type DictionarySort = "recent" | "alpha";

export type DictionaryType = "word" | "phrase" | "sentence";
export type DictionaryDifficulty = "hard" | "normal" | "easy";
export type DictionaryReview = "due" | "new" | "learned";

/** An empty string means "no filter". */
export interface DictionaryFilterState {
  lang: string;
  type: DictionaryType | "";
  difficulty: DictionaryDifficulty | "";
  review: DictionaryReview | "";
}

export interface TranslateExample {
  context: string;
  target: string;
  native: string | null;
}

export interface TranslateTarget {
  lang: string;
  text: string;
  expressionType: string | null;
  equivalentNote: string | null;
  usageNote: string | null;
  connotationWarning: string | null;
  alternatives: string[];
  synonyms: string[];
  examples: TranslateExample[];
}

export interface TranslateResult {
  original: string;
  sourceLang: string;
  targetLangs: string[];
  sentence: boolean;
  emoji: string | null;
  nativeMeaning: string | null;
  unverified: boolean;
  correction: { original: string; corrected: string; explanation: string } | null;
  sourceUsage: {
    headword: string | null;
    explanation: string;
    synonyms: string[];
    examples: TranslateExample[];
  } | null;
  translations: TranslateTarget[];
  savedEntryId: number | null;
  /** Signed card for the Save button; null for a sentence, absent on stored history. */
  saveToken?: string | null;
  // Absent on results saved in history before the card could be explored.
  inputType?: "word" | "phrase" | "sentence";
  context?: string | null;
  etymologyEligible?: boolean;
  /** Paid card actions the plan includes; the server re-checks every one. */
  features?: CardFeatures;
}

export interface CardFeatures {
  clarification: boolean;
  mentor: boolean;
  etymology: boolean;
}

export interface MentorTurn {
  role: "user" | "assistant";
  content: string;
}

/** "off" = voice-over switched off for everyone; "locked" = not in the learner's plan. */
export type AudioAccess = "ok" | "locked" | "off";

export interface CardAudio {
  langs: string[];
  access: AudioAccess;
}

export interface ReviewCard {
  entryId: number;
  /** Not due yet: practised ahead because nothing is due. */
  ahead: boolean;
  /** What the hidden-answer side shows, per the learner's card settings. */
  front: {
    headword: string;
    synonyms: string[];
    example: string | null;
    hint: string | null;
    available: Record<keyof CardFrontFields, boolean>;
  };
  detail: EntryDetail;
  audio: CardAudio;
}

export interface ReviewState {
  card: ReviewCard | null;
  dueCount: number;
}

export type Rating = "again" | "hard" | "good" | "easy";
export type LearnPageName = "learn" | "mentor" | "grammar" | "expressions" | "pick" | "videos" | "articles";
export type PageName =
  | "translate"
  | "dictionary"
  | "review"
  | "progress"
  | "settings"
  | "welcome"
  | "plan"
  | LearnPageName;

export type Progress =
  | { enabled: false }
  | {
      enabled: true;
      title: string;
      level: number;
      phrase: string;
      recovery: string | null;
      stats: string[];
      reviewLabel: string;
      metrics: ProgressMetrics;
      /** Absent while the goal ladder is hidden. */
      ladder?: { lines: string[]; nearest: string; rewards: string[] };
    };

export type MomentumBand = "resting" | "warming" | "steady" | "strong";

/** Raw numbers behind the Progress page; the web draws them, the bot keeps its text lines. */
export interface ProgressMetrics {
  band: MomentumBand;
  words: number;
  mature: number;
  due: number;
  /** Active days over the last 4 weeks. */
  activeDays: number;
  ladder?: {
    day: { reviews: number; target: number; done: boolean };
    week: { days: number; target: number; met: boolean };
    month: {
      activeDays: number;
      minActiveDays: number;
      mature: number;
      saved: number;
      minNewWords: number;
      counted: boolean;
    };
    cycleMonths: number;
    monthsForReward: number;
    rewardDays: number;
    milestone: { target: number; remaining: number } | null;
  };
}

/** The thin goal bar: the nearest step, or nothing while the ladder is hidden. */
export interface ProgressGoal {
  nearest: string | null;
  rewards: string[];
}

export interface LoaderPhrases {
  emoji: string[];
  stages: string[][];
}

export interface ClarificationOption {
  kind: "source_language" | "meaning" | "typo_correction" | "format" | "translate_as_written";
  label: string | null;
  value: string;
  langCode: string | null;
  correctedText: string | null;
}

/** What the server asks before it can translate, and the answers it accepts. */
export interface Clarification {
  message: string;
  sourceLang: string;
  options: ClarificationOption[];
  languages: string[];
}

export interface TranslateAnswer {
  sourceLang?: string;
  asWritten?: boolean;
  context?: string;
  clarify?: boolean;
  negativeConstraints?: Record<string, string[]>;
  addLanguage?: string;
}
