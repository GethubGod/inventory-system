/* eslint-disable import/first -- React Native must be mocked before importing the service. */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { Platform } from 'react-native';

import { buildSupplierSendUrl } from '../services/supplierSendLink';

const mockPlatform = Platform as { OS: string };

describe('buildSupplierSendUrl', () => {
  beforeEach(() => {
    mockPlatform.OS = 'ios';
  });

  it('builds an iOS SMS URL with an ampersand body separator and encoded newlines', () => {
    expect(
      buildSupplierSendUrl(
        { channel: 'sms', phone: '+1 (555) 010-1234' },
        'Hi Mina,\nSalmon & tuna',
      ),
    ).toBe('sms:+15550101234&body=Hi%20Mina%2C%0ASalmon%20%26%20tuna');
  });

  it('builds an Android SMS URL with a question-mark body separator', () => {
    mockPlatform.OS = 'android';

    expect(
      buildSupplierSendUrl(
        { channel: 'sms', phone: '1-555-010-1234' },
        'Please send 2 cases',
      ),
    ).toBe('sms:15550101234?body=Please%20send%202%20cases');
  });

  it('builds a WhatsApp URL with digits-only phone and an encoded multiline body', () => {
    expect(
      buildSupplierSendUrl(
        { channel: 'whatsapp', phone: '+1 (555) 010-1234' },
        'Order:\n2 cases & 1 bag',
      ),
    ).toBe('whatsapp://send?phone=15550101234&text=Order%3A%0A2%20cases%20%26%201%20bag');
  });

  it('normalizes spaces, dashes, and parentheses while retaining a leading plus for SMS', () => {
    expect(
      buildSupplierSendUrl(
        { channel: 'sms', phone: ' +44 (20) 7946-0958 ' },
        'Hello',
      ),
    ).toBe('sms:+442079460958&body=Hello');
  });

  it('returns null for share-sheet targets and absent or unusable phone numbers', () => {
    expect(
      buildSupplierSendUrl({ channel: 'share_sheet', phone: '+15550101234' }, 'Hello'),
    ).toBeNull();
    expect(buildSupplierSendUrl({ channel: 'sms', phone: null }, 'Hello')).toBeNull();
    expect(buildSupplierSendUrl({ channel: 'whatsapp', phone: '() -' }, 'Hello')).toBeNull();
  });
});
