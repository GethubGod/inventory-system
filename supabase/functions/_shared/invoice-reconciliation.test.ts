import {
  matchInvoiceLine,
  normalizeInvoiceItemName,
  normalizeInvoiceUnit,
  reconcileInvoiceLines,
  supplierPriceKey,
} from "./invoice-reconciliation.ts";

const salmon = {
  id: "past-line-salmon",
  itemId: "item-salmon",
  itemName: "Salmon Fillet",
  quantity: 4,
  unit: "case",
  aliases: ["atlantic salmon"],
};

Deno.test("invoice reconciliation normalizes names and supplier units consistently", () => {
  if (
    normalizeInvoiceItemName("  Atlantic–Salmon (Fillets) ") !==
      "atlantic salmon fillets"
  ) {
    throw new Error("Expected punctuation and whitespace normalization");
  }
  if (normalizeInvoiceUnit("CS") !== "case") {
    throw new Error("Expected case alias normalization");
  }
});

Deno.test("invoice reconciliation matches aliases only against linked order lines", () => {
  const result = matchInvoiceLine("Atlantic Salmon", [salmon]);
  if (result.candidate?.id !== salmon.id || result.score < 0.95) {
    throw new Error("Expected alias match to linked order line");
  }

  const unmatched = matchInvoiceLine("Tuna loin", [salmon]);
  if (unmatched.candidate !== null) {
    throw new Error("Expected unrelated invoice line to remain unmatched");
  }
});

Deno.test("invoice reconciliation prefers confirmed history then falls back to ordered price", () => {
  const history = new Map([[supplierPriceKey("item-salmon", "case"), 22.5]]);
  const [fromHistory] = reconcileInvoiceLines({
    lines: [{
      rawName: "Salmon Fillet",
      quantity: 3,
      unit: "cs",
      unitPrice: 25,
      totalPrice: 75,
    }],
    candidates: [{ ...salmon, orderedUnitPrice: 20 }],
    latestPriceByItemAndUnit: history,
  });

  if (
    fromHistory.priceDelta !== 2.5 || fromHistory.quantityDelta !== -1 ||
    !fromHistory.priceMismatch || !fromHistory.quantityMismatch
  ) {
    throw new Error("Expected history price and ordered quantity deltas");
  }

  const [fromOrder] = reconcileInvoiceLines({
    lines: [{
      rawName: "Salmon Fillet",
      quantity: 4,
      unit: "case",
      unitPrice: 21,
      totalPrice: 84,
    }],
    candidates: [{ ...salmon, orderedUnitPrice: 20 }],
    latestPriceByItemAndUnit: new Map(),
  });
  if (fromOrder.priceDelta !== 1 || fromOrder.quantityDelta !== 0) {
    throw new Error(
      "Expected first invoice to use ordered price when available",
    );
  }
});
