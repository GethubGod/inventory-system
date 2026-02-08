export type ItemCategory =
  | 'fish'
  | 'protein'
  | 'produce'
  | 'dry'
  | 'dairy_cold'
  | 'frozen'
  | 'sauces'
  | 'packaging'
  | 'alcohol';

export type SupplierCategory =
  | 'fish_supplier'
  | 'main_distributor'
  | 'asian_market';

export type UserRole = 'employee' | 'manager';
export type AuthProvider = 'email' | 'google' | 'apple';

export type OrderStatus = 'draft' | 'submitted' | 'processing' | 'fulfilled' | 'cancelled' | 'cancel_requested';
export type OrderInputMode = 'quantity' | 'remaining';

export type UnitType = 'base' | 'pack';

export type CheckFrequency = 'daily' | 'every_2_days' | 'every_3_days' | 'weekly';
export type StockUpdateMethod = 'nfc' | 'qr' | 'manual' | 'quick_select';
export type QuickSelectValue = 'empty' | 'low' | 'good' | 'full';
export type StockCheckStatus = 'in_progress' | 'completed' | 'abandoned';
export type StockScanMethod = 'nfc' | 'qr' | 'manual';
export type StockLevel = 'empty' | 'critical' | 'low' | 'good' | 'full';
export type ReorderUrgency = 'low' | 'medium' | 'high';

export interface Location {
  id: string;
  name: string;
  short_code: string;
  active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  default_location_id: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole | null;
  is_suspended: boolean;
  last_active_at: string | null;
  last_order_at: string | null;
  profile_completed: boolean;
  provider: AuthProvider | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  supplier_category: SupplierCategory;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  active: boolean;
  created_at: string;
  created_by?: string | null;
}

export interface Order {
  id: string;
  order_number: number;
  user_id: string;
  location_id: string;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  inventory_item_id: string;
  quantity: number;
  unit_type: UnitType;
  input_mode: OrderInputMode;
  quantity_requested: number | null;
  remaining_reported: number | null;
  decided_quantity: number | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  supplier_type: SupplierCategory;
  is_default: boolean;
  created_at: string;
}

export interface StorageArea {
  id: string;
  name: string;
  description: string | null;
  location_id: string;
  nfc_tag_id: string | null;
  qr_code: string | null;
  check_frequency: CheckFrequency;
  last_checked_at: string | null;
  last_checked_by: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageAreaWithStatus extends StorageArea {
  item_count: number;
  check_status: 'overdue' | 'due_soon' | 'ok';
}

export interface AreaItem {
  id: string;
  area_id: string;
  inventory_item_id: string;
  min_quantity: number;
  max_quantity: number;
  par_level: number | null;
  current_quantity: number;
  unit_type: string;
  order_unit: string | null;
  conversion_factor: number | null;
  active: boolean;
  last_updated_at: string | null;
  last_updated_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AreaItemWithDetails extends AreaItem {
  inventory_item: InventoryItem;
  stock_level: StockLevel;
}

export interface StockUpdate {
  id: string;
  area_id: string;
  inventory_item_id: string;
  previous_quantity: number | null;
  new_quantity: number;
  updated_by: string;
  update_method: StockUpdateMethod;
  quick_select_value: QuickSelectValue | null;
  photo_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface StockCheckSession {
  id: string;
  area_id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  items_checked: number;
  items_skipped: number;
  items_total: number;
  status: StockCheckStatus;
  scan_method: StockScanMethod;
}

export interface ReorderSuggestion {
  areaItem: AreaItemWithDetails;
  reorderQuantity: number;
  urgency: ReorderUrgency;
}

export interface QuickSelectRange {
  min: number;
  max: number;
}

export type QuickSelectRanges = Record<QuickSelectValue, QuickSelectRange>;

// Joined types for queries
export interface OrderWithDetails extends Order {
  user: User;
  location: Location;
  order_items: OrderItemWithInventory[];
}

export interface OrderItemWithInventory extends OrderItem {
  inventory_item: InventoryItem;
}

// Database schema type for Supabase
export interface Database {
  public: {
    Tables: {
      locations: {
        Row: Location;
        Insert: Omit<Location, 'id' | 'created_at'>;
        Update: Partial<Omit<Location, 'id' | 'created_at'>>;
      };
      users: {
        Row: User;
        Insert: Omit<User, 'id' | 'created_at'>;
        Update: Partial<Omit<User, 'id' | 'created_at'>>;
      };
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole | null;
          is_suspended?: boolean;
          last_active_at?: string | null;
          last_order_at?: string | null;
          profile_completed?: boolean;
          provider?: AuthProvider | null;
        };
        Update: Partial<{
          full_name: string | null;
          role: UserRole | null;
          is_suspended: boolean;
          last_active_at: string | null;
          last_order_at: string | null;
          profile_completed: boolean;
          provider: AuthProvider | null;
        }>;
      };
      inventory_items: {
        Row: InventoryItem;
        Insert: Omit<InventoryItem, 'id' | 'created_at'>;
        Update: Partial<Omit<InventoryItem, 'id' | 'created_at'>>;
      };
      orders: {
        Row: Order;
        Insert: Omit<Order, 'id' | 'order_number' | 'created_at'>;
        Update: Partial<Omit<Order, 'id' | 'order_number' | 'created_at'>>;
      };
      order_items: {
        Row: OrderItem;
        Insert: Omit<OrderItem, 'id' | 'created_at'>;
        Update: Partial<Omit<OrderItem, 'id' | 'created_at'>>;
      };
      suppliers: {
        Row: Supplier;
        Insert: Omit<Supplier, 'id' | 'created_at'>;
        Update: Partial<Omit<Supplier, 'id' | 'created_at'>>;
      };
      storage_areas: {
        Row: StorageArea;
        Insert: Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<StorageArea, 'id' | 'created_at' | 'updated_at'>>;
      };
      area_items: {
        Row: AreaItem;
        Insert: Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AreaItem, 'id' | 'created_at' | 'updated_at'>>;
      };
      stock_updates: {
        Row: StockUpdate;
        Insert: Omit<StockUpdate, 'id' | 'created_at'>;
        Update: Partial<Omit<StockUpdate, 'id' | 'created_at'>>;
      };
      stock_check_sessions: {
        Row: StockCheckSession;
        Insert: Omit<StockCheckSession, 'id'>;
        Update: Partial<Omit<StockCheckSession, 'id'>>;
      };
    };
  };
}
