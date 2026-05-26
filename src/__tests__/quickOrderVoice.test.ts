jest.mock('expo-file-system/legacy', () => ({
  deleteAsync: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}));

import { supabase } from '@/lib/supabase';
import {
  formatQuickOrderVoiceText,
  normalizeVoiceQuantity,
} from '../../supabase/functions/quick-order-voice-parse/formatting.ts';
import { verifyVoiceActions } from '../../supabase/functions/quick-order-voice-parse/structured-actions.ts';
import { parseDeterministicOrder } from '../../supabase/functions/parse-order/deterministic-parser.ts';
import {
  isQuickOrderVoiceTooShort,
  reduceQuickOrderVoiceState,
  transcribeQuickOrderVoiceFile,
} from '../features/ordering/quickOrderVoice';

const mockedGetSession = supabase.auth.getSession as jest.Mock;

class TestFormData {
  fields: [string, unknown][] = [];

  append(name: string, value: unknown) {
    this.fields.push([name, value]);
  }
}

describe('Quick Order voice state machine', () => {
  const originalFetch = global.fetch;
  const OriginalFormData = global.FormData;

  const idle = {
    status: 'idle' as const,
    uploadInFlight: false,
    errorCode: null,
  };

  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
    });
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
    (global as unknown as { FormData: typeof FormData }).FormData =
      TestFormData as unknown as typeof FormData;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
    global.FormData = OriginalFormData;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  });

  it('moves idle -> recording -> transcribing -> review_ready -> adding_to_order -> added', () => {
    const recording = reduceQuickOrderVoiceState(idle, 'start');
    expect(recording).toMatchObject({ status: 'recording', uploadInFlight: false });

    const transcribing = reduceQuickOrderVoiceState(recording, 'stop');
    expect(transcribing).toMatchObject({ status: 'transcribing', uploadInFlight: true });

    const reviewReady = reduceQuickOrderVoiceState(transcribing, 'review_ready');
    expect(reviewReady).toMatchObject({ status: 'review_ready', uploadInFlight: false, errorCode: null });

    const adding = reduceQuickOrderVoiceState(reviewReady, 'add_to_order');
    expect(adding).toMatchObject({ status: 'adding_to_order', uploadInFlight: false });

    const added = reduceQuickOrderVoiceState(adding, 'added');
    expect(added).toMatchObject({ status: 'added', uploadInFlight: false });
  });

  it('moves idle -> recording -> cancelled', () => {
    const recording = reduceQuickOrderVoiceState(idle, 'start');
    const cancelled = reduceQuickOrderVoiceState(recording, 'cancel');
    expect(cancelled).toMatchObject({ status: 'cancelled', uploadInFlight: false });
  });

  it('moves idle -> recording -> failed', () => {
    const recording = reduceQuickOrderVoiceState(idle, 'start');
    const failed = reduceQuickOrderVoiceState(recording, 'process_failed', 'MODEL_FAILED');
    expect(failed).toMatchObject({
      status: 'failed',
      uploadInFlight: false,
      errorCode: 'MODEL_FAILED',
    });
  });

  it('prevents duplicate uploads while processing', () => {
    const transcribing = reduceQuickOrderVoiceState(
      reduceQuickOrderVoiceState(idle, 'start'),
      'stop',
    );
    expect(reduceQuickOrderVoiceState(transcribing, 'start')).toBe(transcribing);
  });

  it('detects recordings under the minimum duration', () => {
    expect(isQuickOrderVoiceTooShort(699)).toBe(true);
    expect(isQuickOrderVoiceTooShort(700)).toBe(false);
  });

  it('returns the server-formatted normalized text from upload responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        rawTranscript: 'ground garlic one pack edamame one case',
        normalizedText: 'Ground garlic 1 pack\nEdamame 1 cs',
        detectedLanguages: ['en'],
        modelUsed: 'gemini-2.5-flash',
        fallbackUsed: false,
        latencyMs: 1200,
        voiceEventId: 'voice-event-id',
        warnings: [],
        confidence: 0.9,
        needsReview: false,
        actions: [{
          type: 'add',
          itemId: 'garlic-id',
          itemName: 'Ground garlic',
          canonicalItemName: 'Ground garlic',
          spokenItemName: 'ground garlic',
          quantity: 1,
          unit: 'pack',
          confidence: 0.9,
          catalogMatchConfidence: 1,
          sourceText: 'ground garlic one pack',
        }],
        unresolved: [],
        source: 'upload',
      }),
    });

    const result = await transcribeQuickOrderVoiceFile({
      uri: 'file:///voice.m4a',
      durationMs: 1200,
      locationId: 'location-id',
      userId: 'user-id',
      sessionId: null,
      mode: 'order',
      existingItems: [],
      recentMessages: [],
    });

    expect(result).toMatchObject({
      success: true,
      normalizedText: 'Ground garlic 1 pack\nEdamame 1 cs',
      source: 'upload',
      actions: [{
        type: 'add',
        itemId: 'garlic-id',
        quantity: 1,
        unit: 'pack',
      }],
    });
  });

  it('times out voice uploads instead of leaving transcription busy forever', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockImplementation((_url, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const pending = transcribeQuickOrderVoiceFile({
      uri: 'file:///voice.m4a',
      durationMs: 1200,
      locationId: 'location-id',
      userId: 'user-id',
      sessionId: null,
      mode: 'order',
      existingItems: [],
      recentMessages: [],
    });

    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(45_000);
    await Promise.resolve();
    await expect(pending).resolves.toMatchObject({
      success: false,
      errorCode: 'NETWORK_ERROR',
      message: 'Voice cleanup took too long. Try again with a shorter order.',
      retryable: true,
    });
  });
});

