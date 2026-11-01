import type { SessionData } from "../types.js";

/**
 * Drops every "waiting for your next message" flag. An entry point that moves the
 * user somewhere new (a hot button, `/check`, `/mentor`) runs past the mode router,
 * which is where these are consumed — left armed, the user's next message is
 * swallowed by the flow they walked away from: filed as a notification context,
 * the name of a new dictionary, clarification for an old card, or a mentor
 * question about it.
 */
export function disarmPendingPrompts(session: SessionData): void {
  session.awaitingNotifContext = false;
  session.dictionaryWizard = undefined;
  session.awaitingTranslationClarificationContext = undefined;
  session.pendingCardMentorAsk = undefined;
}
