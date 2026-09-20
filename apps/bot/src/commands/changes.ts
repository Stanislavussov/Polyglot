import {
  buildAnnouncementText,
  findUnreleasedDir,
  isSupported,
  logger,
  pickNotesLang,
  readNotesForReader,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { BotContext } from "../types.js";

export function canUseChangesCommand(audienceGroup: string): boolean {
  return audienceGroup === "admin" || audienceGroup === "tester";
}

/**
 * The pending release notes, in the reader's language — the same queue the next
 * production deploy announces, so a tester can re-read what they were sent.
 */
export async function changesCommand(ctx: BotContext): Promise<void> {
  const user = ctx.user;
  if (!user || !canUseChangesCommand(user.audienceGroup)) {
    await ctx.reply("This command is available to testers and admins.");
    return;
  }

  try {
    const notesDir = findUnreleasedDir();
    if (!notesDir) throw new Error("Release notes directory not found");

    const settings = await ctx.services.userRepository.getSettings(user.id);
    const readerLangs = [settings?.interfaceLang, settings?.nativeLang];
    const notes = readNotesForReader(notesDir, readerLangs);

    if (notes.length === 0) {
      await ctx.reply("Nothing pending — the next release has no notes yet.");
      return;
    }

    const notesLang = pickNotesLang(notesDir, readerLangs);
    const headerLang: SupportedLang = isSupported(notesLang) ? notesLang : "en";
    const { text } = buildAnnouncementText(t("releaseNotesHeader", headerLang), notes);

    await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (err) {
    logger.error({ err }, "Failed to read release notes");
    await ctx.reply("Release notes are temporarily unavailable.");
  }
}
