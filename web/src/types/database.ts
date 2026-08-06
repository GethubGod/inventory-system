// Database types for the tables/RPCs the tips web app touches.
//
// NOTE: written by hand while the Supabase project was paused. Once the
// project is restored, regenerate with:
//   supabase gen types typescript --project-id whrohvitvmcrmedepurd --schema public > src/types/database.ts
// The tip_* shapes below exactly mirror
// supabase/migrations/20260806120000_tips_web_foundation.sql; `locations` and
// `profiles` list only the columns this app selects.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MealPeriod = "lunch" | "dinner";
export type EntryMethod = "typed" | "voice";
export type VoiceVariant = "waveform" | "live_transcript";

export interface Database {
  public: {
    Tables: {
      locations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: "employee" | "manager" | null;
          is_suspended: boolean | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      tip_employees: {
        Row: {
          id: string;
          name: string;
          location_id: string | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          location_id?: string | null;
          active?: boolean;
          sort_order?: number;
        };
        Update: {
          name?: string;
          location_id?: string | null;
          active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      tip_entries: {
        Row: {
          id: string;
          business_date: string;
          location_id: string;
          meal_period: MealPeriod;
          cash_amount: number;
          card_amount: number;
          split_count: number;
          entry_method: EntryMethod;
          voice_variant: VoiceVariant | null;
          corrections_count: number;
          entered_by: string | null;
          flagged_anomaly: boolean;
          anomaly_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_date: string;
          location_id: string;
          meal_period: MealPeriod;
          cash_amount?: number;
          card_amount?: number;
          split_count?: number;
          entry_method: EntryMethod;
          voice_variant?: VoiceVariant | null;
          corrections_count?: number;
          entered_by?: string | null;
          flagged_anomaly?: boolean;
          anomaly_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["tip_entries"]["Insert"]>;
        Relationships: [];
      };
      tip_entry_people: {
        Row: {
          tip_entry_id: string;
          tip_employee_id: string;
        };
        Insert: {
          tip_entry_id: string;
          tip_employee_id: string;
        };
        Update: never;
        Relationships: [];
      };
      tip_location_access: {
        Row: {
          location_id: string;
          token_rotated_at: string | null;
          pin_rotated_at: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      tip_rotate_entry_token: {
        Args: { p_location_id: string };
        Returns: string;
      };
      tip_rotate_entry_pin: {
        Args: { p_location_id: string; p_pin?: string | null };
        Returns: string;
      };
      current_user_is_manager: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
