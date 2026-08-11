// Generated from the live Supabase schema. Regenerate with:
//   supabase gen types typescript --linked --schema public > src/types/database.ts
// then re-append the app-level aliases at the bottom of this file.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_code_rate_limits: {
        Row: {
          attempt_count: number
          identifier_hash: string
          last_attempt_at: string
          locked_until: string | null
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          identifier_hash: string
          last_attempt_at?: string
          locked_until?: string | null
          window_started_at?: string
        }
        Update: {
          attempt_count?: number
          identifier_hash?: string
          last_attempt_at?: string
          locked_until?: string | null
          window_started_at?: string
        }
        Relationships: []
      }
      access_code_role_grants: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          subject_hash: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          role: Database["public"]["Enums"]["user_role"]
          subject_hash: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          subject_hash?: string
        }
        Relationships: []
      }
      access_code_validation_events: {
        Row: {
          created_at: string
          id: string
          identifier_hash: string
          outcome: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier_hash: string
          outcome: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier_hash?: string
          outcome?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      area_items: {
        Row: {
          active: boolean
          area_id: string
          conversion_factor: number | null
          created_at: string
          current_quantity: number
          id: string
          inventory_item_id: string
          last_updated_at: string | null
          last_updated_by: string | null
          max_quantity: number
          min_quantity: number
          notes: string | null
          order_unit: string | null
          par_level: number | null
          unit_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          area_id: string
          conversion_factor?: number | null
          created_at?: string
          current_quantity?: number
          id?: string
          inventory_item_id: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          max_quantity?: number
          min_quantity?: number
          notes?: string | null
          order_unit?: string | null
          par_level?: number | null
          unit_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          area_id?: string
          conversion_factor?: number | null
          created_at?: string
          current_quantity?: number
          id?: string
          inventory_item_id?: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          max_quantity?: number
          min_quantity?: number
          notes?: string | null
          order_unit?: string | null
          par_level?: number | null
          unit_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_items_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "storage_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_items_last_updated_by_fkey"
            columns: ["last_updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_results: {
        Row: {
          actual_usage: number | null
          adjustment_factor: number | null
          calculated_usage: number | null
          calibration_date: string | null
          counted_end: number | null
          counted_start: number | null
          created_at: string
          created_by: string | null
          discrepancy_pct: number | null
          id: string
          inventory_item_id: string
          location_id: string
        }
        Insert: {
          actual_usage?: number | null
          adjustment_factor?: number | null
          calculated_usage?: number | null
          calibration_date?: string | null
          counted_end?: number | null
          counted_start?: number | null
          created_at?: string
          created_by?: string | null
          discrepancy_pct?: number | null
          id?: string
          inventory_item_id: string
          location_id: string
        }
        Update: {
          actual_usage?: number | null
          adjustment_factor?: number | null
          calculated_usage?: number | null
          calibration_date?: string | null
          counted_end?: number | null
          counted_start?: number | null
          created_at?: string
          created_by?: string | null
          discrepancy_pct?: number | null
          id?: string
          inventory_item_id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calibration_results_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_results_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_results_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      current_stock_snapshots: {
        Row: {
          confidence: number
          created_at: string
          entered_by_user_id: string | null
          id: string
          item_id: string
          location_id: string
          quantity: number
          quick_order_session_id: string | null
          source: string
          source_message: string | null
          tracking_unit: string | null
          tracking_unit_key: string | null
          unit: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          entered_by_user_id?: string | null
          id?: string
          item_id: string
          location_id: string
          quantity: number
          quick_order_session_id?: string | null
          source: string
          source_message?: string | null
          tracking_unit?: string | null
          tracking_unit_key?: string | null
          unit?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          entered_by_user_id?: string | null
          id?: string
          item_id?: string
          location_id?: string
          quantity?: number
          quick_order_session_id?: string | null
          source?: string
          source_message?: string | null
          tracking_unit?: string | null
          tracking_unit_key?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "current_stock_snapshots_entered_by_user_id_fkey"
            columns: ["entered_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_stock_snapshots_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_stock_snapshots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_stock_snapshots_quick_order_session_id_fkey"
            columns: ["quick_order_session_id"]
            isOneToOne: false
            referencedRelation: "quick_order_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_sales: {
        Row: {
          id: string
          item_name: string | null
          location_id: string
          quantity_sold: number
          sold_at: string
          square_catalog_item_id: string | null
          square_order_id: string
          synced_at: string
        }
        Insert: {
          id?: string
          item_name?: string | null
          location_id: string
          quantity_sold: number
          sold_at: string
          square_catalog_item_id?: string | null
          square_order_id: string
          synced_at?: string
        }
        Update: {
          id?: string
          item_name?: string | null
          location_id?: string
          quantity_sold?: number
          sold_at?: string
          square_catalog_item_id?: string | null
          square_order_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_forecasts: {
        Row: {
          computed_at: string
          confidence: string
          data_points_used: number | null
          forecast_date: string
          forecast_quantity: number
          forecast_unit: string
          id: string
          inventory_item_id: string
          location_id: string
          reasoning_text: string | null
        }
        Insert: {
          computed_at?: string
          confidence?: string
          data_points_used?: number | null
          forecast_date: string
          forecast_quantity: number
          forecast_unit: string
          id?: string
          inventory_item_id: string
          location_id: string
          reasoning_text?: string | null
        }
        Update: {
          computed_at?: string
          confidence?: string
          data_points_used?: number | null
          forecast_date?: string
          forecast_quantity?: number
          forecast_unit?: string
          id?: string
          inventory_item_id?: string
          location_id?: string
          reasoning_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          active: boolean
          created_at: string
          expo_push_token: string
          id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expo_push_token: string
          id?: string
          platform?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expo_push_token?: string
          id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_quick_order_aliases: {
        Row: {
          active: boolean
          alias_key: string
          alias_text: string
          created_at: string
          employee_name: string
          employee_name_key: string
          employee_user_id: string | null
          id: string
          inventory_item_id: string
          location_id: string | null
          location_key: string | null
          notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          alias_key: string
          alias_text: string
          created_at?: string
          employee_name: string
          employee_name_key: string
          employee_user_id?: string | null
          id?: string
          inventory_item_id: string
          location_id?: string | null
          location_key?: string | null
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          alias_key?: string
          alias_text?: string
          created_at?: string
          employee_name?: string
          employee_name_key?: string
          employee_user_id?: string | null
          id?: string
          inventory_item_id?: string
          location_id?: string | null
          location_key?: string | null
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_quick_order_aliases_employee_user_id_fkey"
            columns: ["employee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_quick_order_aliases_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_quick_order_aliases_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_accuracy: {
        Row: {
          actual_quantity: number | null
          created_at: string
          error_pct: number | null
          forecast_date: string | null
          id: string
          inventory_item_id: string
          location_id: string
          manager_adjusted: boolean
          manager_adjusted_to: number | null
          predicted_quantity: number | null
          suggestion_accepted: boolean | null
        }
        Insert: {
          actual_quantity?: number | null
          created_at?: string
          error_pct?: number | null
          forecast_date?: string | null
          id?: string
          inventory_item_id: string
          location_id: string
          manager_adjusted?: boolean
          manager_adjusted_to?: number | null
          predicted_quantity?: number | null
          suggestion_accepted?: boolean | null
        }
        Update: {
          actual_quantity?: number | null
          created_at?: string
          error_pct?: number | null
          forecast_date?: string | null
          id?: string
          inventory_item_id?: string
          location_id?: string
          manager_adjusted?: boolean
          manager_adjusted_to?: number | null
          predicted_quantity?: number | null
          suggestion_accepted?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_accuracy_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_accuracy_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_order_import_items: {
        Row: {
          created_at: string
          id: string
          import_id: string
          item_id: string
          item_name_snapshot: string
          original_line: string | null
          quantity: number
          supplier_id: string | null
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          import_id: string
          item_id: string
          item_name_snapshot: string
          original_line?: string | null
          quantity: number
          supplier_id?: string | null
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          import_id?: string
          item_id?: string
          item_name_snapshot?: string
          original_line?: string | null
          quantity?: number
          supplier_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_order_import_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "historical_order_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_order_import_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_order_import_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_order_imports: {
        Row: {
          created_at: string
          employee_id: string | null
          employee_name_key: string | null
          employee_name_text: string | null
          id: string
          imported_by: string | null
          location_id: string
          original_text: string
          placed_at: string
          placed_at_text: string | null
          status: string
          supplier_id: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          employee_name_key?: string | null
          employee_name_text?: string | null
          id?: string
          imported_by?: string | null
          location_id: string
          original_text: string
          placed_at: string
          placed_at_text?: string | null
          status?: string
          supplier_id?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          employee_name_key?: string | null
          employee_name_text?: string | null
          id?: string
          imported_by?: string | null
          location_id?: string
          original_text?: string
          placed_at?: string
          placed_at_text?: string | null
          status?: string
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_order_imports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_order_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_order_imports_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_order_imports_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_orders: {
        Row: {
          cleaned_by_ai: boolean
          created_at: string
          id: string
          import_batch_id: string | null
          inventory_item_id: string
          location_id: string
          order_date: string
          quantity: number
          raw_item_name: string | null
          source: string
          unit_type: string
        }
        Insert: {
          cleaned_by_ai?: boolean
          created_at?: string
          id?: string
          import_batch_id?: string | null
          inventory_item_id: string
          location_id: string
          order_date: string
          quantity: number
          raw_item_name?: string | null
          source: string
          unit_type: string
        }
        Update: {
          cleaned_by_ai?: boolean
          created_at?: string
          id?: string
          import_batch_id?: string | null
          inventory_item_id?: string
          location_id?: string
          order_date?: string
          quantity?: number
          raw_item_name?: string | null
          source?: string
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_orders_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      holiday_multipliers: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          multiplier: number
          name: string
          notes: string | null
          start_date: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          multiplier?: number
          name: string
          notes?: string | null
          start_date: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          multiplier?: number
          name?: string
          notes?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "holiday_multipliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          ai_cleaned: boolean
          completed_at: string | null
          created_at: string
          error_log: Json
          file_name: string | null
          file_type: string
          id: string
          matched_rows: number | null
          status: string
          total_rows: number | null
          unmatched_rows: number | null
          uploaded_by: string
        }
        Insert: {
          ai_cleaned?: boolean
          completed_at?: string | null
          created_at?: string
          error_log?: Json
          file_name?: string | null
          file_type: string
          id?: string
          matched_rows?: number | null
          status?: string
          total_rows?: number | null
          unmatched_rows?: number | null
          uploaded_by: string
        }
        Update: {
          ai_cleaned?: boolean
          completed_at?: string | null
          created_at?: string
          error_log?: Json
          file_name?: string | null
          file_type?: string
          id?: string
          matched_rows?: number | null
          status?: string
          total_rows?: number | null
          unmatched_rows?: number | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token: string
          created_at: string
          id: string
          merchant_id: string | null
          metadata: Json
          oauth_state: string
          provider: string
          refresh_token: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          merchant_id?: string | null
          metadata?: Json
          oauth_state: string
          provider: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          merchant_id?: string | null
          metadata?: Json
          oauth_state?: string
          provider?: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          active: boolean
          aliases: string[]
          allowed_units: string[] | null
          base_unit: string
          category: string
          created_at: string
          created_by: string | null
          default_order_unit: string | null
          default_supplier: string | null
          emoji: string | null
          hard_cap: number | null
          id: string
          item_key: string | null
          location_id: string | null
          name: string
          notes: string | null
          pack_size: number
          pack_unit: string
          safety_stock: number | null
          secondary_supplier: string | null
          secondary_supplier_id: string | null
          soft_cap: number | null
          supplier_category: string
          supplier_id: string | null
          target_stock: number | null
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          allowed_units?: string[] | null
          base_unit?: string
          category: string
          created_at?: string
          created_by?: string | null
          default_order_unit?: string | null
          default_supplier?: string | null
          emoji?: string | null
          hard_cap?: number | null
          id?: string
          item_key?: string | null
          location_id?: string | null
          name: string
          notes?: string | null
          pack_size?: number
          pack_unit?: string
          safety_stock?: number | null
          secondary_supplier?: string | null
          secondary_supplier_id?: string | null
          soft_cap?: number | null
          supplier_category: string
          supplier_id?: string | null
          target_stock?: number | null
        }
        Update: {
          active?: boolean
          aliases?: string[]
          allowed_units?: string[] | null
          base_unit?: string
          category?: string
          created_at?: string
          created_by?: string | null
          default_order_unit?: string | null
          default_supplier?: string | null
          emoji?: string | null
          hard_cap?: number | null
          id?: string
          item_key?: string | null
          location_id?: string | null
          name?: string
          notes?: string | null
          pack_size?: number
          pack_unit?: string
          safety_stock?: number | null
          secondary_supplier?: string | null
          secondary_supplier_id?: string | null
          soft_cap?: number | null
          supplier_category?: string
          supplier_id?: string | null
          target_stock?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_secondary_supplier_id_fkey"
            columns: ["secondary_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_reorder_rules: {
        Row: {
          active: boolean
          applies_to_mode: string
          created_at: string
          id: string
          inventory_item_id: string
          location_id: string | null
          location_key: string | null
          notes: string | null
          order_qty: number | null
          order_strategy: string
          order_unit: string | null
          priority: number
          source: string
          trigger_qty: number | null
          trigger_qty_key: string | null
          trigger_qty_max: number | null
          trigger_qty_max_key: string | null
          trigger_type: string
          trigger_unit: string | null
          trigger_unit_key: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to_mode?: string
          created_at?: string
          id?: string
          inventory_item_id: string
          location_id?: string | null
          location_key?: string | null
          notes?: string | null
          order_qty?: number | null
          order_strategy: string
          order_unit?: string | null
          priority?: number
          source?: string
          trigger_qty?: number | null
          trigger_qty_key?: string | null
          trigger_qty_max?: number | null
          trigger_qty_max_key?: string | null
          trigger_type: string
          trigger_unit?: string | null
          trigger_unit_key?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to_mode?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          location_id?: string | null
          location_key?: string | null
          notes?: string | null
          order_qty?: number | null
          order_strategy?: string
          order_unit?: string | null
          priority?: number
          source?: string
          trigger_qty?: number | null
          trigger_qty_key?: string | null
          trigger_qty_max?: number | null
          trigger_qty_max_key?: string | null
          trigger_type?: string
          trigger_unit?: string | null
          trigger_unit_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reorder_rules_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reorder_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_status_terms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          notes: string | null
          phrase: string
          phrase_key: string
          priority: number
          recommendation_action: string
          remaining_qty: number | null
          remaining_unit_behavior: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          phrase: string
          phrase_key: string
          priority?: number
          recommendation_action: string
          remaining_qty?: number | null
          remaining_unit_behavior?: string
          source?: string
          status: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          phrase?: string
          phrase_key?: string
          priority?: number
          recommendation_action?: string
          remaining_qty?: number | null
          remaining_unit_behavior?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_allowed_units: {
        Row: {
          conversion_to_base_unit: number | null
          created_at: string
          employee_names: string | null
          hard_max_quantity: number | null
          id: string
          is_default: boolean
          item_id: string
          max_quantity: number | null
          min_quantity: number | null
          order_quantity: number | null
          order_unit: string | null
          soft_max_quantity: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          conversion_to_base_unit?: number | null
          created_at?: string
          employee_names?: string | null
          hard_max_quantity?: number | null
          id?: string
          is_default?: boolean
          item_id: string
          max_quantity?: number | null
          min_quantity?: number | null
          order_quantity?: number | null
          order_unit?: string | null
          soft_max_quantity?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          conversion_to_base_unit?: number | null
          created_at?: string
          employee_names?: string | null
          hard_max_quantity?: number | null
          id?: string
          is_default?: boolean
          item_id?: string
          max_quantity?: number | null
          min_quantity?: number | null
          order_quantity?: number | null
          order_unit?: string | null
          soft_max_quantity?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_allowed_units_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_order_constraints: {
        Row: {
          delivery_days: number[] | null
          id: string
          inventory_item_id: string
          lead_time_days: number
          max_change_pct: number
          max_order_qty: number | null
          min_order_qty: number | null
          preferred_supplier_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          delivery_days?: number[] | null
          id?: string
          inventory_item_id: string
          lead_time_days?: number
          max_change_pct?: number
          max_order_qty?: number | null
          min_order_qty?: number | null
          preferred_supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          delivery_days?: number[] | null
          id?: string
          inventory_item_id?: string
          lead_time_days?: number
          max_change_pct?: number
          max_order_qty?: number | null
          min_order_qty?: number | null
          preferred_supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_order_constraints_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_constraints_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_constraints_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      item_order_limits: {
        Row: {
          allow_employee_override: boolean
          allow_manager_override: boolean
          created_at: string
          default_order_unit: string | null
          hard_max_quantity: number | null
          historical_max_quantity: number | null
          historical_median_quantity: number | null
          historical_p95_quantity: number | null
          id: string
          item_id: string
          location_id: string | null
          manager_approval_quantity: number | null
          max_daily_quantity: number | null
          max_single_order_quantity: number | null
          max_weekly_quantity: number | null
          soft_max_quantity: number | null
          supplier_id: string | null
          typical_max_quantity: number | null
          typical_min_quantity: number | null
          updated_at: string
        }
        Insert: {
          allow_employee_override?: boolean
          allow_manager_override?: boolean
          created_at?: string
          default_order_unit?: string | null
          hard_max_quantity?: number | null
          historical_max_quantity?: number | null
          historical_median_quantity?: number | null
          historical_p95_quantity?: number | null
          id?: string
          item_id: string
          location_id?: string | null
          manager_approval_quantity?: number | null
          max_daily_quantity?: number | null
          max_single_order_quantity?: number | null
          max_weekly_quantity?: number | null
          soft_max_quantity?: number | null
          supplier_id?: string | null
          typical_max_quantity?: number | null
          typical_min_quantity?: number | null
          updated_at?: string
        }
        Update: {
          allow_employee_override?: boolean
          allow_manager_override?: boolean
          created_at?: string
          default_order_unit?: string | null
          hard_max_quantity?: number | null
          historical_max_quantity?: number | null
          historical_median_quantity?: number | null
          historical_p95_quantity?: number | null
          id?: string
          item_id?: string
          location_id?: string | null
          manager_approval_quantity?: number | null
          max_daily_quantity?: number | null
          max_single_order_quantity?: number | null
          max_weekly_quantity?: number | null
          soft_max_quantity?: number | null
          supplier_id?: string | null
          typical_max_quantity?: number | null
          typical_min_quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_order_limits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_limits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_limits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      item_order_profiles: {
        Row: {
          confidence_score: number | null
          id: string
          item_id: string
          last_order_quantity: number | null
          last_order_unit: string | null
          last_ordered_at: string | null
          location_id: string | null
          monthly_pattern_json: Json | null
          ordered_count_recent: number
          p50_quantity: number | null
          p75_quantity: number | null
          p95_quantity: number | null
          sample_size: number
          source: string
          supplier_id: string | null
          total_similar_orders: number
          updated_at: string
          usual_quantity: number | null
          usual_unit: string | null
          weekday: number | null
          weekday_pattern_json: Json | null
        }
        Insert: {
          confidence_score?: number | null
          id?: string
          item_id: string
          last_order_quantity?: number | null
          last_order_unit?: string | null
          last_ordered_at?: string | null
          location_id?: string | null
          monthly_pattern_json?: Json | null
          ordered_count_recent?: number
          p50_quantity?: number | null
          p75_quantity?: number | null
          p95_quantity?: number | null
          sample_size?: number
          source?: string
          supplier_id?: string | null
          total_similar_orders?: number
          updated_at?: string
          usual_quantity?: number | null
          usual_unit?: string | null
          weekday?: number | null
          weekday_pattern_json?: Json | null
        }
        Update: {
          confidence_score?: number | null
          id?: string
          item_id?: string
          last_order_quantity?: number | null
          last_order_unit?: string | null
          last_ordered_at?: string | null
          location_id?: string | null
          monthly_pattern_json?: Json | null
          ordered_count_recent?: number
          p50_quantity?: number | null
          p75_quantity?: number | null
          p95_quantity?: number | null
          sample_size?: number
          source?: string
          supplier_id?: string | null
          total_similar_orders?: number
          updated_at?: string
          usual_quantity?: number | null
          usual_unit?: string | null
          weekday?: number | null
          weekday_pattern_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "item_order_profiles_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_profiles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_order_profiles_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      item_reorder_rules: {
        Row: {
          allow_fractional_order: boolean
          allow_fractional_stock_count: boolean
          created_at: string
          criticality: string | null
          id: string
          item_id: string
          lead_time_days: number | null
          location_id: string | null
          max_stock_quantity: number | null
          min_order_quantity: number
          min_stock_quantity: number | null
          order_increment: number
          rounding_policy: string
          shelf_life_days: number | null
          supplier_id: string | null
          target_stock_quantity: number | null
          target_stock_unit: string | null
          updated_at: string
          usual_order_quantity: number | null
          usual_order_unit: string | null
        }
        Insert: {
          allow_fractional_order?: boolean
          allow_fractional_stock_count?: boolean
          created_at?: string
          criticality?: string | null
          id?: string
          item_id: string
          lead_time_days?: number | null
          location_id?: string | null
          max_stock_quantity?: number | null
          min_order_quantity?: number
          min_stock_quantity?: number | null
          order_increment?: number
          rounding_policy?: string
          shelf_life_days?: number | null
          supplier_id?: string | null
          target_stock_quantity?: number | null
          target_stock_unit?: string | null
          updated_at?: string
          usual_order_quantity?: number | null
          usual_order_unit?: string | null
        }
        Update: {
          allow_fractional_order?: boolean
          allow_fractional_stock_count?: boolean
          created_at?: string
          criticality?: string | null
          id?: string
          item_id?: string
          lead_time_days?: number | null
          location_id?: string | null
          max_stock_quantity?: number | null
          min_order_quantity?: number
          min_stock_quantity?: number | null
          order_increment?: number
          rounding_policy?: string
          shelf_life_days?: number | null
          supplier_id?: string | null
          target_stock_quantity?: number | null
          target_stock_unit?: string | null
          updated_at?: string
          usual_order_quantity?: number | null
          usual_order_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_reorder_rules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_reorder_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_reorder_rules_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          invited_name: string
          module_preset: Json
          revoked_at: string | null
          role: string
          token: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invited_name: string
          module_preset?: Json
          revoked_at?: string | null
          role: string
          token: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invited_name?: string
          module_preset?: Json
          revoked_at?: string | null
          role?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          location_key: string | null
          name: string
          phone: string | null
          short_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          location_key?: string | null
          name: string
          phone?: string | null
          short_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          location_key?: string | null
          name?: string
          phone?: string | null
          short_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          notification_type: string
          payload: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          notification_type?: string
          payload?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          notification_type?: string
          payload?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          default_checked: boolean
          id: string
          item_id: string | null
          item_name: string
          item_source: string
          last_ordered_at: string | null
          order_frequency_days: number | null
          recommended_qty: number | null
          sort_order: number
          staleness_bucket: string | null
          typical_qty: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          default_checked?: boolean
          id?: string
          item_id?: string | null
          item_name: string
          item_source?: string
          last_ordered_at?: string | null
          order_frequency_days?: number | null
          recommended_qty?: number | null
          sort_order?: number
          staleness_bucket?: string | null
          typical_qty?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          default_checked?: boolean
          id?: string
          item_id?: string | null
          item_name?: string
          item_source?: string
          last_ordered_at?: string | null
          order_frequency_days?: number | null
          recommended_qty?: number | null
          sort_order?: number
          staleness_bucket?: string | null
          typical_qty?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "order_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_checklist_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_checklists: {
        Row: {
          created_at: string
          generated_at: string
          generation_source: string
          id: string
          location_group: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          generation_source?: string
          id?: string
          location_group: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          generation_source?: string
          id?: string
          location_group?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_quantity: number | null
          id: string
          input_mode: string
          inventory_item_id: string
          note: string | null
          order_id: string
          org_id: string | null
          original_suggested_qty: number | null
          quantity: number
          quantity_requested: number | null
          remaining_reported: number | null
          status: string
          supplier_override_id: string | null
          unit_type: Database["public"]["Enums"]["unit_type"]
          was_suggested: boolean
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_quantity?: number | null
          id?: string
          input_mode?: string
          inventory_item_id: string
          note?: string | null
          order_id: string
          org_id?: string | null
          original_suggested_qty?: number | null
          quantity: number
          quantity_requested?: number | null
          remaining_reported?: number | null
          status?: string
          supplier_override_id?: string | null
          unit_type?: Database["public"]["Enums"]["unit_type"]
          was_suggested?: boolean
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_quantity?: number | null
          id?: string
          input_mode?: string
          inventory_item_id?: string
          note?: string | null
          order_id?: string
          org_id?: string | null
          original_suggested_qty?: number | null
          quantity?: number
          quantity_requested?: number | null
          remaining_reported?: number | null
          status?: string
          supplier_override_id?: string | null
          unit_type?: Database["public"]["Enums"]["unit_type"]
          was_suggested?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "order_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_supplier_override_id_fkey"
            columns: ["supplier_override_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_later_items: {
        Row: {
          added_at: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string
          id: string
          item_id: string | null
          item_name: string
          location_id: string | null
          location_name: string | null
          notes: string | null
          notification_id: string | null
          original_order_item_ids: string[]
          payload: Json
          preferred_location_group: string | null
          preferred_supplier_id: string | null
          qty: number | null
          scheduled_at: string
          source_order_id: string | null
          source_order_item_id: string | null
          status: string
          suggested_supplier_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          added_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          item_id?: string | null
          item_name: string
          location_id?: string | null
          location_name?: string | null
          notes?: string | null
          notification_id?: string | null
          original_order_item_ids?: string[]
          payload?: Json
          preferred_location_group?: string | null
          preferred_supplier_id?: string | null
          qty?: number | null
          scheduled_at: string
          source_order_id?: string | null
          source_order_item_id?: string | null
          status?: string
          suggested_supplier_id?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          added_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string | null
          item_name?: string
          location_id?: string | null
          location_name?: string | null
          notes?: string | null
          notification_id?: string | null
          original_order_item_ids?: string[]
          payload?: Json
          preferred_location_group?: string | null
          preferred_supplier_id?: string | null
          qty?: number | null
          scheduled_at?: string
          source_order_id?: string | null
          source_order_item_id?: string | null
          status?: string
          suggested_supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_later_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_later_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_later_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_later_items_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_later_items_source_order_item_id_fkey"
            columns: ["source_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_later_items_suggested_supplier_id_fkey"
            columns: ["suggested_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ordering_patterns: {
        Row: {
          coefficient_of_variation: number | null
          data_maturity: string
          day_of_week: number
          id: string
          inventory_item_id: string
          last_computed_at: string | null
          location_id: string
          seasonality_index: number
          trend_pct: number
          variance: number | null
          weighted_avg_quantity: number | null
        }
        Insert: {
          coefficient_of_variation?: number | null
          data_maturity?: string
          day_of_week: number
          id?: string
          inventory_item_id: string
          last_computed_at?: string | null
          location_id: string
          seasonality_index?: number
          trend_pct?: number
          variance?: number | null
          weighted_avg_quantity?: number | null
        }
        Update: {
          coefficient_of_variation?: number | null
          data_maturity?: string
          day_of_week?: number
          id?: string
          inventory_item_id?: string
          last_computed_at?: string | null
          location_id?: string
          seasonality_index?: number
          trend_pct?: number
          variance?: number | null
          weighted_avg_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ordering_patterns_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordering_patterns_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          entry_method: string
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          location_id: string
          manager_review_notes: string | null
          manager_review_status: string
          manager_reviewed_at: string | null
          manager_reviewed_by: string | null
          notes: string | null
          order_number: number
          order_type: string
          org_id: string | null
          quick_session_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_method?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          location_id: string
          manager_review_notes?: string | null
          manager_review_status?: string
          manager_reviewed_at?: string | null
          manager_reviewed_by?: string | null
          notes?: string | null
          order_number?: number
          order_type?: string
          org_id?: string | null
          quick_session_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          entry_method?: string
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          location_id?: string
          manager_review_notes?: string | null
          manager_review_status?: string
          manager_reviewed_at?: string | null
          manager_reviewed_by?: string | null
          notes?: string | null
          order_number?: number
          order_type?: string
          org_id?: string | null
          quick_session_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_fulfilled_by_fkey"
            columns: ["fulfilled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_manager_reviewed_by_fkey"
            columns: ["manager_reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quick_session_id_fkey"
            columns: ["quick_session_id"]
            isOneToOne: false
            referencedRelation: "quick_order_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          employee_access_code: string
          id: string
          manager_access_code: string
          notes: string | null
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          employee_access_code: string
          id?: string
          manager_access_code: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          employee_access_code?: string
          id?: string
          manager_access_code?: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      parser_corrections: {
        Row: {
          correction_type: string | null
          created_at: string
          id: string
          location_id: string | null
          parser_suggested_item_id: string | null
          raw_token: string
          session_id: string | null
          user_corrected_item_id: string | null
          user_corrected_qty: number | null
          user_corrected_unit: string | null
          user_id: string | null
        }
        Insert: {
          correction_type?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          parser_suggested_item_id?: string | null
          raw_token: string
          session_id?: string | null
          user_corrected_item_id?: string | null
          user_corrected_qty?: number | null
          user_corrected_unit?: string | null
          user_id?: string | null
        }
        Update: {
          correction_type?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          parser_suggested_item_id?: string | null
          raw_token?: string
          session_id?: string | null
          user_corrected_item_id?: string | null
          user_corrected_qty?: number | null
          user_corrected_unit?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parser_corrections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parser_corrections_parser_suggested_item_id_fkey"
            columns: ["parser_suggested_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parser_corrections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quick_order_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parser_corrections_user_corrected_item_id_fkey"
            columns: ["user_corrected_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parser_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      parser_examples: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          raw_text: string
          source: string
          structured_output: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          raw_text: string
          source?: string
          structured_output?: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          raw_text?: string
          source?: string
          structured_output?: Json
        }
        Relationships: []
      }
      parser_usage_log: {
        Row: {
          ai_provider: string | null
          call_type: string
          completion_tokens: number | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          estimated_cost_usd: number | null
          id: string
          metrics: Json
          org_id: string | null
          parser_mode: string
          prompt_tokens: number | null
          session_id: string | null
          succeeded: boolean
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          ai_provider?: string | null
          call_type: string
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: string
          metrics?: Json
          org_id?: string | null
          parser_mode: string
          prompt_tokens?: number | null
          session_id?: string | null
          succeeded?: boolean
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          ai_provider?: string | null
          call_type?: string
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost_usd?: number | null
          id?: string
          metrics?: Json
          org_id?: string | null
          parser_mode?: string
          prompt_tokens?: number | null
          session_id?: string | null
          succeeded?: boolean
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parser_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      past_order_items: {
        Row: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          item_name: string
          location_group: string | null
          location_id: string | null
          location_name: string | null
          note: string | null
          ordered_at: string
          past_order_id: string
          quantity: number
          supplier_id: string
          unit: string
          unit_type: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          item_name: string
          location_group?: string | null
          location_id?: string | null
          location_name?: string | null
          note?: string | null
          ordered_at?: string
          past_order_id: string
          quantity: number
          supplier_id: string
          unit: string
          unit_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          item_name?: string
          location_group?: string | null
          location_id?: string | null
          location_name?: string | null
          note?: string | null
          ordered_at?: string
          past_order_id?: string
          quantity?: number
          supplier_id?: string
          unit?: string
          unit_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "past_order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "past_order_items_past_order_id_fkey"
            columns: ["past_order_id"]
            isOneToOne: false
            referencedRelation: "past_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      past_orders: {
        Row: {
          created_at: string
          created_by: string
          id: string
          message_text: string
          payload: Json
          share_method: string
          supplier_id: string | null
          supplier_name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          message_text: string
          payload?: Json
          share_method?: string
          supplier_id?: string | null
          supplier_name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          message_text?: string
          payload?: Json
          share_method?: string
          supplier_id?: string | null
          supplier_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "past_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_suspended: boolean
          last_active_at: string | null
          last_order_at: string | null
          notifications_enabled: boolean
          order_send_mode: string
          profile_completed: boolean
          provider: string | null
          role: string | null
          suspended_at: string | null
          suspended_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_suspended?: boolean
          last_active_at?: string | null
          last_order_at?: string | null
          notifications_enabled?: boolean
          order_send_mode?: string
          profile_completed?: boolean
          provider?: string | null
          role?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_suspended?: boolean
          last_active_at?: string | null
          last_order_at?: string | null
          notifications_enabled?: boolean
          order_send_mode?: string
          profile_completed?: boolean
          provider?: string | null
          role?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_suspended_by_fkey"
            columns: ["suspended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qo_holiday_overrides: {
        Row: {
          active: boolean
          created_at: string
          end_date: string
          holiday_name: string
          id: string
          item_name: string
          location_scope: string | null
          notes: string | null
          start_date: string
          sync_error: string | null
          sync_status: string | null
          target_multiplier: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_date: string
          holiday_name: string
          id?: string
          item_name: string
          location_scope?: string | null
          notes?: string | null
          start_date: string
          sync_error?: string | null
          sync_status?: string | null
          target_multiplier?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          end_date?: string
          holiday_name?: string
          id?: string
          item_name?: string
          location_scope?: string | null
          notes?: string | null
          start_date?: string
          sync_error?: string | null
          sync_status?: string | null
          target_multiplier?: number
          updated_at?: string
        }
        Relationships: []
      }
      qo_items: {
        Row: {
          active: boolean
          aliases: string | null
          category: string | null
          created_at: string
          id: string
          inventory_item_id: string | null
          item_key: string | null
          location_id: string | null
          location_key: string | null
          location_scope: string | null
          name: string
          notes: string | null
          order_unit: string
          supplier: string
          supplier_id: string | null
          sync_error: string | null
          sync_status: string | null
          target_stock: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string | null
          category?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          name: string
          notes?: string | null
          order_unit: string
          supplier?: string
          supplier_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          target_stock?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string | null
          category?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          item_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          name?: string
          notes?: string | null
          order_unit?: string
          supplier?: string
          supplier_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          target_stock?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qo_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qo_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qo_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      qo_keywords: {
        Row: {
          action: string | null
          active: boolean
          created_at: string
          equals_unit: string | null
          id: string
          meaning_type: string
          notes: string | null
          phrase: string
          phrase_key: string | null
          remaining_qty: number | null
          status: string | null
          sync_error: string | null
          sync_status: string | null
          updated_at: string
        }
        Insert: {
          action?: string | null
          active?: boolean
          created_at?: string
          equals_unit?: string | null
          id?: string
          meaning_type: string
          notes?: string | null
          phrase: string
          phrase_key?: string | null
          remaining_qty?: number | null
          status?: string | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
        }
        Update: {
          action?: string | null
          active?: boolean
          created_at?: string
          equals_unit?: string | null
          id?: string
          meaning_type?: string
          notes?: string | null
          phrase?: string
          phrase_key?: string | null
          remaining_qty?: number | null
          status?: string | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qo_personalization: {
        Row: {
          active: boolean
          created_at: string
          employee_name: string
          employee_name_key: string | null
          employee_user_id: string | null
          id: string
          item_name: string
          item_name_key: string | null
          location_id: string | null
          location_key: string | null
          location_scope: string | null
          notes: string | null
          order_qty: number | null
          order_unit: string | null
          personal_unit: string | null
          personal_unit_equals: string | null
          personal_unit_key: string | null
          phrase: string | null
          phrase_key: string | null
          qo_item_id: string | null
          rule_type: string
          sync_error: string | null
          sync_status: string | null
          trigger_at_or_below: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_name: string
          employee_name_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_name: string
          item_name_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          notes?: string | null
          order_qty?: number | null
          order_unit?: string | null
          personal_unit?: string | null
          personal_unit_equals?: string | null
          personal_unit_key?: string | null
          phrase?: string | null
          phrase_key?: string | null
          qo_item_id?: string | null
          rule_type: string
          sync_error?: string | null
          sync_status?: string | null
          trigger_at_or_below?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_name?: string
          employee_name_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_name?: string
          item_name_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          notes?: string | null
          order_qty?: number | null
          order_unit?: string | null
          personal_unit?: string | null
          personal_unit_equals?: string | null
          personal_unit_key?: string | null
          phrase?: string | null
          phrase_key?: string | null
          qo_item_id?: string | null
          rule_type?: string
          sync_error?: string | null
          sync_status?: string | null
          trigger_at_or_below?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qo_personalization_employee_user_id_fkey"
            columns: ["employee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qo_personalization_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qo_personalization_qo_item_id_fkey"
            columns: ["qo_item_id"]
            isOneToOne: false
            referencedRelation: "qo_items"
            referencedColumns: ["id"]
          },
        ]
      }
      qo_reorder_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          item_name: string
          item_name_key: string | null
          location_id: string | null
          location_key: string | null
          location_scope: string | null
          notes: string | null
          order_qty: number
          order_unit: string | null
          qo_item_id: string | null
          sync_error: string | null
          sync_status: string | null
          trigger_at_or_below: number
          trigger_unit: string
          trigger_unit_key: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          item_name: string
          item_name_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          notes?: string | null
          order_qty: number
          order_unit?: string | null
          qo_item_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          trigger_at_or_below: number
          trigger_unit: string
          trigger_unit_key?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          item_name?: string
          item_name_key?: string | null
          location_id?: string | null
          location_key?: string | null
          location_scope?: string | null
          notes?: string | null
          order_qty?: number
          order_unit?: string | null
          qo_item_id?: string | null
          sync_error?: string | null
          sync_status?: string | null
          trigger_at_or_below?: number
          trigger_unit?: string
          trigger_unit_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qo_reorder_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qo_reorder_rules_qo_item_id_fkey"
            columns: ["qo_item_id"]
            isOneToOne: false
            referencedRelation: "qo_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_alias_rules: {
        Row: {
          active: boolean
          alias_key: string | null
          alias_text: string
          created_at: string
          employee_name: string | null
          employee_name_key: string | null
          employee_scope_key: string | null
          employee_user_id: string | null
          id: string
          item_id: string
          location_id: string | null
          location_key: string | null
          mode_scope: string
          notes: string | null
          scope_type: string
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          alias_key?: string | null
          alias_text: string
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_id: string
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          notes?: string | null
          scope_type?: string
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          alias_key?: string | null
          alias_text?: string
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_id?: string
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          notes?: string | null
          scope_type?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_alias_rules_employee_user_id_fkey"
            columns: ["employee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_alias_rules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_alias_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_cart_mutations: {
        Row: {
          affected_items: Json | null
          after_cart: Json
          assistant_message: string | null
          before_cart: Json
          created_at: string
          delta: Json | null
          id: string
          location_id: string | null
          mutation_type: string
          order_id: string | null
          revert_status: string
          reverted_at: string | null
          reverted_by: string | null
          session_id: string | null
          source_message: string | null
          user_id: string | null
        }
        Insert: {
          affected_items?: Json | null
          after_cart: Json
          assistant_message?: string | null
          before_cart: Json
          created_at?: string
          delta?: Json | null
          id?: string
          location_id?: string | null
          mutation_type: string
          order_id?: string | null
          revert_status?: string
          reverted_at?: string | null
          reverted_by?: string | null
          session_id?: string | null
          source_message?: string | null
          user_id?: string | null
        }
        Update: {
          affected_items?: Json | null
          after_cart?: Json
          assistant_message?: string | null
          before_cart?: Json
          created_at?: string
          delta?: Json | null
          id?: string
          location_id?: string | null
          mutation_type?: string
          order_id?: string | null
          revert_status?: string
          reverted_at?: string | null
          reverted_by?: string | null
          session_id?: string | null
          source_message?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_cart_mutations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_cart_mutations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_cart_mutations_reverted_by_fkey"
            columns: ["reverted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_cart_mutations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quick_order_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_cart_mutations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_ignored_suggestions: {
        Row: {
          context: Json
          id: string
          ignored_at: string
          item_id: string
          location_id: string | null
          suggestion_type: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          id?: string
          ignored_at?: string
          item_id: string
          location_id?: string | null
          suggestion_type?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          id?: string
          ignored_at?: string
          item_id?: string
          location_id?: string | null
          suggestion_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_ignored_suggestions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_ignored_suggestions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_ignored_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_reorder_rules: {
        Row: {
          action_type: string
          active: boolean
          counted_unit: string | null
          counted_unit_key: string | null
          created_at: string
          employee_name: string | null
          employee_name_key: string | null
          employee_scope_key: string | null
          employee_user_id: string | null
          id: string
          item_id: string
          location_id: string | null
          location_key: string | null
          mode_scope: string
          notes: string | null
          order_qty: number | null
          order_unit: string | null
          priority: number | null
          scope_type: string
          source: string
          target_qty: number | null
          target_unit: string | null
          trigger_qty_max: number | null
          trigger_qty_max_key: string | null
          trigger_qty_min: number | null
          trigger_qty_min_key: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_type: string
          active?: boolean
          counted_unit?: string | null
          counted_unit_key?: string | null
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_id: string
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          notes?: string | null
          order_qty?: number | null
          order_unit?: string | null
          priority?: number | null
          scope_type?: string
          source?: string
          target_qty?: number | null
          target_unit?: string | null
          trigger_qty_max?: number | null
          trigger_qty_max_key?: string | null
          trigger_qty_min?: number | null
          trigger_qty_min_key?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          active?: boolean
          counted_unit?: string | null
          counted_unit_key?: string | null
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          id?: string
          item_id?: string
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          notes?: string | null
          order_qty?: number | null
          order_unit?: string | null
          priority?: number | null
          scope_type?: string
          source?: string
          target_qty?: number | null
          target_unit?: string | null
          trigger_qty_max?: number | null
          trigger_qty_max_key?: string | null
          trigger_qty_min?: number | null
          trigger_qty_min_key?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_reorder_rules_employee_user_id_fkey"
            columns: ["employee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_reorder_rules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_reorder_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_sessions: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          messages: Json
          org_id: string | null
          parsed_items: Json
          status: string
          submitted_order_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          messages?: Json
          org_id?: string | null
          parsed_items?: Json
          status?: string
          submitted_order_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          messages?: Json
          org_id?: string | null
          parsed_items?: Json
          status?: string
          submitted_order_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_sessions_submitted_order_id_fkey"
            columns: ["submitted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_status_terms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          notes: string | null
          phrase: string
          phrase_key: string | null
          recommendation_action: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          phrase: string
          phrase_key?: string | null
          recommendation_action: string
          source?: string
          status: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          phrase?: string
          phrase_key?: string | null
          recommendation_action?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_order_unit_rules: {
        Row: {
          active: boolean
          created_at: string
          employee_name: string | null
          employee_name_key: string | null
          employee_scope_key: string | null
          employee_user_id: string | null
          from_unit: string | null
          from_unit_key: string | null
          id: string
          is_default_when_missing: boolean
          item_id: string | null
          item_scope_key: string | null
          location_id: string | null
          location_key: string | null
          mode_scope: string
          multiplier: number
          notes: string | null
          scope_type: string
          source: string
          to_unit: string
          to_unit_key: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          from_unit?: string | null
          from_unit_key?: string | null
          id?: string
          is_default_when_missing?: boolean
          item_id?: string | null
          item_scope_key?: string | null
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          multiplier?: number
          notes?: string | null
          scope_type?: string
          source?: string
          to_unit: string
          to_unit_key?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_name?: string | null
          employee_name_key?: string | null
          employee_scope_key?: string | null
          employee_user_id?: string | null
          from_unit?: string | null
          from_unit_key?: string | null
          id?: string
          is_default_when_missing?: boolean
          item_id?: string | null
          item_scope_key?: string | null
          location_id?: string | null
          location_key?: string | null
          mode_scope?: string
          multiplier?: number
          notes?: string | null
          scope_type?: string
          source?: string
          to_unit?: string
          to_unit_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_unit_rules_employee_user_id_fkey"
            columns: ["employee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_unit_rules_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_unit_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_order_voice_parse_events: {
        Row: {
          confidence: number | null
          created_at: string
          error_code: string | null
          fallback_used: boolean
          id: string
          latency_breakdown: Json
          latency_ms: number | null
          location_id: string | null
          model_used: string | null
          normalized_text: string | null
          outcome: string
          parsed_actions: Json
          raw_transcript: string | null
          session_id: string | null
          updated_at: string
          user_id: string
          warnings: Json
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          error_code?: string | null
          fallback_used?: boolean
          id?: string
          latency_breakdown?: Json
          latency_ms?: number | null
          location_id?: string | null
          model_used?: string | null
          normalized_text?: string | null
          outcome?: string
          parsed_actions?: Json
          raw_transcript?: string | null
          session_id?: string | null
          updated_at?: string
          user_id: string
          warnings?: Json
        }
        Update: {
          confidence?: number | null
          created_at?: string
          error_code?: string | null
          fallback_used?: boolean
          id?: string
          latency_breakdown?: Json
          latency_ms?: number | null
          location_id?: string | null
          model_used?: string | null
          normalized_text?: string | null
          outcome?: string
          parsed_actions?: Json
          raw_transcript?: string | null
          session_id?: string | null
          updated_at?: string
          user_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "quick_order_voice_parse_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_voice_parse_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "quick_order_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_order_voice_parse_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          adjustment_factor: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          inventory_item_id: string
          is_auto_suggested: boolean
          quantity_per_sale: number
          square_catalog_item_id: string
          square_item_name: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          adjustment_factor?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          inventory_item_id: string
          is_auto_suggested?: boolean
          quantity_per_sale: number
          square_catalog_item_id: string
          square_item_name?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          adjustment_factor?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          is_auto_suggested?: boolean
          quantity_per_sale?: number
          square_catalog_item_id?: string
          square_item_name?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_reminder_rules: {
        Row: {
          channels: Json
          condition_type: string
          condition_value: number | null
          created_at: string
          created_by: string
          days_of_week: number[]
          employee_id: string | null
          enabled: boolean
          id: string
          last_triggered_at: string | null
          location_id: string | null
          quiet_hours_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          scope: string
          time_of_day: string
          timezone: string
          updated_at: string
        }
        Insert: {
          channels?: Json
          condition_type: string
          condition_value?: number | null
          created_at?: string
          created_by: string
          days_of_week: number[]
          employee_id?: string | null
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          location_id?: string | null
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          scope: string
          time_of_day: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          channels?: Json
          condition_type?: string
          condition_value?: number | null
          created_at?: string
          created_by?: string
          days_of_week?: number[]
          employee_id?: string | null
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          location_id?: string | null
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          scope?: string
          time_of_day?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_reminder_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_reminder_rules_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_reminder_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_events: {
        Row: {
          channels_attempted: Json
          delivery_result: Json
          event_type: string
          id: string
          reminder_id: string
          sent_at: string
        }
        Insert: {
          channels_attempted?: Json
          delivery_result?: Json
          event_type?: string
          id?: string
          reminder_id: string
          sent_at?: string
        }
        Update: {
          channels_attempted?: Json
          delivery_result?: Json
          event_type?: string
          id?: string
          reminder_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_events_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_system_settings: {
        Row: {
          created_at: string
          id: string
          org_id: string
          overdue_threshold_days: number
          recurring_window_minutes: number
          reminder_rate_limit_minutes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id?: string
          overdue_threshold_days?: number
          recurring_window_minutes?: number
          reminder_rate_limit_minutes?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          overdue_threshold_days?: number
          recurring_window_minutes?: number
          reminder_rate_limit_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          cancelled_at: string | null
          created_at: string
          employee_id: string | null
          id: string
          last_reminded_at: string
          location_id: string | null
          manager_id: string | null
          message: string | null
          reminder_count: number
          resolved_at: string | null
          scope: string
          sender_name: string | null
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          last_reminded_at?: string
          location_id?: string | null
          manager_id?: string | null
          message?: string | null
          reminder_count?: number
          resolved_at?: string | null
          scope?: string
          sender_name?: string | null
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          last_reminded_at?: string
          location_id?: string | null
          manager_id?: string | null
          message?: string | null
          reminder_count?: number
          resolved_at?: string | null
          scope?: string
          sender_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      square_connections: {
        Row: {
          access_token_encrypted: string
          created_at: string
          id: string
          last_synced_at: string | null
          merchant_id: string
          refresh_token_encrypted: string
          square_location_ids: string[]
          sync_error_message: string | null
          sync_status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          merchant_id: string
          refresh_token_encrypted: string
          square_location_ids?: string[]
          sync_error_message?: string | null
          sync_status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          merchant_id?: string
          refresh_token_encrypted?: string
          square_location_ids?: string[]
          sync_error_message?: string | null
          sync_status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_check_sessions: {
        Row: {
          area_id: string
          completed_at: string | null
          id: string
          items_checked: number
          items_skipped: number
          items_total: number
          scan_method: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          area_id: string
          completed_at?: string | null
          id?: string
          items_checked?: number
          items_skipped?: number
          items_total?: number
          scan_method: string
          started_at?: string
          status: string
          user_id: string
        }
        Update: {
          area_id?: string
          completed_at?: string | null
          id?: string
          items_checked?: number
          items_skipped?: number
          items_total?: number
          scan_method?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_check_sessions_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "storage_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_check_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_updates: {
        Row: {
          area_id: string
          created_at: string
          id: string
          inventory_item_id: string
          new_quantity: number
          notes: string | null
          photo_url: string | null
          previous_quantity: number | null
          quick_select_value: string | null
          update_method: string
          updated_by: string
        }
        Insert: {
          area_id: string
          created_at?: string
          id?: string
          inventory_item_id: string
          new_quantity: number
          notes?: string | null
          photo_url?: string | null
          previous_quantity?: number | null
          quick_select_value?: string | null
          update_method: string
          updated_by: string
        }
        Update: {
          area_id?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          new_quantity?: number
          notes?: string | null
          photo_url?: string | null
          previous_quantity?: number | null
          quick_select_value?: string | null
          update_method?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_updates_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "storage_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_updates_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_updates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_areas: {
        Row: {
          active: boolean
          check_frequency: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          last_checked_at: string | null
          last_checked_by: string | null
          location_id: string
          name: string
          nfc_tag_id: string | null
          qr_code: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          check_frequency: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          last_checked_at?: string | null
          last_checked_by?: string | null
          location_id: string
          name: string
          nfc_tag_id?: string | null
          qr_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          check_frequency?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          last_checked_at?: string | null
          last_checked_by?: string | null
          location_id?: string
          name?: string
          nfc_tag_id?: string | null
          qr_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_areas_last_checked_by_fkey"
            columns: ["last_checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_areas_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      suggested_orders: {
        Row: {
          confidence_score: number | null
          confidence_tier: string
          created_at: string
          date: string
          id: string
          item_id: string
          item_name: string
          location_id: string
          source: string
          suggested_qty: number
          supplier_name: string | null
          unit: string | null
        }
        Insert: {
          confidence_score?: number | null
          confidence_tier?: string
          created_at?: string
          date: string
          id?: string
          item_id: string
          item_name: string
          location_id: string
          source?: string
          suggested_qty: number
          supplier_name?: string | null
          unit?: string | null
        }
        Update: {
          confidence_score?: number | null
          confidence_tier?: string
          created_at?: string
          date?: string
          id?: string
          item_id?: string
          item_name?: string
          location_id?: string
          source?: string
          suggested_qty?: number
          supplier_name?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suggested_orders_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggested_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean | null
          contact_channel: string
          contact_name: string | null
          contact_notes: string | null
          contact_phone: string | null
          created_at: string
          email: string | null
          id: string
          is_default: boolean
          name: string
          phone: string | null
          supplier_category: string | null
          supplier_key: string | null
        }
        Insert: {
          active?: boolean | null
          contact_channel?: string
          contact_name?: string | null
          contact_notes?: string | null
          contact_phone?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_default?: boolean
          name: string
          phone?: string | null
          supplier_category?: string | null
          supplier_key?: string | null
        }
        Update: {
          active?: boolean | null
          contact_channel?: string
          contact_name?: string | null
          contact_notes?: string | null
          contact_phone?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_default?: boolean
          name?: string
          phone?: string | null
          supplier_category?: string | null
          supplier_key?: string | null
        }
        Relationships: []
      }
      tip_auth_attempts: {
        Row: {
          attempted_at: string
          id: number
          identifier_hash: string
          location_id: string | null
          scope: string
          success: boolean
        }
        Insert: {
          attempted_at?: string
          id?: never
          identifier_hash: string
          location_id?: string | null
          scope?: string
          success?: boolean
        }
        Update: {
          attempted_at?: string
          id?: never
          identifier_hash?: string
          location_id?: string | null
          scope?: string
          success?: boolean
        }
        Relationships: []
      }
      tip_employees: {
        Row: {
          active: boolean
          created_at: string
          id: string
          location_id: string | null
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_employees_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_entries: {
        Row: {
          anomaly_reason: string | null
          business_date: string
          card_amount: number
          cash_amount: number
          corrections_count: number
          created_at: string
          entered_by: string | null
          entry_method: string
          flagged_anomaly: boolean
          id: string
          location_id: string
          meal_period: string
          split_count: number
          updated_at: string
          voice_variant: string | null
        }
        Insert: {
          anomaly_reason?: string | null
          business_date: string
          card_amount?: number
          cash_amount?: number
          corrections_count?: number
          created_at?: string
          entered_by?: string | null
          entry_method: string
          flagged_anomaly?: boolean
          id?: string
          location_id: string
          meal_period: string
          split_count?: number
          updated_at?: string
          voice_variant?: string | null
        }
        Update: {
          anomaly_reason?: string | null
          business_date?: string
          card_amount?: number
          cash_amount?: number
          corrections_count?: number
          created_at?: string
          entered_by?: string | null
          entry_method?: string
          flagged_anomaly?: boolean
          id?: string
          location_id?: string
          meal_period?: string
          split_count?: number
          updated_at?: string
          voice_variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "tip_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_entry_people: {
        Row: {
          tip_employee_id: string
          tip_entry_id: string
        }
        Insert: {
          tip_employee_id: string
          tip_entry_id: string
        }
        Update: {
          tip_employee_id?: string
          tip_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_entry_people_tip_employee_id_fkey"
            columns: ["tip_employee_id"]
            isOneToOne: false
            referencedRelation: "tip_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_entry_people_tip_entry_id_fkey"
            columns: ["tip_entry_id"]
            isOneToOne: false
            referencedRelation: "tip_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_entry_sessions: {
        Row: {
          closer_id: string | null
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string
          location_id: string
          revoked: boolean
          token_hash: string
        }
        Insert: {
          closer_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          location_id: string
          revoked?: boolean
          token_hash: string
        }
        Update: {
          closer_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          location_id?: string
          revoked?: boolean
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_entry_sessions_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "tip_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_entry_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_location_access: {
        Row: {
          entry_token_hash: string | null
          location_id: string
          pin_hash: string | null
          pin_rotated_at: string | null
          token_rotated_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          entry_token_hash?: string | null
          location_id: string
          pin_hash?: string | null
          pin_rotated_at?: string | null
          token_rotated_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          entry_token_hash?: string | null
          location_id?: string
          pin_hash?: string | null
          pin_rotated_at?: string | null
          token_rotated_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_location_access_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_ws_tickets: {
        Row: {
          created_at: string
          expires_at: string
          session_id: string
          token_hash: string
          used: boolean
        }
        Insert: {
          created_at?: string
          expires_at?: string
          session_id: string
          token_hash: string
          used?: boolean
        }
        Update: {
          created_at?: string
          expires_at?: string
          session_id?: string
          token_hash?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tip_ws_tickets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tip_entry_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          created_at: string
          from_unit: string
          id: string
          inventory_item_id: string
          multiplier: number
          to_unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_unit: string
          id?: string
          inventory_item_id: string
          multiplier: number
          to_unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_unit?: string
          id?: string
          inventory_item_id?: string
          multiplier?: number
          to_unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_synonyms: {
        Row: {
          created_at: string
          from_unit: string
          id: string
          to_unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_unit: string
          id?: string
          to_unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_unit?: string
          id?: string
          to_unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      unmapped_menu_items: {
        Row: {
          auto_suggestions: Json
          detected_at: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          square_catalog_item_id: string | null
          square_item_name: string | null
          status: string
        }
        Insert: {
          auto_suggestions?: Json
          detected_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          square_catalog_item_id?: string | null
          square_item_name?: string | null
          status?: string
        }
        Update: {
          auto_suggestions?: Json
          detected_at?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          square_catalog_item_id?: string | null
          square_item_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "unmapped_menu_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_modules: {
        Row: {
          enabled: boolean
          module_key: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          enabled: boolean
          module_key: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          enabled?: boolean
          module_key?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          default_location_id: string | null
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          default_location_id?: string | null
          email: string
          id: string
          name: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          default_location_id?: string | null
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_prepare_user_delete: {
        Args: { p_replacement_user_id: string; p_target_user_id: string }
        Returns: undefined
      }
      check_parser_anomalies: {
        Args: never
        Returns: {
          alert_type: string
          detail: Json
        }[]
      }
      consume_access_code_role_grant: {
        Args: { p_email: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      create_order_rpc: {
        Args: {
          p_id: string
          p_location_id?: string
          p_org_id?: string
          p_status?: string
          p_user_id?: string
        }
        Returns: Json
      }
      current_user_is_manager: { Args: never; Returns: boolean }
      ensure_current_user_identity: { Args: never; Returns: undefined }
      get_access_code_role: { Args: { p_access_code: string }; Returns: string }
      get_dow_suggestions:
        | {
            Args: {
              p_location_id: string
              p_lookback_months?: number
              p_min_frequency?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_location_id: string
              p_lookback_months?: number
              p_min_frequency?: number
              p_user_id?: string
            }
            Returns: Json
          }
      get_effective_modules: {
        Args: { p_user_id: string }
        Returns: {
          module_key: string
          enabled: boolean
        }[]
      }
      get_last_inventory_session_items: {
        Args: { p_location_id: string; p_user_id?: string }
        Returns: Json
      }
      get_recent_orders:
        | { Args: { p_limit?: number; p_location_id: string }; Returns: Json }
        | {
            Args: {
              p_limit?: number
              p_location_id: string
              p_user_id?: string
            }
            Returns: Json
          }
      generate_order_checklist: {
        Args: { p_location_group: string; p_user_id: string }
        Returns: string
      }
      get_usual_order: {
        Args: {
          p_limit?: number
          p_location_id: string
          p_lookback_months?: number
          p_min_frequency?: number
          p_user_id?: string
        }
        Returns: Json
      }
      has_org_role: {
        Args: { allowed_roles: string[]; target_org_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { target_org_id: string }; Returns: boolean }
      manager_update_access_codes: {
        Args: { p_employee_code: string; p_manager_code: string }
        Returns: undefined
      }
      normalize_history_employee_name: {
        Args: { p_name: string }
        Returns: string
      }
      normalize_quick_order_alias_text: {
        Args: { p_alias: string }
        Returns: string
      }
      normalize_quick_order_employee_name: {
        Args: { p_name: string }
        Returns: string
      }
      org_has_members: { Args: { target_org_id: string }; Returns: boolean }
      refresh_item_order_profiles: {
        Args: { p_location_id?: string; p_lookback_orders?: number }
        Returns: number
      }
      resolve_active_location_banners_for_location: {
        Args: {
          p_location_id: string
          p_order_created_at?: string
          p_order_id?: string
        }
        Returns: number
      }
      resolve_active_reminders_for_employee: {
        Args: {
          p_employee_id: string
          p_order_created_at?: string
          p_order_id?: string
        }
        Returns: number
      }
      set_org_access_codes_plain: {
        Args: {
          p_employee_access_code: string
          p_manager_access_code: string
          p_updated_by?: string
        }
        Returns: undefined
      }
      submit_order_rpc: {
        Args: {
          p_entry_method?: string
          p_id: string
          p_items?: Json
          p_location_id?: string
          p_org_id?: string
          p_quick_session_id?: string
          p_status?: string
          p_user_id?: string
        }
        Returns: Json
      }
      sync_profile_after_order: {
        Args: { p_order_created_at?: string; p_user_id: string }
        Returns: undefined
      }
      tip_auth_attempt_allowed: {
        Args: {
          p_identifier_hash: string
          p_location_id: string
          p_max_per_identifier: number
          p_max_per_location: number
          p_scope: string
        }
        Returns: boolean
      }
      tip_revoke_location_sessions: {
        Args: { p_location_id: string }
        Returns: number
      }
      tip_rotate_entry_pin: {
        Args: { p_location_id: string; p_pin?: string }
        Returns: string
      }
      tip_rotate_entry_token: {
        Args: { p_location_id: string }
        Returns: string
      }
      tip_save_entry: {
        Args: {
          p_anomaly_reason: string
          p_business_date: string
          p_card: number
          p_cash: number
          p_corrections: number
          p_entered_by: string
          p_entry_method: string
          p_flagged: boolean
          p_location_id: string
          p_meal_period: string
          p_people: string[]
          p_voice_variant: string
        }
        Returns: string
      }
      tip_validate_entry_pin: {
        Args: {
          p_identifier_hash: string
          p_location_id: string
          p_pin: string
        }
        Returns: Json
      }
      tip_validate_entry_token: {
        Args: { p_identifier_hash: string; p_token: string }
        Returns: Json
      }
      update_org_access_codes: {
        Args: {
          p_employee_access_code: string
          p_manager_access_code: string
          p_updated_by: string
        }
        Returns: undefined
      }
      upsert_identity_from_auth_user: {
        Args: { p_auth_user_id: string }
        Returns: undefined
      }
      validate_access_code_attempt: {
        Args: {
          p_access_code: string
          p_identifier_hash: string
          p_subject_hash?: string
        }
        Returns: Json
      }
    }
    Enums: {
      order_status:
        | "draft"
        | "submitted"
        | "fulfilled"
        | "cancelled"
        | "processing"
      unit_type: "base" | "pack"
      user_role: "employee" | "manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      order_status: [
        "draft",
        "submitted",
        "fulfilled",
        "cancelled",
        "processing",
      ],
      unit_type: ["base", "pack"],
      user_role: ["employee", "manager"],
    },
  },
} as const

// --- App-level aliases (hand-maintained; keep after regeneration) ---------
// The columns are CHECK-constrained to these values; the generator emits
// plain `string`, so the app narrows them here.
export type MealPeriod = "lunch" | "dinner";
export type EntryMethod = "typed" | "voice";
export type VoiceVariant = "waveform" | "live_transcript";
