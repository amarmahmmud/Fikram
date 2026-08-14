export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          plan: "free" | "personal" | "pro" | "enterprise";
          credits_balance: number;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          plan?: "free" | "personal" | "pro" | "enterprise";
          credits_balance?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          plan?: "free" | "personal" | "pro" | "enterprise";
          credits_balance?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          status: "pending" | "running" | "completed" | "failed" | "cancelled";
          base_model: string;
          method: "lora" | "qlora" | "full";
          config: Json;
          dataset_id: string | null;
          dataset_url: string | null;
          result_url: string | null;
          logs: string;
          credits_used: number;
          replicate_id: string | null;
          started_at: string | null;
          completed_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          status?: "pending" | "running" | "completed" | "failed" | "cancelled";
          base_model?: string;
          method?: "lora" | "qlora" | "full";
          config?: Json;
          dataset_id?: string | null;
          dataset_url?: string | null;
          result_url?: string | null;
          logs?: string;
          credits_used?: number;
          replicate_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          status?: "pending" | "running" | "completed" | "failed" | "cancelled";
          base_model?: string;
          method?: "lora" | "qlora" | "full";
          config?: Json;
          dataset_id?: string | null;
          dataset_url?: string | null;
          result_url?: string | null;
          logs?: string;
          credits_used?: number;
          replicate_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      datasets: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          file_url: string | null;
          format: "csv" | "jsonl" | "txt" | "json" | "chat" | null;
          rows_count: number;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          file_url?: string | null;
          format?: "csv" | "jsonl" | "txt" | "json" | "chat" | null;
          rows_count?: number;
          size_bytes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          file_url?: string | null;
          format?: "csv" | "jsonl" | "txt" | "json" | "chat" | null;
          rows_count?: number;
          size_bytes?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          id: string;
          user_id: string;
          type: "signup_bonus" | "purchase" | "job_consumed" | "refund";
          label: string;
          amount: number;
          balance_after: number;
          reference_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: "signup_bonus" | "purchase" | "job_consumed" | "refund";
          label?: string;
          amount: number;
          balance_after: number;
          reference_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: "signup_bonus" | "purchase" | "job_consumed" | "refund";
          label?: string;
          amount?: number;
          balance_after?: number;
          reference_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      wizard_sessions: {
        Row: {
          id: string;
          user_id: string;
          messages: Json;
          extracted_config: Json;
          linked_job_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          messages?: Json;
          extracted_config?: Json;
          linked_job_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          messages?: Json;
          extracted_config?: Json;
          linked_job_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
