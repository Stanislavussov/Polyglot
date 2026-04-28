/**
 * TranslationTemplate Repository Port.
 */
import type { TemplateFields } from "../shared/translation-template.types.js";

export interface SavedTranslationTemplate {
  id: number;
  userId: number;
  name: string;
  fields: TemplateFields;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranslationTemplateRepository {
  getByUserId(userId: number): Promise<SavedTranslationTemplate | null>;
  upsert(userId: number, name: string, fields: TemplateFields): Promise<SavedTranslationTemplate>;
  deleteByUserId(userId: number): Promise<void>;
}
