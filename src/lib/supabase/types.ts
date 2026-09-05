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
          likes_count: number;
          chats_count: number;
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
          likes_count?: number;
          chats_count?: number;
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
          likes_count?: number;
          chats_count?: number;
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
      experts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          slug: string | null;
          description: string | null;
          system_prompt: string | null;
          avatar_url: string | null;
          is_published: boolean;
          likes_count: number;
          chats_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          slug?: string | null;
          description?: string | null;
          system_prompt?: string | null;
          avatar_url?: string | null;
          is_published?: boolean;
          likes_count?: number;
          chats_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          slug?: string | null;
          description?: string | null;
          system_prompt?: string | null;
          avatar_url?: string | null;
          is_published?: boolean;
          likes_count?: number;
          chats_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expert_chunks: {
        Row: {
          id: string;
          expert_id: string;
          content: string;
          embedding: string | null;
          source_filename: string | null;
          chunk_index: number | null;
          section_title: string | null;
          section_tier: string | null;
          section_index: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          expert_id: string;
          content: string;
          embedding?: string | null;
          source_filename?: string | null;
          chunk_index?: number | null;
          section_title?: string | null;
          section_tier?: string | null;
          section_index?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          expert_id?: string;
          content?: string;
          embedding?: string | null;
          source_filename?: string | null;
          chunk_index?: number | null;
          section_title?: string | null;
          section_tier?: string | null;
          section_index?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_likes: {
        Row: {
          id: string;
          user_id: string;
          target_id: string;
          target_type: "expert" | "job";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          target_id: string;
          target_type: "expert" | "job";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          target_id?: string;
          target_type?: "expert" | "job";
          created_at?: string;
        };
        Relationships: [];
      };
      expert_conversations: {
        Row: {
          id: string;
          user_id: string;
          expert_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          expert_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          expert_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expert_messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "model" | "system";
          content: string;
          sources: Json;
          web_sources: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: "user" | "model" | "system";
          content: string;
          sources?: Json;
          web_sources?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: "user" | "model" | "system";
          content?: string;
          sources?: Json;
          web_sources?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_expert_chunks: {
        Args: {
          query_embedding: string;
          target_expert_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: {
          id: string;
          content: string;
          source_filename: string;
          chunk_index: number;
          similarity: number;
          section_title: string | null;
          section_tier: string | null;
        }[];
      };
      increment_expert_likes: {
        Args: { expert_id: string };
        Returns: number;
      };
      increment_job_likes: {
        Args: { job_id: string };
        Returns: number;
      };
      increment_expert_chats: {
        Args: { expert_id: string };
        Returns: number;
      };
      increment_job_chats: {
        Args: { job_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

