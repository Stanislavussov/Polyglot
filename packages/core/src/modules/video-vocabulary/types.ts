export interface ExtractedPhrase {
  phrase: string;
  nativeTranslation: string;
  emoji: string;
  type: "word" | "phrase" | "idiom" | "collocation";
  level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  context: string;
  timestampSeconds: number;
}

export interface ExtractionResult {
  phrases: ExtractedPhrase[];
}
