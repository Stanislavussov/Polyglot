import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { logger } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";

const MAX_TELEGRAM_TEXT_LENGTH = 3900;

export function canUseChangesCommand(audienceGroup: string): boolean {
  return audienceGroup === "admin" || audienceGroup === "tester";
}

function findChangelogPath(startDir = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = resolve(dir, "CHANGELOG.md");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function formatDeliveredChanges(changelog: string): string {
  const lines = changelog.split(/\r?\n/);
  const firstSectionIndex = lines.findIndex((line) => line.startsWith("## "));
  const body = (firstSectionIndex >= 0 ? lines.slice(firstSectionIndex) : lines).join("\n").trim();

  if (!body) {
    return "No delivered changes are documented yet.";
  }

  return `Delivered changes\n\n${body}`;
}

export function splitTelegramText(text: string): string[] {
  if (text.length <= MAX_TELEGRAM_TEXT_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_TELEGRAM_TEXT_LENGTH) {
    const slice = remaining.slice(0, MAX_TELEGRAM_TEXT_LENGTH);
    const splitAt = Math.max(slice.lastIndexOf("\n## "), slice.lastIndexOf("\n- "), slice.lastIndexOf("\n\n"));
    const cut = splitAt > 0 ? splitAt : MAX_TELEGRAM_TEXT_LENGTH;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function readDeliveredChanges(): Promise<string> {
  const changelogPath = findChangelogPath();
  if (!changelogPath) {
    throw new Error("CHANGELOG.md not found");
  }

  const changelog = await readFile(changelogPath, "utf8");
  return formatDeliveredChanges(changelog);
}

export async function changesCommand(ctx: BotContext): Promise<void> {
  const user = ctx.user;
  if (!user || !canUseChangesCommand(user.audienceGroup)) {
    await ctx.reply("This command is available to testers and admins.");
    return;
  }

  try {
    const message = await readDeliveredChanges();
    for (const chunk of splitTelegramText(message)) {
      const msg = await ctx.reply(chunk);
      trackTechnicalMessage(ctx, msg.message_id);
    }
  } catch (err) {
    logger.error({ err }, "Failed to read delivered changes");
    const msg = await ctx.reply("Delivered changes are temporarily unavailable.");
    trackTechnicalMessage(ctx, msg.message_id);
  }
}
