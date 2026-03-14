# AI Adapter (pattern)

Switching provider without changing business logic:

```tsx
// ai.interface.ts
interface AIAdapter {
  translateWord(params: TranslateParams): Promise<TranslationResult>;
  generateTopic(params: GenerateTopicParams): Promise<TopicResult>;
  suggestWord(params: SuggestWordParams): Promise<SuggestResult>;
  validateTranslation(params: ValidateParams): Promise<ValidationResult>; // only when flagged
}

// config.ts — provider selection via ENV or will be used from AI-SDK (pi.dev)
const AI_PROVIDER = process.env.AI_PROVIDER; // "openai" | "claude" | "gemini"
```
