/** Why a link could not become an article. `code` is what the web route hands the client. */
export type ArticleErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "fetch_failed"
  | "too_large"
  | "not_html"
  | "not_an_article";

export class ArticleError extends Error {
  constructor(
    readonly code: ArticleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArticleError";
  }
}
