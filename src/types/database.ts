export type ItemCategory =
  | 'fish'
  | 'protein'
  | 'produce'
  | 'dry'
  | 'dairy_cold'
  | 'frozen'
  | 'sauces'
  | 'packaging';

export type SupplierCategory =
  | 'fish_supplier'
  | 'main_distributor'
  | 'asian_market';

export type UserRole = 'employee' | 'manager';

export type OrderStatus = 'draft' | 'submitted' | 'processing' | 'fulfilled' | 'cancelled';

export type UnitType = 'base' | 'pack';

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
    };
  };
}
