import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { ArticleError } from "./errors.js";

export interface ExtractedArticle {
  title: string;
  siteName: string | null;
  /** Primary ISO 639-1 subtag the page declares, lowercased; null when it says nothing usable. */
  language: string | null;
  /** The article body as plain paragraphs separated by blank lines, capped at `maxWords`. */
  text: string;
  wordCount: number;
  /** True when the body was longer than the cap and only its beginning was kept. */
  truncated: boolean;
}

export interface ExtractArticleOptions {
  /** Every word sent onward is an input token; the beginning of a long read is enough to learn from. */
  maxWords?: number;
  /** Below this the page is a landing page, a paywall teaser or an error, not something to read. */
  minWords?: number;
}

const DEFAULT_MAX_WORDS = 1800;
const DEFAULT_MIN_WORDS = 80;

// Removed before Readability scores the page. Readability already penalises most
// of these, but a sidebar or a "related stories" rail with long teasers can
// outscore a short article; cutting them first makes the pick reliable.
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "video",
  "audio",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "nav",
  "aside",
  "footer",
  "dialog",
  "[role=navigation]",
  "[role=complementary]",
  "[role=contentinfo]",
  "[role=banner]",
  "[role=dialog]",
  "[role=alert]",
  "[aria-hidden=true]",
  "[hidden]",
].join(",");

const NOISE_TOKEN =
  /(?:^|[-_\s])(ads?|adv|advert\w*|adslot|banner|promo\w*|sponsor\w*|teaser|related|recommend\w*|more-stories|read-?more|outbrain|taboola|share|sharing|social|newsletter|subscri\w*|paywall|cookie\w*|consent|gdpr|popup|modal|overlay|comments?|disqus|sidebar|widget|breadcrumbs?|tags?|author-?bio|byline-?social|toolbar|masthead|site-?header|site-?footer|menu)(?:$|[-_\s\d])/i;

// Tags whose removal would take the article with it, whatever their class says.
const KEEP_TAGS = new Set(["HTML", "BODY", "MAIN", "ARTICLE"]);

// Page furniture that survives extraction on many sites. Each is matched against a
// whole paragraph, so a real sentence that merely mentions an ad or a photo stays.
const LABEL_LINE =
  /^(?:advertisement|advertising|sponsored( content)?|ad|anzeige|werbung|publicidad|publicité|pubblicità|reklama|реклама|партнерский материал|related( articles?| stories)?|share( this)?( article| story)?|поделиться|teilen|compartir|partager|getty images|reuters|ap|afp|loading\.*|загрузка\.*)$/i;
// Cross-links and credits: a label, a colon, then a headline or a name.
const LABELLED_LINE =
  /^(?:read (also|more|next)|see also|more on this|читайте (также|еще|ещё)|смотрите также|по теме|lesen sie auch|mehr zum thema|lee también|à lire aussi|leggi anche|přečtěte si také|photo|фото|foto|image|credit|source|источник|поделиться)\s*[:：—–-]/i;
// Calls to action are short; a long paragraph that opens with "Subscribe" is prose.
const CALL_TO_ACTION =
  /^(?:©|\(c\)|all rights reserved|все права защищены|subscribe|sign up|follow us|click here|подпиш|подпис|abonnieren|suscríbete|abonnez|we use cookies|this site uses cookies|мы используем cookie)/i;

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,dd,dt";
const DROP_IN_BODY = "pre,code,table,figure,figcaption,sup,math,kbd,samp,var";

function countWords(text: string): number {
  // Scripts written without spaces (zh, ja, th) count per character pair, so the cap still bites.
  const spaced = text.split(/\s+/).filter(Boolean).length;
  const unspaced = (text.match(/[぀-ヿ㐀-鿿฀-๿]/g) ?? []).length;
  return spaced + Math.ceil(unspaced / 2);
}

function normalizeSpace(text: string): string {
  return text
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryLang(value: string | null | undefined): string | null {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0];
  return code && /^[a-z]{2}$/.test(code) ? code : null;
}

// A class token is a hint, not proof: "ad-free-article" or "tags-and-body" wrappers
// hold the story itself. Several long paragraphs mean prose, which a rail of
// teasers or a share bar never has.
function holdsProse(node: Element): boolean {
  let long = 0;
  for (const p of Array.from(node.querySelectorAll("p"))) {
    if ((p.textContent ?? "").trim().length >= 120 && ++long >= 4) return true;
  }
  return false;
}

function stripNoise(document: Document): void {
  for (const node of Array.from(document.querySelectorAll(NOISE_SELECTORS))) node.remove();
  for (const node of Array.from(document.querySelectorAll("[class],[id]"))) {
    if (KEEP_TAGS.has(node.tagName) || !node.isConnected) continue;
    const tokens = `${node.getAttribute("class") ?? ""} ${node.getAttribute("id") ?? ""}`;
    if (!NOISE_TOKEN.test(tokens)) continue;
    if (node.querySelector("article,main,[itemprop=articleBody]") || holdsProse(node)) continue;
    node.remove();
  }
}

