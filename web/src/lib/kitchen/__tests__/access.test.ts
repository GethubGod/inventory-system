import { describe, expect, it } from "vitest";
import {
  availableViews,
  canSwitchLocation,
  isKitchenView,
  resolveLocation,
  resolveView,
} from "../access";

const sushi = { id: "sushi", name: "Babytuna Sushi", active: true };
const poki = { id: "poki", name: "Babytuna Poki & Pho", active: true };
const closed = { id: "closed", name: "Old store", active: false };

describe("resolveView", () => {
  it("returns null when neither module is on", () => {
    expect(
      resolveView({ kitchen_requests: false, kitchen_display: false }, "chef"),
    ).toBeNull();
    expect(
      availableViews({ kitchen_requests: false, kitchen_display: false }),
    ).toEqual([]);
  });

  it("returns the only allowed view regardless of what was remembered", () => {
    expect(
      resolveView({ kitchen_requests: false, kitchen_display: true }, "chef"),
    ).toBe("kitchen");
    expect(
      resolveView(
        { kitchen_requests: true, kitchen_display: false },
        "kitchen",
      ),
    ).toBe("chef");
  });

  it("honours the remembered view when both are allowed, defaulting to chef", () => {
    const both = { kitchen_requests: true, kitchen_display: true };
    expect(resolveView(both, "kitchen")).toBe("kitchen");
    expect(resolveView(both, null)).toBe("chef");
    expect(availableViews(both)).toEqual(["chef", "kitchen"]);
  });

  it("isKitchenView rejects junk", () => {
    expect(isKitchenView("chef")).toBe(true);
    expect(isKitchenView("display")).toBe(false);
    expect(isKitchenView(null)).toBe(false);
  });
});

describe("resolveLocation", () => {
  it("a works-at location on the account wins over the remembered choice", () => {
    expect(resolveLocation("poki", [sushi, poki], "sushi")).toEqual(poki);
    expect(canSwitchLocation("poki", [sushi, poki])).toBe(false);
  });

  it("falls back to the remembered active location", () => {
    expect(resolveLocation(null, [sushi, poki], "sushi")).toEqual(sushi);
    expect(resolveLocation(null, [sushi, poki, closed], "closed")).toBeNull();
    expect(canSwitchLocation(null, [sushi, poki])).toBe(true);
  });

  it("needs no choice with a single active location", () => {
    expect(resolveLocation(null, [sushi, closed], null)).toEqual(sushi);
    expect(canSwitchLocation(null, [sushi, closed])).toBe(false);
  });

  it("asks when nothing decides it", () => {
    expect(resolveLocation(null, [sushi, poki], null)).toBeNull();
    expect(resolveLocation("closed", [sushi, poki, closed], null)).toBeNull();
    expect(resolveLocation(null, [], null)).toBeNull();
  });
});
