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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_consents: {
        Row: {
          auth_user_id: string | null
          channel: string
          created_at: string
          expert_id: string | null
          granted: boolean
          granted_at: string | null
          id: string
          revoked_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          channel: string
          created_at?: string
          expert_id?: string | null
          granted: boolean
          granted_at?: string | null
          id?: string
          revoked_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          channel?: string
          created_at?: string
          expert_id?: string | null
          granted?: boolean
          granted_at?: string | null
          id?: string
          revoked_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_consents_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_auth_user_id: string | null
          actor_role: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          ip_address: unknown
          resource_id: string | null
          resource_type: string
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_auth_user_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_auth_user_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      consents: {
        Row: {
          auth_user_id: string
          consent_type: string
          created_at: string
          granted: boolean
          id: string
          target_tenant_id: string | null
          terms_version: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          consent_type: string
          created_at?: string
          granted: boolean
          id?: string
          target_tenant_id?: string | null
          terms_version: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          consent_type?: string
          created_at?: string
          granted?: boolean
          id?: string
          target_tenant_id?: string | null
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_document_grants: {
        Row: {
          created_at: string
          document_type: string
          granted_at: string
          id: string
          link_id: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          granted_at?: string
          id?: string
          link_id: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          granted_at?: string
          id?: string
          link_id?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_document_grants_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "expert_tenant_links"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_document_history: {
        Row: {
          action: string
          actor_auth_user_id: string | null
          created_at: string
          document_id: string
          expert_id: string
          id: string
          updated_at: string
        }
        Insert: {
          action: string
          actor_auth_user_id?: string | null
          created_at?: string
          document_id: string
          expert_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_auth_user_id?: string | null
          created_at?: string
          document_id?: string
          expert_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_document_history_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "expert_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_document_history_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_documents: {
        Row: {
          created_at: string
          destroyed_at: string | null
          document_type: string
          expert_id: string
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          destroyed_at?: string | null
          document_type: string
          expert_id: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          destroyed_at?: string | null
          document_type?: string
          expert_id?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_documents_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_invitations: {
        Row: {
          completed_at: string | null
          completed_expert_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          invited_name: string | null
          invited_phone: string | null
          status: string
          tenant_id: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_expert_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          invited_name?: string | null
          invited_phone?: string | null
          status?: string
          tenant_id: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_expert_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invited_name?: string | null
          invited_phone?: string | null
          status?: string
          tenant_id?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_invitations_completed_expert_id_fkey"
            columns: ["completed_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_tax_profiles: {
        Row: {
          business_registration_number: string | null
          created_at: string
          expert_id: string
          id: string
          payment_type: string | null
          updated_at: string
        }
        Insert: {
          business_registration_number?: string | null
          created_at?: string
          expert_id: string
          id?: string
          payment_type?: string | null
          updated_at?: string
        }
        Update: {
          business_registration_number?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          payment_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_tax_profiles_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_tenant_links: {
        Row: {
          accepted_at: string | null
          created_at: string
          expert_id: string
          id: string
          requested_at: string
          revoked_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          expert_id: string
          id?: string
          requested_at?: string
          revoked_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          requested_at?: string
          revoked_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_tenant_links_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_tenant_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          auth_user_id: string | null
          bio: string | null
          career_years: number | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string
          region: string | null
          specialty: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          bio?: string | null
          career_years?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone: string
          region?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          bio?: string | null
          career_years?: number | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string
          region?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_lifecycle_steps: {
        Row: {
          assignee_user_id: string | null
          completed_at: string | null
          created_at: string
          due_on: string | null
          id: string
          project_id: string
          status: string
          step_no: number
          step_type: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_on?: string | null
          id?: string
          project_id: string
          status?: string
          step_no: number
          step_type: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_on?: string | null
          id?: string
          project_id?: string
          status?: string
          step_no?: number
          step_type?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_lifecycle_steps_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_lifecycle_steps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_lifecycle_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          business_year: number
          client_name: string | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_on: string | null
          id: string
          name: string
          starts_on: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          business_year: number
          client_name?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          id?: string
          name: string
          starts_on?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          business_year?: number
          client_name?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          starts_on?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          created_at: string
          data_category: string
          id: string
          retention_days: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_category: string
          id?: string
          retention_days: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_category?: string
          id?: string
          retention_days?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_project_grants: {
        Row: {
          created_at: string
          expert_id: string
          expires_at: string | null
          id: string
          project_id: string | null
          remaining_view_count: number | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expert_id: string
          expires_at?: string | null
          id?: string
          project_id?: string | null
          remaining_view_count?: number | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expert_id?: string
          expires_at?: string | null
          id?: string
          project_id?: string | null
          remaining_view_count?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_project_grants_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_project_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_project_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage_metrics: {
        Row: {
          active_user_count: number
          created_at: string
          email_sent_count: number
          id: string
          metric_date: string
          project_count: number
          sms_sent_count: number
          storage_used_bytes: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active_user_count?: number
          created_at?: string
          email_sent_count?: number
          id?: string
          metric_date: string
          project_count?: number
          sms_sent_count?: number
          storage_used_bytes?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active_user_count?: number
          created_at?: string
          email_sent_count?: number
          id?: string
          metric_date?: string
          project_count?: number
          sms_sent_count?: number
          storage_used_bytes?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_usage_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          brand_color: string | null
          business_registration_number: string | null
          contract_ends_on: string | null
          contract_started_on: string | null
          created_at: string
          feature_flags: Json
          id: string
          logo_url: string | null
          name: string
          plan_name: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_color?: string | null
          business_registration_number?: string | null
          contract_ends_on?: string | null
          contract_started_on?: string | null
          created_at?: string
          feature_flags?: Json
          id?: string
          logo_url?: string | null
          name: string
          plan_name?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_color?: string | null
          business_registration_number?: string | null
          contract_ends_on?: string | null
          contract_started_on?: string | null
          created_at?: string
          feature_flags?: Json
          id?: string
          logo_url?: string | null
          name?: string
          plan_name?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          department: string | null
          email: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          position_id: string | null
          role: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          email: string
          id: string
          is_active?: boolean
          name: string
          phone?: string | null
          position_id?: string | null
          role?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          position_id?: string | null
          role?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
