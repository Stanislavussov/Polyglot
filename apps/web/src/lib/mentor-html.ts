const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * The mentor's answer as safe HTML. Its prompt asks for Telegram markup (<b>/<i>),
 * so those bare tags survive; everything else is escaped, since the text is model output.
 */
export function mentorHtml(answer: string): string {
  return answer.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char).replace(/&lt;(\/?)([bi])&gt;/g, "<$1$2>");
}
