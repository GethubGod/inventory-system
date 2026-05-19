/** Stable id so the welcome bubble is never duplicated or persisted as chat history. */
export const QUICK_ORDER_WELCOME_MESSAGE_ID = "quick-order-welcome-v1";

export const QUICK_ORDER_WELCOME_TITLE = "Welcome to Quick Order 👋";

export const QUICK_ORDER_WELCOME_BODY_PARAGRAPHS = [
  "Type your order the way you normally would — no special format needed.",
  "If anything is unclear, I'll ask a quick follow-up. As you use Quick Order more, I'll learn your usual ordering patterns and suggest common items to help you order faster.",
] as const;

export const QUICK_ORDER_WELCOME_TEXT = [
  QUICK_ORDER_WELCOME_TITLE,
  ...QUICK_ORDER_WELCOME_BODY_PARAGRAPHS,
].join("\n\n");

export type QuickOrderWelcomeMessage = {
  id: typeof QUICK_ORDER_WELCOME_MESSAGE_ID;
  role: "assistant";
  text: string;
  createdAt: string;
  source: "welcome";
};

export function createQuickOrderWelcomeMessage(): QuickOrderWelcomeMessage {
  return {
    id: QUICK_ORDER_WELCOME_MESSAGE_ID,
    role: "assistant",
    text: QUICK_ORDER_WELCOME_TEXT,
    createdAt: "1970-01-01T00:00:00.000Z",
    source: "welcome",
  };
}

export function isQuickOrderWelcomeMessage(message: {
  id?: string;
  source?: string;
}): boolean {
  return (
    message.id === QUICK_ORDER_WELCOME_MESSAGE_ID || message.source === "welcome"
  );
}

/**
 * Show the onboarding assistant bubble when the order list is empty and the
 * user has not sent any messages yet (including after a full clear).
 */
export function shouldShowQuickOrderWelcomeMessage(
  parsedItemCount: number,
  messages: Array<{ role: string }>,
): boolean {
  if (parsedItemCount > 0) return false;
  return !messages.some((message) => message.role === "user");
}

export function buildQuickOrderDisplayMessages<T extends { id: string }>(
  messages: T[],
  showWelcome: boolean,
  createWelcome: () => T,
): T[] {
  if (!showWelcome) return messages;
  if (messages.some((message) => isQuickOrderWelcomeMessage(message))) {
    return messages;
  }
  return [createWelcome(), ...messages];
}
