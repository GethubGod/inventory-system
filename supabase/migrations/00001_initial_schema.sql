-- Babytuna Inventory System - Initial Schema
-- Run this migration to set up all database tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('employee', 'manager');
CREATE TYPE order_status AS ENUM ('draft', 'submitted', 'fulfilled', 'cancelled');
CREATE TYPE item_category AS ENUM ('fish', 'protein', 'produce', 'dry', 'dairy_cold', 'frozen', 'sauces', 'packaging');
CREATE TYPE supplier_category AS ENUM ('fish_supplier', 'main_distributor', 'asian_market');
CREATE TYPE unit_type AS ENUM ('base', 'pack');

-- Locations table
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'employee',
  default_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inventory items table
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category item_category NOT NULL,
  supplier_category supplier_category NOT NULL,
  base_unit TEXT NOT NULL,
  pack_unit TEXT NOT NULL,
  pack_size INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster category filtering
CREATE INDEX idx_inventory_items_category ON inventory_items(category);
CREATE INDEX idx_inventory_items_supplier_category ON inventory_items(supplier_category);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number SERIAL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status order_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Create indexes for common queries
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_location_id ON orders(location_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity DECIMAL(10, 2) NOT NULL CHECK (quantity > 0),
  unit_type unit_type NOT NULL DEFAULT 'base',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster order item lookups
CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- Suppliers table
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT,
  supplier_type supplier_category NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security (RLS) Policies
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Locations: All authenticated users can read
CREATE POLICY "Locations are viewable by authenticated users" ON locations
  FOR SELECT TO authenticated USING (true);

-- Users: Users can read all, but only update their own
CREATE POLICY "Users are viewable by authenticated users" ON users
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Inventory items: All authenticated users can read
CREATE POLICY "Inventory items are viewable by authenticated users" ON inventory_items
  FOR SELECT TO authenticated USING (true);

-- Orders: Users can see orders from their location, managers can see all
CREATE POLICY "Users can view orders from their location" ON orders
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR location_id IN (SELECT default_location_id FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'manager')
  );

CREATE POLICY "Users can create orders" ON orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own draft orders" ON orders
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'draft')
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'manager')
  );

-- Order items: Same as orders
CREATE POLICY "Users can view order items for accessible orders" ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
      AND (
        o.user_id = auth.uid()
        OR o.location_id IN (SELECT default_location_id FROM users WHERE id = auth.uid())
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'manager')
      )
    )
  );

CREATE POLICY "Users can add items to their draft orders" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
      AND o.user_id = auth.uid()
      AND o.status = 'draft'
    )
  );

CREATE POLICY "Users can update items in their draft orders" ON order_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
      AND o.user_id = auth.uid()
      AND o.status = 'draft'
    )
  );

CREATE POLICY "Users can delete items from their draft orders" ON order_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
      AND o.user_id = auth.uid()
      AND o.status = 'draft'
    )
  );

-- Suppliers: All authenticated users can read
CREATE POLICY "Suppliers are viewable by authenticated users" ON suppliers
  FOR SELECT TO authenticated USING (true);

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'employee'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create user profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
