import {
  QUICK_ORDER_WELCOME_TEXT,
  buildQuickOrderDisplayMessages,
  createQuickOrderWelcomeMessage,
  isQuickOrderWelcomeMessage,
  shouldShowQuickOrderWelcomeMessage,
} from "../features/ordering/quickOrderWelcome";

describe("quickOrderWelcome", () => {
  test("uses the exact onboarding copy", () => {
    expect(QUICK_ORDER_WELCOME_TEXT).toContain("Welcome to Quick Order 👋");
    expect(QUICK_ORDER_WELCOME_TEXT).toContain(
      "Type your order the way you normally would — no special format needed.",
    );
    expect(QUICK_ORDER_WELCOME_TEXT).toContain(
      "I'll learn your usual ordering patterns",
    );
  });

  test("creates a stable assistant welcome message", () => {
    const message = createQuickOrderWelcomeMessage();
    expect(message.role).toBe("assistant");
    expect(message.source).toBe("welcome");
    expect(isQuickOrderWelcomeMessage(message)).toBe(true);
    expect(createQuickOrderWelcomeMessage().id).toBe(message.id);
  });

  test("shows welcome only when the order list is empty and the user has not typed", () => {
    expect(shouldShowQuickOrderWelcomeMessage(0, [])).toBe(true);
    expect(
      shouldShowQuickOrderWelcomeMessage(0, [{ role: "user" }]),
    ).toBe(false);
    expect(
      shouldShowQuickOrderWelcomeMessage(1, []),
    ).toBe(false);
    expect(
      shouldShowQuickOrderWelcomeMessage(0, [
        { role: "assistant" },
        { role: "user" },
      ]),
    ).toBe(false);
  });

  test("prepends welcome once for display without duplicating", () => {
    const welcome = createQuickOrderWelcomeMessage();
    const user = { id: "user-1", role: "user", text: "2 salmon" };

    expect(
      buildQuickOrderDisplayMessages([], true, createQuickOrderWelcomeMessage),
    ).toEqual([welcome]);
    expect(
      buildQuickOrderDisplayMessages(
        [user],
        false,
        createQuickOrderWelcomeMessage,
      ),
    ).toEqual([user]);
    expect(
      buildQuickOrderDisplayMessages(
        [welcome, user],
        true,
        createQuickOrderWelcomeMessage,
      ),
    ).toEqual([welcome, user]);
    expect(
      buildQuickOrderDisplayMessages(
        [],
        false,
        createQuickOrderWelcomeMessage,
      ),
    ).toEqual([]);
  });
});
