export interface TranslateInputEntity {
  type: string;
  offset: number;
  length: number;
}

export interface ParsedTranslateInput {
  text: string;
  contextHint?: string;
}

const HASHTAG_TOKEN = /^#[\p{L}\p{N}_]+$/u;
const TRAILING_HASHTAGS = /(?:^|\s)(#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*)\s*$/u;
const FREEFORM_SEPARATOR = /\s+::\s+/u;

export function parseTranslateInput(text: string, entities?: readonly TranslateInputEntity[]): ParsedTranslateInput {
  const freeformParsed = parseFreeformContext(text);
  if (freeformParsed) {
    return freeformParsed;
  }

  const entityParsed = entities ? parseFromEntities(text, entities) : undefined;
  if (entityParsed) {
    return entityParsed;
  }

  return parseWithFallback(text);
}

function parseFreeformContext(text: string): ParsedTranslateInput | undefined {
  const match = FREEFORM_SEPARATOR.exec(text);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const contextStart = match.index + match[0].length;
  const cleanText = text.slice(0, match.index).trim();
  const contextHint = text.slice(contextStart).trim();

  if (contextHint.length === 0) {
    return { text: text.trim() };
  }

  return { text: cleanText, contextHint };
}

function parseFromEntities(text: string, entities: readonly TranslateInputEntity[]): ParsedTranslateInput | undefined {
  const hashtags = entities
    .filter((entity) => entity.type === "hashtag")
    .map((entity) => ({
      start: entity.offset,
      end: entity.offset + entity.length,
      token: text.slice(entity.offset, entity.offset + entity.length),
    }))
    .filter((entity) => HASHTAG_TOKEN.test(entity.token))
    .sort((a, b) => a.start - b.start);

  if (hashtags.length === 0) {
    return undefined;
  }

  let currentEnd = trimWhitespaceLeft(text, text.trimEnd().length);
  const markers: string[] = [];

  while (currentEnd > 0) {
    const trailing = hashtags.find((entity) => entity.end === currentEnd);
    if (!trailing) {
      break;
    }

    markers.unshift(trailing.token);
    currentEnd = trimWhitespaceLeft(text, trailing.start);
  }

  if (markers.length === 0) {
    return undefined;
  }

  return buildParsed(text.slice(0, currentEnd), markers);
}

function parseWithFallback(text: string): ParsedTranslateInput {
  const match = TRAILING_HASHTAGS.exec(text);
  if (!match || match.index === undefined) {
    return { text: text.trim() };
  }

  const markerGroup = match[1];
  if (!markerGroup) {
    return { text: text.trim() };
  }

  const markers = markerGroup.split(/\s+/u);
  return buildParsed(text.slice(0, match.index), markers);
}

function buildParsed(text: string, markers: readonly string[]): ParsedTranslateInput {
  const contextHint = markers.map(formatMarker).join(", ");
  const cleanText = text.trim();

  return contextHint ? { text: cleanText, contextHint } : { text: cleanText };
}

function formatMarker(marker: string): string {
  return marker.slice(1).replaceAll("_", " ");
}

function trimWhitespaceLeft(text: string, end: number): number {
  let index = end;
  while (index > 0 && /\s/u.test(text[index - 1] ?? "")) {
    index -= 1;
  }
  return index;
}