describe('Quick Order voice text formatter', () => {
  const catalog = [
    { id: 'garlic-id', name: 'Ground garlic' },
    { id: 'edamame-id', name: 'Edamame' },
    { id: 'clam-id', name: 'Red Clam' },
  ];

  it('formats simple item quantity unit lines', () => {
    const result = formatQuickOrderVoiceText({
      catalog,
      actions: [
        {
          type: 'order',
          itemName: 'Ground garlic',
          matchedItemId: 'garlic-id',
          spokenItemText: 'ground garlic',
          quantity: 1,
          unit: 'pack',
          confidence: 0.92,
        },
        {
          type: 'order',
          itemName: 'Edamame',
          matchedItemId: 'edamame-id',
          spokenItemText: 'edamame',
          quantity: 1,
          unit: 'case',
          confidence: 0.9,
        },
      ],
    });

    expect(result.text).toBe('Ground garlic 1 pack\nEdamame 1 cs');
    expect(result.safeLineCount).toBe(2);
  });

  it('prefers catalog names for high-confidence matches', () => {
    const result = formatQuickOrderVoiceText({
      catalog,
      actions: [{
        type: 'order',
        itemName: 'red clam',
        matchedItemId: 'clam-id',
        spokenItemText: 'read clam',
        quantity: 1.5,
        unit: 'bags',
        confidence: 0.88,
      }],
    });

    expect(result.text).toBe('Red Clam 1.5 bags');
  });

  it('preserves unknown spoken lines for manual correction', () => {
    const result = formatQuickOrderVoiceText({
      catalog,
      actions: [{
        type: 'unknown',
        spokenItemText: 'canadian clam',
        quantity: 1,
        unit: 'pack',
        confidence: 0.42,
      }],
    });

    expect(result.text).toBe('canadian clam 1 pack');
    expect(result.safeLineCount).toBe(0);
  });

  it('normalizes mixed fractions to parser-friendly decimals', () => {
    expect(normalizeVoiceQuantity('1 1/2')).toBe('1.5');
    expect(normalizeVoiceQuantity('one and a half')).toBe('1.5');
  });

  it('produces multiline text that the deterministic parser can read', () => {
    const result = formatQuickOrderVoiceText({
      catalog,
      actions: [
        {
          type: 'order',
          matchedItemId: 'garlic-id',
          spokenItemText: 'ground garlic',
          quantity: 'one',
          unit: 'pack',
          confidence: 0.9,
        },
        {
          type: 'order',
          matchedItemId: 'clam-id',
          spokenItemText: 'red clam',
          quantity: '1 1/2',
          unit: 'bags',
          confidence: 0.85,
        },
      ],
    });

    expect(result.lines).toEqual([
      'Ground garlic 1 pack',
      'Red Clam 1.5 bags',
    ]);
    expect(parseDeterministicOrder(result.text).map((line) => [
      line.item_text,
      line.quantity,
      line.unit,
    ])).toEqual([
      ['Ground garlic', 1, 'pack'],
      ['Red Clam', 1.5, 'bag'],
    ]);
  });
});