function isNoiseLine(line: string): boolean {
  if (LABEL_LINE.test(line) || LABELLED_LINE.test(line)) return true;
  if (CALL_TO_ACTION.test(line) && countWords(line) <= 25) return true;
  if (/^(https?:\/\/|www\.)\S+$/i.test(line)) return true;
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  // Menus of symbols, timestamps, share counters, "1 / 12" galleries.
  return letters < 2 || letters / line.length < 0.5;
}

/** Turns Readability's article HTML into clean paragraphs: no code, tables, captions or repeated lines. */
function toParagraphs(articleHtml: string): string[] {
  const { document } = parseHTML(`<!doctype html><html><body>${articleHtml}</body></html>`);
  for (const node of Array.from(document.querySelectorAll(DROP_IN_BODY))) node.remove();
  const blocks = Array.from(document.querySelectorAll(BLOCK_SELECTOR)).filter(
    (node) => !node.querySelector(BLOCK_SELECTOR),
  );
  const raw =
    blocks.length > 0 ? blocks.map((b) => b.textContent ?? "") : (document.body.textContent ?? "").split(/\n+/);

  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const chunk of raw) {
    const line = normalizeSpace(chunk);
    if (line.length === 0 || isNoiseLine(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(line);
  }
  return paragraphs;
}

/** "Headline — Site" → "Headline": the site is shown on its own. */
function withoutSiteName(title: string, siteName: string | null): string {
  if (!siteName) return title;
  for (const separator of [" — ", " – ", " - ", " | ", " · ", " :: "]) {
    const suffix = `${separator}${siteName}`;
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) return title.slice(0, -suffix.length).trim();
  }
  return title;
}

function cap(paragraphs: string[], maxWords: number): { kept: string[]; words: number; truncated: boolean } {
  const kept: string[] = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    const size = countWords(paragraph);
    if (words + size > maxWords) {
      // Always keep at least the opening paragraph, cut at a sentence end.
      if (kept.length === 0) {
        const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [paragraph];
        let partial = "";
        for (const sentence of sentences) {
          if (countWords(partial + sentence) > maxWords) break;
          partial += sentence;
        }
        kept.push(partial.trim() || paragraph);
        words = countWords(kept[0] ?? "");
      }
      return { kept, words, truncated: true };
    }
    kept.push(paragraph);
    words += size;
  }
  return { kept, words, truncated: false };
}

/**
 * Picks the article out of a whole web page — Readability over a pre-cleaned DOM,
 * then a paragraph pass that drops page furniture — and caps it to a token budget.
 * Throws `not_an_article` when nothing worth reading is left.
 */
export function extractArticle(html: string, pageUrl: string, options: ExtractArticleOptions = {}): ExtractedArticle {
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
  const minWords = options.minWords ?? DEFAULT_MIN_WORDS;
  const { document } = parseHTML(html);

  const meta = (selector: string) => normalizeSpace(document.querySelector(selector)?.getAttribute("content") ?? "");
  const declaredLang =
    primaryLang(document.documentElement?.getAttribute("lang")) ??
    primaryLang(meta("meta[property='og:locale']")) ??
    primaryLang(meta("meta[http-equiv='content-language']"));
  const ogTitle = meta("meta[property='og:title']");
  const ogSite = meta("meta[property='og:site_name']");

  stripNoise(document);
  // linkedom has no documentURI; Readability resolves relative links against it.
  Object.defineProperty(document, "documentURI", { value: pageUrl, configurable: true });
  Object.defineProperty(document, "baseURI", { value: pageUrl, configurable: true });
  const parsed = new Readability(document, { charThreshold: 200, keepClasses: false }).parse();
  if (!parsed?.content) throw new ArticleError("not_an_article", "No readable content");

  const paragraphs = toParagraphs(parsed.content);
  const siteName = normalizeSpace(parsed.siteName ?? "") || ogSite || null;
  const title = withoutSiteName(normalizeSpace(parsed.title ?? "") || ogTitle, siteName) || new URL(pageUrl).hostname;
  // Readability often keeps the headline as the first paragraph; it is already the title.
  if (paragraphs[0] && paragraphs[0].toLowerCase() === title.toLowerCase()) paragraphs.shift();

  const totalWords = paragraphs.reduce((sum, p) => sum + countWords(p), 0);
  if (totalWords < minWords) throw new ArticleError("not_an_article", `Only ${totalWords} words of body text`);

  const { kept, words, truncated } = cap(paragraphs, maxWords);
  return {
    title,
    siteName,
    language: declaredLang ?? primaryLang(parsed.lang),
    text: kept.join("\n\n"),
    wordCount: words,
    truncated,
  };
}
