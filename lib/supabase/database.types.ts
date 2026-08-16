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
      ad_unsubscribes: {
        Row: {
          channel: string
          created_at: string
          email: string | null
          expert_id: string | null
          id: string
          phone: string | null
          tenant_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          email?: string | null
          expert_id?: string | null
          id?: string
          phone?: string | null
          tenant_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          email?: string | null
          expert_id?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_unsubscribes_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_unsubscribes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_delegations: {
        Row: {
          created_at: string
          delegate_user_id: string
          delegator_user_id: string
          ends_on: string
          id: string
          is_active: boolean
          reason: string | null
          starts_on: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delegate_user_id: string
          delegator_user_id: string
          ends_on: string
          id?: string
          is_active?: boolean
          reason?: string | null
          starts_on: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delegate_user_id?: string
          delegator_user_id?: string
          ends_on?: string
          id?: string
          is_active?: boolean
          reason?: string | null
          starts_on?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_delegations_delegate_user_id_fkey"
            columns: ["delegate_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_delegations_delegator_user_id_fkey"
            columns: ["delegator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_delegations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rule_steps: {
        Row: {
          approver_user_id: string
          created_at: string
          id: string
          rule_id: string
          step_kind: string
          step_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approver_user_id: string
          created_at?: string
          id?: string
          rule_id: string
          step_kind?: string
          step_order: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approver_user_id?: string
          created_at?: string
          id?: string
          rule_id?: string
          step_kind?: string
          step_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rule_steps_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rule_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rule_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          approval_type: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          max_amount: number | null
          min_amount: number | null
          name: string
          priority: number
          superseded_by_id: string | null
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          approval_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number | null
          name: string
          priority?: number
          superseded_by_id?: string | null
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          approval_type?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          priority?: number
          superseded_by_id?: string | null
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_steps: {
        Row: {
          acted_at: string | null
          acted_by_user_id: string | null
          approval_id: string
          approver_user_id: string
          comment: string | null
          created_at: string
          id: string
          status: string
          step_kind: string
          step_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          acted_at?: string | null
          acted_by_user_id?: string | null
          approval_id: string
          approver_user_id: string
          comment?: string | null
          created_at?: string
          id?: string
          status?: string
          step_kind?: string
          step_order: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          acted_at?: string | null
          acted_by_user_id?: string | null
          approval_id?: string
          approver_user_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          status?: string
          step_kind?: string
          step_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_steps_acted_by_user_id_fkey"
            columns: ["acted_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          amount: number | null
          applied_rule_id: string | null
          approval_type: string
          body: string | null
          completed_at: string | null
          created_at: string
          id: string
          project_id: string | null
          requester_user_id: string
          resubmitted_from_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          applied_rule_id?: string | null
          approval_type?: string
          body?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          requester_user_id: string
          resubmitted_from_id?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          applied_rule_id?: string | null
          approval_type?: string
          body?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          requester_user_id?: string
          resubmitted_from_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_applied_rule_id_fkey"
            columns: ["applied_rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_resubmitted_from_id_fkey"
            columns: ["resubmitted_from_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      document_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          expert_id: string
          id: string
          message: string | null
          requested_by: string | null
          requested_types: string[]
          status: string
          tenant_id: string
          token_expires_at: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expert_id: string
          id?: string
          message?: string | null
          requested_by?: string | null
          requested_types: string[]
          status?: string
          tenant_id: string
          token_expires_at: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          message?: string | null
          requested_by?: string | null
          requested_types?: string[]
          status?: string
          tenant_id?: string
          token_expires_at?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requests_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          batch_id: string | null
          body: string
          created_at: string
          error_message: string | null
          id: string
          message_type: string
          recipient_email: string
          recipient_expert_id: string | null
          sent_by: string | null
          status: string
          subject: string
          tenant_id: string | null
        }
        Insert: {
          batch_id?: string | null
          body: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type: string
          recipient_email: string
          recipient_expert_id?: string | null
          sent_by?: string | null
          status: string
          subject: string
          tenant_id?: string | null
        }
        Update: {
          batch_id?: string | null
          body?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type?: string
          recipient_email?: string
          recipient_expert_id?: string | null
          sent_by?: string | null
          status?: string
          subject?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_recipient_expert_id_fkey"
            columns: ["recipient_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
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
      engagement_acceptances: {
        Row: {
          accepted_at: string
          created_at: string
          engagement_id: string
          expert_id: string
          expert_name: string
          fee_amount: number | null
          has_signature: boolean
          id: string
          letter_no: string
          project_name: string | null
          role_description: string
          seal_path: string | null
          signature_path: string | null
          signed_via: string
          signer_ip: string | null
          starts_on: string | null
          ends_on: string | null
          tenant_id: string
          tenant_name: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          engagement_id: string
          expert_id: string
          expert_name: string
          fee_amount?: number | null
          has_signature?: boolean
          id?: string
          letter_no: string
          project_name?: string | null
          role_description: string
          seal_path?: string | null
          signature_path?: string | null
          signed_via: string
          signer_ip?: string | null
          starts_on?: string | null
          ends_on?: string | null
          tenant_id: string
          tenant_name: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          engagement_id?: string
          expert_id?: string
          expert_name?: string
          fee_amount?: number | null
          has_signature?: boolean
          id?: string
          letter_no?: string
          project_name?: string | null
          role_description?: string
          seal_path?: string | null
          signature_path?: string | null
          signed_via?: string
          signer_ip?: string | null
          starts_on?: string | null
          ends_on?: string | null
          tenant_id?: string
          tenant_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_acceptances_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "expert_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_acceptances_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_acceptances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_cancellations: {
        Row: {
          canceled_at: string
          canceled_by: string | null
          created_at: string
          engagement_id: string
          expert_id: string
          id: string
          is_urgent: boolean
          prior_status: string
          project_id: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          canceled_at?: string
          canceled_by?: string | null
          created_at?: string
          engagement_id: string
          expert_id: string
          id?: string
          is_urgent?: boolean
          prior_status: string
          project_id?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          canceled_at?: string
          canceled_by?: string | null
          created_at?: string
          engagement_id?: string
          expert_id?: string
          id?: string
          is_urgent?: boolean
          prior_status?: string
          project_id?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_cancellations_canceled_by_fkey"
            columns: ["canceled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_cancellations_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "expert_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_cancellations_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_cancellations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_cancellations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      expert_engagements: {
        Row: {
          created_at: string
          ends_on: string | null
          expert_id: string
          fee_amount: number | null
          id: string
          message: string | null
          project_id: string | null
          requested_by: string | null
          responded_at: string | null
          response_note: string | null
          role_description: string
          starts_on: string | null
          status: string
          tenant_id: string
          token_expires_at: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          expert_id: string
          fee_amount?: number | null
          id?: string
          message?: string | null
          project_id?: string | null
          requested_by?: string | null
          responded_at?: string | null
          response_note?: string | null
          role_description: string
          starts_on?: string | null
          status?: string
          tenant_id: string
          token_expires_at: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          expert_id?: string
          fee_amount?: number | null
          id?: string
          message?: string | null
          project_id?: string | null
          requested_by?: string | null
          responded_at?: string | null
          response_note?: string | null
          role_description?: string
          starts_on?: string | null
          status?: string
          tenant_id?: string
          token_expires_at?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_engagements_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_engagements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_engagements_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_engagements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_evaluations: {
        Row: {
          created_at: string
          engagement_id: string | null
          evaluator_user_id: string | null
          expert_id: string
          id: string
          project_id: string
          reason: string | null
          score: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          engagement_id?: string | null
          evaluator_user_id?: string | null
          expert_id: string
          id?: string
          project_id: string
          reason?: string | null
          score: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          engagement_id?: string | null
          evaluator_user_id?: string | null
          expert_id?: string
          id?: string
          project_id?: string
          reason?: string | null
          score?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_evaluations_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "expert_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_evaluations_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_evaluations_evaluator_user_id_fkey"
            columns: ["evaluator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_evaluations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_evaluations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      expert_payment_batches: {
        Row: {
          approval_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          last_rejection_note: string | null
          paid_at: string | null
          project_id: string | null
          status: string
          tenant_id: string
          title: string
          total_gross: number
          total_net: number
          total_withholding: number
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_rejection_note?: string | null
          paid_at?: string | null
          project_id?: string | null
          status?: string
          tenant_id: string
          title: string
          total_gross?: number
          total_net?: number
          total_withholding?: number
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_rejection_note?: string | null
          paid_at?: string | null
          project_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          total_gross?: number
          total_net?: number
          total_withholding?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_payment_batches_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_payment_items: {
        Row: {
          batch_id: string
          created_at: string
          engagement_id: string
          expert_id: string
          gross_amount: number
          id: string
          net_amount: number
          payment_type: string
          tenant_id: string
          updated_at: string
          withholding_amount: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          engagement_id: string
          expert_id: string
          gross_amount: number
          id?: string
          net_amount: number
          payment_type: string
          tenant_id: string
          updated_at?: string
          withholding_amount: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          engagement_id?: string
          expert_id?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          payment_type?: string
          tenant_id?: string
          updated_at?: string
          withholding_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "expert_payment_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "expert_payment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_items_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "expert_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_items_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_payment_items_tenant_id_fkey"
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
          secondary_phone: string | null
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
          secondary_phone?: string | null
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
          secondary_phone?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expert_bank_accounts: {
        Row: {
          account_holder: string | null
          account_last4: string | null
          account_number_enc: string | null
          bank_name: string | null
          expert_id: string
          updated_at: string
        }
        Insert: {
          account_holder?: string | null
          account_last4?: string | null
          account_number_enc?: string | null
          bank_name?: string | null
          expert_id: string
          updated_at?: string
        }
        Update: {
          account_holder?: string | null
          account_last4?: string | null
          account_number_enc?: string | null
          bank_name?: string | null
          expert_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_bank_accounts_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      rrn_fragments_front: {
        Row: {
          alg: string
          created_at: string
          expert_id: string
          front_ciphertext: string
          id: string
          project_id: string | null
          purged_at: string | null
          tenant_id: string | null
          wrapped_dek: string
        }
        Insert: {
          alg?: string
          created_at?: string
          expert_id: string
          front_ciphertext: string
          id?: string
          project_id?: string | null
          purged_at?: string | null
          tenant_id?: string | null
          wrapped_dek: string
        }
        Update: {
          alg?: string
          created_at?: string
          expert_id?: string
          front_ciphertext?: string
          id?: string
          project_id?: string | null
          purged_at?: string | null
          tenant_id?: string | null
          wrapped_dek?: string
        }
        Relationships: []
      }
      tenant_rrn_keys: {
        Row: {
          alg: string
          created_at: string
          kdf_params: Json
          kdf_salt: string
          public_key_jwk: Json
          tenant_id: string
          updated_at: string | null
          wrap_iv: string
          wrapped_private_key: string
        }
        Insert: {
          alg?: string
          created_at?: string
          kdf_params: Json
          kdf_salt: string
          public_key_jwk: Json
          tenant_id: string
          updated_at?: string | null
          wrap_iv: string
          wrapped_private_key: string
        }
        Update: {
          alg?: string
          created_at?: string
          kdf_params?: Json
          kdf_salt?: string
          public_key_jwk?: Json
          tenant_id?: string
          updated_at?: string | null
          wrap_iv?: string
          wrapped_private_key?: string
        }
        Relationships: []
      }
      tax_access_grants: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          role_label: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          role_label?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          role_label?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tax_access_logs: {
        Row: {
          access_type: string
          accessed_at: string
          accessor_label: string | null
          created_at: string
          expert_id: string
          id: string
          project_id: string | null
          project_name: string | null
          reason: string
          tenant_id: string | null
          tenant_name: string | null
        }
        Insert: {
          access_type?: string
          accessed_at?: string
          accessor_label?: string | null
          created_at?: string
          expert_id: string
          id?: string
          project_id?: string | null
          project_name?: string | null
          reason: string
          tenant_id?: string | null
          tenant_name?: string | null
        }
        Update: {
          access_type?: string
          accessed_at?: string
          accessor_label?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          project_id?: string | null
          project_name?: string | null
          reason?: string
          tenant_id?: string | null
          tenant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_access_logs_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_inquiries: {
        Row: {
          company_name: string
          contact_name: string
          created_at: string
          email: string
          handled_by: string | null
          id: string
          inquiry_type: string
          message: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_name: string
          contact_name: string
          created_at?: string
          email: string
          handled_by?: string | null
          id?: string
          inquiry_type?: string
          message?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          contact_name?: string
          created_at?: string
          email?: string
          handled_by?: string | null
          id?: string
          inquiry_type?: string
          message?: string | null
          phone?: string | null
          source?: string | null
          status?: string
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
      project_contributions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          percentage: number
          project_id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          percentage: number
          project_id: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          percentage?: number
          project_id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contributions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          business_year: number
          client_name: string | null
          closed_at: string | null
          closing_approval_id: string | null
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
          closed_at?: string | null
          closing_approval_id?: string | null
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
          closed_at?: string | null
          closing_approval_id?: string | null
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
            foreignKeyName: "projects_closing_approval_id_fkey"
            columns: ["closing_approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
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
      sms_logs: {
        Row: {
          batch_id: string | null
          body: string
          created_at: string
          error_message: string | null
          id: string
          message_type: string
          provider: string | null
          recipient_expert_id: string | null
          recipient_phone: string
          sent_by: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          batch_id?: string | null
          body: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type: string
          provider?: string | null
          recipient_expert_id?: string | null
          recipient_phone: string
          sent_by?: string | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          batch_id?: string | null
          body?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_type?: string
          provider?: string | null
          recipient_expert_id?: string | null
          recipient_phone?: string
          sent_by?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_recipient_expert_id_fkey"
            columns: ["recipient_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_tenant_id_fkey"
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
      tenant_alerts: {
        Row: {
          body: string | null
          category: string
          created_at: string
          created_by: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          resource_id: string | null
          resource_type: string | null
          severity: string
          tenant_id: string
          title: string
        }
        Insert: {
          body?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          tenant_id: string
          title: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_alerts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_alerts_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_configs: {
        Row: {
          api_key_encrypted: string
          api_secret_encrypted: string | null
          created_at: string
          id: string
          is_active: boolean
          provider: string
          sender_number: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted: string
          api_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          provider: string
          sender_number: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string
          api_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          sender_number?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      unsubscribe_tokens: {
        Row: {
          channel: string
          created_at: string
          email: string | null
          expert_id: string | null
          id: string
          phone: string | null
          tenant_id: string
          token_hash: string
        }
        Insert: {
          channel?: string
          created_at?: string
          email?: string | null
          expert_id?: string | null
          id?: string
          phone?: string | null
          tenant_id: string
          token_hash: string
        }
        Update: {
          channel?: string
          created_at?: string
          email?: string | null
          expert_id?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribe_tokens_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unsubscribe_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_requests: {
        Row: {
          approval_id: string | null
          auto_source: string | null
          created_at: string
          destination: string | null
          distance_km: number
          fuel_cost: number
          fuel_efficiency_kmpl: number
          fuel_price_per_l: number
          fuel_type: string
          id: string
          note: string | null
          origin: string | null
          other_cost: number
          purpose: string
          requester_user_id: string
          round_trip: boolean
          tenant_id: string
          toll_cost: number
          total_cost: number
          travel_date: string | null
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          auto_source?: string | null
          created_at?: string
          destination?: string | null
          distance_km?: number
          fuel_cost?: number
          fuel_efficiency_kmpl?: number
          fuel_price_per_l?: number
          fuel_type?: string
          id?: string
          note?: string | null
          origin?: string | null
          other_cost?: number
          purpose: string
          requester_user_id: string
          round_trip?: boolean
          tenant_id: string
          toll_cost?: number
          total_cost?: number
          travel_date?: string | null
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          auto_source?: string | null
          created_at?: string
          destination?: string | null
          distance_km?: number
          fuel_cost?: number
          fuel_efficiency_kmpl?: number
          fuel_price_per_l?: number
          fuel_type?: string
          id?: string
          note?: string | null
          origin?: string | null
          other_cost?: number
          purpose?: string
          requester_user_id?: string
          round_trip?: boolean
          tenant_id?: string
          toll_cost?: number
          total_cost?: number
          travel_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_requests_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_requests_requester_user_id_fkey"
            columns: ["requester_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      expert_portal_payments: {
        Row: {
          confirmed_at: string | null
          created_at: string | null
          engagement_id: string | null
          gross_amount: number | null
          id: string | null
          net_amount: number | null
          paid_at: string | null
          status: string | null
          tenant_name: string | null
          withholding_amount: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      snapshot_tenant_usage: { Args: { target_date?: string }; Returns: number }
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
