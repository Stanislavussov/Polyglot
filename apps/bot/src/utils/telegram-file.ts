/**
 * Download the bytes behind a Telegram `file_id` (Task 80, voice input).
 *
 * Telegram serves file *content* from `/file/bot<token>/<path>`, which is not a
 * Bot API method — grammY has no wrapper for it, so this is a bare HTTP GET. It
 * is routed through the SAME `fetch` and `apiRoot` the bot's `Api` was built
 * with (`createPolyglotBot({ fetch })`), so the integration harness intercepts
 * the download exactly like every other outbound Telegram call, and a local Bot
 * API server keeps serving its own files.
 */
import type { Api } from "grammy";

const DEFAULT_API_ROOT = "https://api.telegram.org";

/** Fetches the file the given `file_id` points at. Throws on a non-2xx response. */
export async function downloadTelegramFile(api: Api, fileId: string): Promise<Uint8Array> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error(`Telegram returned no file_path for file_id ${fileId}`);
  }
  const root = api.options?.apiRoot ?? DEFAULT_API_ROOT;
  const request = api.options?.fetch ?? fetch;
  const response = await request(`${root}/file/bot${api.token}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
