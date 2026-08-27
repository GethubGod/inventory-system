import { describe, expect, it } from "vitest";
import { parseLocalUtterance, type KnownFieldState } from "../localVoiceParse";
import type { RosterPerson } from "../api";

const ROSTER: RosterPerson[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Maria Lopez", scheduled: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "Tom Chen", scheduled: false },
  { id: "33333333-3333-4333-8333-333333333333", name: "Ken Watanabe", scheduled: false },
  { id: "44444444-4444-4444-8444-444444444444", name: "Lena Park", scheduled: false },
];
const [MARIA, TOM, KEN, LENA] = ROSTER;

function known(overrides: Partial<KnownFieldState> = {}): KnownFieldState {
  return { cash: null, card: null, lastAmountField: null, people: [], ...overrides };
}

describe("amounts", () => {
  it("bare number fills the first empty field (cash first)", () => {
    const r = parseLocalUtterance("fifty", ROSTER, known());
    expect(r.cash.value).toBe(50);
    expect(r.card.value).toBeNull();
  });

  it("bare number goes to card when cash is already known", () => {
    const r = parseLocalUtterance("seventy", ROSTER, known({ cash: 50 }));
    expect(r.cash.value).toBeNull();
    expect(r.card.value).toBe(70);
  });

  it("two bare numbers fill cash then card in spoken order", () => {
    const r = parseLocalUtterance("fifty and seventy", ROSTER, known());
    expect(r.cash.value).toBe(50);
    expect(r.card.value).toBe(70);
  });

  it("named field wins: 'seventy for cash'", () => {
    const r = parseLocalUtterance("seventy for cash", ROSTER, known());
    expect(r.cash.value).toBe(70);
    expect(r.card.value).toBeNull();
    expect(r.cash.confidence).toBeGreaterThan(0.9);
  });

  it("'cash is fifty card is sixty'", () => {
    const r = parseLocalUtterance("cash is fifty card is sixty", ROSTER, known());
    expect(r.cash.value).toBe(50);
    expect(r.card.value).toBe(60);
  });

  it("'credit' maps to card", () => {
    const r = parseLocalUtterance("one twenty on credit", ROSTER, known());
    expect(r.card.value).toBe(120);
  });

  it("digit transcripts with dollars and decimals", () => {
    const r = parseLocalUtterance("cash 126.50 card $80", ROSTER, known());
    expect(r.cash.value).toBe(126.5);
    expect(r.card.value).toBe(80);
  });

  it("'three fifty' reads as 350", () => {
    const r = parseLocalUtterance("three fifty on card", ROSTER, known());
    expect(r.card.value).toBe(350);
  });

  it("'fifty point five' handles decimals", () => {
    const r = parseLocalUtterance("fifty point five cash", ROSTER, known());
    expect(r.cash.value).toBe(50.5);
  });

  it("'one hundred and five dollars cash'", () => {
    const r = parseLocalUtterance("one hundred and five dollars cash", ROSTER, known());
    expect(r.cash.value).toBe(105);
  });

  it("correction retargets the last voice-set amount field", () => {
    const r = parseLocalUtterance(
      "actually seventy",
      ROSTER,
      known({ cash: 50, card: 60, lastAmountField: "card" }),
    );
    expect(r.card.value).toBe(70);
    expect(r.cash.value).toBeNull();
  });

  it("correction with a named field: 'no wait eighty for cash'", () => {
    const r = parseLocalUtterance(
      "no wait eighty for cash",
      ROSTER,
      known({ cash: 50, card: 60, lastAmountField: "card" }),
    );
    expect(r.cash.value).toBe(80);
    expect(r.card.value).toBeNull();
  });

  it("rejects absurd amounts", () => {
    const r = parseLocalUtterance("cash 12345678", ROSTER, known());
    expect(r.cash.value).toBeNull();
  });
});

describe("meal", () => {
  it("hears lunch and dinner", () => {
    expect(parseLocalUtterance("lunch", ROSTER, known()).meal.value).toBe("lunch");
    expect(parseLocalUtterance("it was dinner", ROSTER, known()).meal.value).toBe("dinner");
  });

  it("meal rides along with amounts", () => {
    const r = parseLocalUtterance("dinner cash fifty card seventy", ROSTER, known());
    expect(r.meal.value).toBe("dinner");
    expect(r.cash.value).toBe(50);
    expect(r.card.value).toBe(70);
  });
});

describe("people", () => {
  it("matches first names against the roster", () => {
    const r = parseLocalUtterance("maria and tom closed", ROSTER, known());
    expect(r.people.matched.map((p) => p.id).sort()).toEqual(
      [MARIA.id, TOM.id].sort(),
    );
  });

  it("spoken names ADD to the known selection", () => {
    const r = parseLocalUtterance(
      "and ken",
      ROSTER,
      known({ people: [{ id: MARIA.id, name: MARIA.name }] }),
    );
    expect(r.people.matched.map((p) => p.id).sort()).toEqual(
      [MARIA.id, KEN.id].sort(),
    );
  });

  it("'not maria' removes from the selection", () => {
    const r = parseLocalUtterance(
      "not maria",
      ROSTER,
      known({
        people: [
          { id: MARIA.id, name: MARIA.name },
          { id: TOM.id, name: TOM.name },
        ],
      }),
    );
    expect(r.people.matched.map((p) => p.id)).toEqual([TOM.id]);
  });

  it("'everyone' selects the whole roster", () => {
    const r = parseLocalUtterance("everyone closed tonight", ROSTER, known());
    expect(r.people.matched).toHaveLength(ROSTER.length);
  });

  it("a name that is also nothing else stays out of amounts", () => {
    const r = parseLocalUtterance("lena fifty", ROSTER, known());
    expect(r.people.matched.map((p) => p.id)).toEqual([LENA.id]);
    expect(r.cash.value).toBe(50);
  });

  it("no people mentioned → people untouched (no-op merge)", () => {
    const r = parseLocalUtterance("cash fifty", ROSTER, known());
    expect(r.people.matched).toHaveLength(0);
    expect(r.people.confidence).toBe(0);
  });
});

describe("kitchen sink", () => {
  it("one breath: 'dinner cash fifty card one twenty maria and tom'", () => {
    const r = parseLocalUtterance(
      "dinner cash fifty card one twenty maria and tom",
      ROSTER,
      known(),
    );
    expect(r.meal.value).toBe("dinner");
    expect(r.cash.value).toBe(50);
    expect(r.card.value).toBe(120);
    expect(r.people.matched.map((p) => p.id).sort()).toEqual(
      [MARIA.id, TOM.id].sort(),
    );
  });

  it("empty and junk utterances parse to nothing", () => {
    const empty = parseLocalUtterance("", ROSTER, known());
    expect(empty.cash.value).toBeNull();
    const junk = parseLocalUtterance("um okay so anyway", ROSTER, known());
    expect(junk.cash.value).toBeNull();
    expect(junk.meal.value).toBeNull();
    expect(junk.people.matched).toHaveLength(0);
  });
});
