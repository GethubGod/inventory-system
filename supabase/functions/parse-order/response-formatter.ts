import type {
  BlockedOperation,
  ParseResponse,
  Recommendation,
  SafetyWarning,
  StockOperation,
} from './types.ts';

export function buildProcessMessages(input: {
  parseResponse: ParseResponse;
  stockUpdates: StockOperation[];
  recommendations: Recommendation[];
  safetyWarnings: SafetyWarning[];
  blockedOperations: BlockedOperation[];
}): { displayMessage: string; speechMessage: string } {
  const blocked = input.blockedOperations[0];
  if (blocked) {
    return {
      displayMessage: blocked.message,
      speechMessage: shorten(blocked.message),
    };
  }

  const warning = input.safetyWarnings.find((entry) => entry.severity !== 'info');
  if (warning) {
    return {
      displayMessage: warning.message,
      speechMessage: shorten(warning.message),
    };
  }

  if (input.stockUpdates.length > 0 && input.recommendations.length > 0) {
    const stockLabel = input.stockUpdates.length === 1
      ? input.stockUpdates[0].item_name
      : `${input.stockUpdates.length} stock counts`;
    const recLabel = input.recommendations.length === 1
      ? `${input.recommendations[0].suggested_quantity} ${input.recommendations[0].unit ?? ''} ${input.recommendations[0].item_name}`.trim()
      : `${input.recommendations.length} order suggestions`;
    const message = `Stock updated for ${stockLabel}. I suggest ${recLabel}.`;
    return { displayMessage: message, speechMessage: shorten(message) };
  }

  if (input.stockUpdates.length > 0) {
    const message = input.stockUpdates.length === 1
      ? `Updated ${input.stockUpdates[0].item_name} to ${formatQuantity(input.stockUpdates[0].quantity, input.stockUpdates[0].unit)} on hand.`
      : `Updated ${input.stockUpdates.length} stock counts.`;
    return { displayMessage: message, speechMessage: shorten(message) };
  }

  if (input.recommendations.length > 0) {
    const first = input.recommendations[0];
    const message = input.recommendations.length === 1
      ? `I suggest ${formatQuantity(first.suggested_quantity, first.unit)} ${first.item_name}.`
      : `I found ${input.recommendations.length} order suggestions.`;
    return { displayMessage: message, speechMessage: shorten(message) };
  }

  const fallback = input.parseResponse.assistant_message ?? input.parseResponse.reply_text;
  return {
    displayMessage: fallback,
    speechMessage: shorten(fallback),
  };
}

function formatQuantity(quantity: number, unit: string | null): string {
  return `${quantity}${unit ? ` ${unit}` : ''}`;
}

function shorten(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
