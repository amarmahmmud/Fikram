export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

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
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
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
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["jobs"]["Row"], "id" | "created_at"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
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
        Insert: Omit<Database["public"]["Tables"]["datasets"]["Row"], "id" | "created_at"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["datasets"]["Row"]>;
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
        Insert: Omit<Database["public"]["Tables"]["credit_transactions"]["Row"], "id" | "created_at"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["credit_transactions"]["Row"]>;
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
        Insert: Omit<Database["public"]["Tables"]["wizard_sessions"]["Row"], "id" | "created_at" | "updated_at"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["wizard_sessions"]["Row"]>;
      };
    };
  };
}
