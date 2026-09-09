/**
 * Port interface for Video Vocabulary Repository.
 */

export interface VideoProcess {
  id: number;
  userId: number;
  videoId: string;
  videoUrl: string;
  title: string | null;
  durationSeconds: number | null;
  language: string;
  transcriptType: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoPhrase {
  id: number;
  videoProcessId: number;
  phrase: string;
  nativeTranslation: string | null;
  emoji: string | null;
  phraseType: string | null;
  level: string | null;
  context: string | null;
  timestampSeconds: number | null;
  sortOrder: number;
  savedEntryId: number | null;
  createdAt: Date;
}

export interface CreateVideoProcessInput {
  userId: number;
  videoId: string;
  videoUrl: string;
  title?: string;
  durationSeconds?: number;
  language: string;
  transcriptType?: string;
  /** The one-off onboarding trial video — excluded from the plan allowance. */
  isTrial?: boolean;
}

export interface SaveVideoPhraseInput {
  phrase: string;
  nativeTranslation?: string;
  phraseType?: string;
  level?: string;
  context?: string;
  timestampSeconds?: number;
  sortOrder: number;
}

export interface VideoVocabularyRepository {
  createProcess(input: CreateVideoProcessInput): Promise<VideoProcess>;
  updateProcessStatus(
    processId: number,
    status: "pending" | "processing" | "completed" | "failed",
    errorMessage?: string,
  ): Promise<void>;
  /** Language on create is a guess from user settings; refine it once the real transcript language is known. */
  updateProcessLanguage(processId: number, language: string): Promise<void>;
  expireStaleProcesses(maxAgeMinutes: number): Promise<number>;
  findProcessById(processId: number): Promise<VideoProcess | null>;
  findProcessByUserAndVideo(userId: number, videoId: string): Promise<VideoProcess | null>;
  findProcessesByUser(
    userId: number,
    page?: number,
    pageSize?: number,
    excludeFailed?: boolean,
  ): Promise<VideoProcess[]>;
  countProcessesByUser(userId: number, excludeFailed?: boolean): Promise<number>;
  /** Completed videos this month, excluding the onboarding trial. */
  getMonthlyUsageCount(userId: number, yearMonth: string): Promise<number>;
  /** Completed videos since `since`, excluding the onboarding trial. */
  getLifetimeUsageCount(userId: number, since: Date): Promise<number>;
  /** Whether the user has already spent their one free onboarding trial video. */
  hasCompletedTrial(userId: number): Promise<boolean>;
  savePhrases(processId: number, phrases: SaveVideoPhraseInput[]): Promise<void>;
  findPhrasesByProcess(processId: number, offset?: number, limit?: number): Promise<VideoPhrase[]>;
  countPhrasesByProcess(processId: number): Promise<number>;
  findPhraseById(phraseId: number): Promise<VideoPhrase | null>;
  markPhraseSaved(phraseId: number, entryId: number): Promise<void>;
  findKnownPhrasesByUser(userId: number, language: string, excludeProcessId?: number): Promise<string[]>;
  findCachedTranscript(
    videoId: string,
    language: string,
  ): Promise<{ transcript: string; transcriptType: string | null } | null>;
  cacheTranscript(videoId: string, language: string, transcript: string, transcriptType?: string): Promise<void>;
}
