const mockSupabase = {
  from: jest.fn(),
};

/* eslint-disable import/first -- Dependencies must be mocked before importing the service. */
jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

import {
  listSupplierContacts,
  updateSupplierContact,
} from '../services/supplierContacts';

type QueryResult = { data: unknown; error: unknown };

function createListQuery(result: QueryResult) {
  const query = {
    select: jest.fn(),
    order: jest.fn(),
  };

  query.select.mockReturnValue(query);
  query.order.mockResolvedValue(result);

  return query;
}

function createUpdateQuery(result: QueryResult) {
  const query = {
    update: jest.fn(),
    eq: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };

  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue(result);

  return query;
}

describe('supplier contacts service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists supplier contacts ordered by supplier name', async () => {
    const query = createListQuery({
      data: [
        {
          id: 'supplier-1',
          name: 'Bluefin Fish',
          contact_phone: '+1 (555) 010-1234',
          contact_channel: 'sms',
          contact_name: 'Mina',
          contact_notes: 'Order before noon',
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(query);

    await expect(listSupplierContacts()).resolves.toEqual([
      {
        supplierId: 'supplier-1',
        supplierName: 'Bluefin Fish',
        contactPhone: '+1 (555) 010-1234',
        contactChannel: 'sms',
        contactName: 'Mina',
        contactNotes: 'Order before noon',
      },
    ]);

    expect(mockSupabase.from).toHaveBeenCalledWith('suppliers');
    expect(query.select).toHaveBeenCalledWith(
      'id,name,contact_phone,contact_channel,contact_name,contact_notes',
    );
    expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('updates only the supplied contact fields and returns the updated contact', async () => {
    const query = createUpdateQuery({
      data: {
        id: 'supplier-1',
        name: 'Bluefin Fish',
        contact_phone: '+15550101234',
        contact_channel: 'whatsapp',
        contact_name: null,
        contact_notes: null,
      },
      error: null,
    });
    mockSupabase.from.mockReturnValue(query);

    await expect(
      updateSupplierContact('supplier-1', {
        contactPhone: '+15550101234',
        contactChannel: 'whatsapp',
        contactName: null,
        contactNotes: null,
      }),
    ).resolves.toEqual({
      supplierId: 'supplier-1',
      supplierName: 'Bluefin Fish',
      contactPhone: '+15550101234',
      contactChannel: 'whatsapp',
      contactName: null,
      contactNotes: null,
    });

    expect(query.update).toHaveBeenCalledWith({
      contact_phone: '+15550101234',
      contact_channel: 'whatsapp',
      contact_name: null,
      contact_notes: null,
    });
    expect(query.eq).toHaveBeenCalledWith('id', 'supplier-1');
    expect(query.select).toHaveBeenCalledWith(
      'id,name,contact_phone,contact_channel,contact_name,contact_notes',
    );
  });

  it('surfaces Supabase errors', async () => {
    const error = new Error('Managers only');
    const query = createListQuery({ data: null, error });
    mockSupabase.from.mockReturnValue(query);

    await expect(listSupplierContacts()).rejects.toThrow('Managers only');
  });
});