describe('Quick Order structured voice action verification', () => {
  const catalog = [
    { id: 'salmon-id', name: 'Salmon', aliases: [], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['lb', 'cs'] },
    { id: 'salmon-roe-id', name: 'Salmon roe', aliases: [], default_unit: 'box', base_unit: 'box', pack_unit: 'box', allowed_units: ['box'] },
    { id: 'ground-garlic-id', name: 'Ground garlic', aliases: ['ground garlic'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack'] },
    { id: 'wasabi-powder-id', name: 'Wasabi powder', aliases: [], default_unit: 'cs', base_unit: 'pack', pack_unit: 'cs', allowed_units: ['cs'] },
    { id: 'masago-id', name: 'Masago', aliases: ['massago'], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['cs'] },
    { id: 'crab-id', name: 'Crab', aliases: [], default_unit: 'box', base_unit: 'box', pack_unit: 'box', allowed_units: ['box'] },
  ];

  it('resolves accented salmon with explicit quantity and unit when safe', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.9,
      actions: [{
        type: 'add',
        spokenItemName: 'salmo',
        quantity: 3,
        unit: 'case',
        confidence: 0.88,
        sourceText: 'salmo tree case',
      }],
    });

    expect(result.actions[0]).toMatchObject({
      itemId: 'salmon-id',
      canonicalItemName: 'Salmon',
      quantity: 3,
      unit: 'cs',
    });
  });

  it('prefers the exact one-word salmon item over salmon roe', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.95,
      actions: [{ type: 'add', spokenItemName: 'salmon', quantity: 3, unit: 'case', confidence: 0.95 }],
    });

    expect(result.actions[0]).toMatchObject({ itemId: 'salmon-id', canonicalItemName: 'Salmon' });
  });

  it('keeps salmon roe distinct from salmon', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.95,
      actions: [{ type: 'add', spokenItemName: 'salmon roe', quantity: 2, unit: 'box', confidence: 0.95 }],
    });

    expect(result.actions[0]).toMatchObject({ itemId: 'salmon-roe-id', canonicalItemName: 'Salmon roe' });
  });

  it('does not turn mango powder into wasabi powder', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.8,
      actions: [{ type: 'add', spokenItemName: 'mango powder', quantity: 1, unit: 'case', confidence: 0.8 }],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.unresolved[0]).toMatchObject({ reason: 'unknown_item' });
  });

  it('keeps random bad input unresolved', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.5,
      actions: [{ type: 'add', spokenItemName: 'bacon combine', quantity: 1, unit: 'case', confidence: 0.5 }],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toBe('unknown_item');
  });

  it('resolves ground garlic one pack', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.95,
      actions: [{ type: 'add', spokenItemName: 'ground garlic', quantity: 1, unit: 'pack', confidence: 0.95 }],
    });

    expect(result.actions[0]).toMatchObject({
      itemId: 'ground-garlic-id',
      quantity: 1,
      unit: 'pack',
    });
  });

  it('does not create order rows for no-order phrases', () => {
    const result = verifyVoiceActions({
      catalog,
      modelConfidence: 0.9,
      actions: [
        { type: 'note', spokenItemName: 'masago', sourceText: 'no need masago', confidence: 0.9 },
        { type: 'note', spokenItemName: 'crab', sourceText: 'we have a lot of crab', confidence: 0.9 },
      ],
    });

    expect(result.actions).toHaveLength(0);
    expect(result.unresolved.map((entry) => entry.reason)).toEqual(['unsupported_command', 'unsupported_command']);
  });

  it('separates missing quantity and missing unit', () => {
    const missingQuantity = verifyVoiceActions({
      catalog,
      modelConfidence: 0.9,
      actions: [{ type: 'add', spokenItemName: 'salmon', quantity: null, unit: 'case', confidence: 0.9 }],
    });
    const missingUnit = verifyVoiceActions({
      catalog: [{ id: 'yellowtail-id', name: 'Yellowtail', aliases: [], default_unit: 'lb', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['lb', 'cs'] }],
      modelConfidence: 0.9,
      actions: [{ type: 'add', spokenItemName: 'yellowtail', quantity: 4, unit: null, confidence: 0.9 }],
    });

    expect(missingQuantity.unresolved[0]?.reason).toBe('missing_quantity');
    expect(missingUnit.unresolved[0]?.reason).toBe('missing_unit');
  });
});
