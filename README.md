# Babytuna - Restaurant Inventory Ordering

A React Native + Expo app for restaurant inventory management and ordering.

## Tech Stack

- **Expo SDK 54** with Expo Router for navigation
- **Supabase** for authentication and database
- **Zustand** with AsyncStorage persistence for state management
- **NativeWind** (Tailwind CSS for React Native) for styling
- **TypeScript** for type safety

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Supabase account and project

### Installation

1. Clone the repository and install dependencies:

```bash
cd Babytuna
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add your Supabase credentials:
- `EXPO_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key

3. Set up the database:

Run the migrations in your Supabase SQL Editor:
- `supabase/migrations/00001_initial_schema.sql` - Creates tables and RLS policies
- `supabase/seed.sql` - Seeds locations, suppliers, and 100+ inventory items

4. Add app assets:

Place the following images in the `assets/` folder:
- `icon.png` (1024x1024) - App icon
- `splash.png` (1284x2778) - Splash screen
- `adaptive-icon.png` (1024x1024) - Android adaptive icon
- `favicon.png` (48x48) - Web favicon

5. Start the development server:

```bash
npm start
```

## Project Structure

```
Babytuna/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Auth screens (login, signup)
│   ├── (tabs)/            # Main tab screens
│   │   ├── index.tsx      # Order/inventory screen
│   │   ├── cart.tsx       # Shopping cart
│   │   ├── orders.tsx     # Order history
│   │   └── profile.tsx    # User profile
│   └── orders/            # Order detail screens
├── src/
│   ├── components/        # Reusable UI components
│   ├── constants/         # Theme, colors, labels
│   ├── lib/              # Supabase client
│   ├── store/            # Zustand stores
│   └── types/            # TypeScript types
└── supabase/
    ├── migrations/        # Database schema
    └── seed.sql          # Seed data
```

## Features

- **Authentication**: Email/password login with Supabase Auth
- **Multi-location Support**: Switch between restaurant locations
- **Inventory Management**: Browse 100+ items by category
- **Shopping Cart**: Add items with quantity and unit selection
- **Order Management**: Create, submit, fulfill, and cancel orders
- **Role-based Access**: Employee and manager roles with different permissions

## Database Schema

### Tables

- `locations` - Restaurant locations
- `users` - User profiles with roles
- `inventory_items` - Inventory catalog with categories
- `orders` - Order headers with status tracking
- `order_items` - Individual order line items
- `suppliers` - Vendor information

### Categories

**Item Categories:**
- Fish & Seafood
- Protein
- Produce
- Dry Goods
- Dairy & Cold
- Frozen
- Sauces
- Packaging

**Supplier Categories:**
- Fish Supplier
- Main Distributor
- Asian Market

## Design System

- **Primary Color**: Orange (#F97316)
- **Background**: Light gray (#F9FAFB)
- **Cards**: White with 16px border radius and subtle shadow
- **Spacing**: 16-24px padding throughout

## License

Private - All rights reserved
