import type {
  BlockedOperation,
  ParseResponse,
  Recommendation,
  SafetyWarning,
  StockOperation,
} from './types.ts';
import { formatQuantityWithUnit } from './units.ts';

export function buildProcessMessages(input: {
  parseResponse: ParseResponse;
  stockUpdates: StockOperation[];
  recommendations: Recommendation[];
  safetyWarnings: SafetyWarning[];
  blockedOperations: BlockedOperation[];
}): { displayMessage: string; speechMessage: string } {
  const blocked = input.blockedOperations[0];
  if (blocked) {
    const successSummary = formatParseSuccessSummary(input.parseResponse);
    if (successSummary) {
      const message = `${successSummary} ${blocked.message}`;
      return {
        displayMessage: message,
        speechMessage: shorten(message),
      };
    }
    return {
      displayMessage: blocked.message,
      speechMessage: shorten(blocked.message),
    };
  }

  const warning = input.safetyWarnings.find((entry) => entry.severity !== 'info');
  if (warning) {
    const successSummary = formatParseSuccessSummary(input.parseResponse);
    if (successSummary) {
      const message = `${successSummary} ${warning.message}`;
      return {
        displayMessage: message,
        speechMessage: shorten(message),
      };
    }
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
  return formatQuantityWithUnit(quantity, unit);
}

function formatItemCount(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

function formatParseSuccessSummary(response: ParseResponse): string | null {
  const readyItems = response.parsed_items.filter((item) => !item.needs_clarification && !item.unresolved);
  const readyCount = readyItems.length;
  const reviewCount = response.parsed_items.length - readyCount;
  if (readyCount <= 0 && reviewCount <= 0) return null;
  const parts: string[] = [];
  if (readyCount === 1) {
    const item = readyItems[0];
    const name = item.display_name ?? item.item_name ?? item.raw_token ?? 'Item';
    parts.push(`Added ${name} ${formatQuantity(item.quantity ?? 0, item.unit)}.`);
  } else if (readyCount > 0) {
    parts.push(`Added ${formatItemCount(readyCount)}.`);
  }
  if (reviewCount > 0) parts.push(`Review ${formatItemCount(reviewCount)}.`);
  return parts.join(' ');
}

function shorten(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
