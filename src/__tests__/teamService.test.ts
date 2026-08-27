// Pure team-service helpers: works-at group mapping (short_code convention),
// module summaries, and the recipient-less Messages compose link.

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  buildInviteMessageBody,
  buildInviteSmsUrl,
  groupForLocationId,
  locationIdForGroup,
  summarizeModules,
} from '@/features/team/teamService';
import type { Location } from '@/types';

const LOCATIONS: Location[] = [
  {
    id: 'loc-sushi',
    name: 'Babytuna Sushi',
    short_code: 'S1',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'loc-poki',
    name: 'Babytuna Poki & Pho',
    short_code: 'p2',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

describe('works-at group mapping', () => {
  it('resolves sushi and poki by short_code prefix, both to null', () => {
    expect(locationIdForGroup('sushi', LOCATIONS)).toBe('loc-sushi');
    expect(locationIdForGroup('poki', LOCATIONS)).toBe('loc-poki');
    expect(locationIdForGroup('both', LOCATIONS)).toBeNull();
    expect(locationIdForGroup('sushi', [])).toBeNull();
  });

  it('round-trips a location id back to its group', () => {
    expect(groupForLocationId('loc-sushi', LOCATIONS)).toBe('sushi');
    expect(groupForLocationId('loc-poki', LOCATIONS)).toBe('poki');
    expect(groupForLocationId(null, LOCATIONS)).toBe('both');
    expect(groupForLocationId('unknown-id', LOCATIONS)).toBe('both');
  });
});

describe('summarizeModules', () => {
  it('joins enabled module labels in display order', () => {
    expect(
      summarizeModules({
        ordering_simple: true,
        ordering_advanced: false,
        stock_check: true,
        tips: false,
        fulfillment: false,
      }),
    ).toBe('Ordering + Stock check');
  });

  it('handles nothing enabled and missing data', () => {
    expect(
      summarizeModules({
        ordering_simple: false,
        ordering_advanced: false,
        stock_check: false,
        tips: false,
        fulfillment: false,
      }),
    ).toBe('Nothing enabled');
    expect(summarizeModules(null)).toBe('Loading…');
  });
});

describe('invite Messages link', () => {
  it('uses the platform-correct body separator with no recipient', () => {
    expect(buildInviteSmsUrl('hello there', 'ios')).toBe('sms:&body=hello%20there');
    expect(buildInviteSmsUrl('hello there', 'android')).toBe('sms:?body=hello%20there');
  });

  it('builds a personal body containing the join link', () => {
    const body = buildInviteMessageBody('Nate', 'https://tips.babytunasystems.com/join/abc');
    expect(body).toContain('Nate');
    expect(body).toContain('https://tips.babytunasystems.com/join/abc');
    expect(buildInviteMessageBody('  ', 'https://x.test/j')).toBe(
      "Here's your Smelter setup link: https://x.test/j",
    );
  });
});
