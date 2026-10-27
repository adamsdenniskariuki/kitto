export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          changed: string[];
          created_at: string;
          id: number;
          new_data: Json | null;
          old_data: Json | null;
          record_id: string;
          table_name: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          changed?: string[];
          created_at?: string;
          id?: never;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id: string;
          table_name: string;
          tenant_id: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          changed?: string[];
          created_at?: string;
          id?: never;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id?: string;
          table_name?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      customer_notes: {
        Row: {
          author_email: string | null;
          author_id: string | null;
          body: string;
          created_at: string;
          customer_id: string;
          id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_email?: string | null;
          author_id?: string | null;
          body: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          tenant_id: string;
        };
        Update: {
          author_email?: string | null;
          author_id?: string | null;
          body?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_notes_tenant_id_customer_id_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      customers: {
        Row: {
          archived_at: string | null;
          attributes: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string;
          phone: string | null;
          tags: string[];
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          attributes?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string;
          phone?: string | null;
          tags?: string[];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          attributes?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string;
          phone?: string | null;
          tags?: string[];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role_id: string;
          tenant_id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role_id: string;
          tenant_id: string;
          token?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role_id?: string;
          tenant_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_tenant_id_role_id_fkey';
            columns: ['tenant_id', 'role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      invoice_lines: {
        Row: {
          description: string;
          id: string;
          invoice_id: string;
          line_subtotal_minor: number | null;
          line_tax_minor: number | null;
          line_total_minor: number | null;
          position: number;
          quantity: number;
          tax_rate_bp: number;
          tenant_id: string;
          unit_price_minor: number;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          id?: string;
          invoice_id: string;
          line_subtotal_minor?: never;
          line_tax_minor?: never;
          line_total_minor?: never;
          position?: number;
          quantity?: number;
          tax_rate_bp?: number;
          tenant_id: string;
          unit_price_minor: number;
        };
        Update: {
          description?: string;
          id?: string;
          invoice_id?: string;
          line_subtotal_minor?: never;
          line_tax_minor?: never;
          line_total_minor?: never;
          position?: number;
          quantity?: number;
          tax_rate_bp?: number;
          tenant_id?: string;
          unit_price_minor?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_lines_tenant_id_invoice_id_fkey';
            columns: ['tenant_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      invoices: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string | null;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: string;
          notes: string;
          number: string | null;
          paid_minor: number;
          quote_id: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          subtotal_minor: number;
          tax_minor: number;
          tenant_id: string;
          total_minor: number;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id?: string | null;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          issued_at?: string | null;
          kind?: string;
          notes?: string;
          number?: string | null;
          paid_minor?: number;
          quote_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id: string;
          total_minor?: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id?: string | null;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          issued_at?: string | null;
          kind?: string;
          notes?: string;
          number?: string | null;
          paid_minor?: number;
          quote_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id?: string;
          total_minor?: number;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_tenant_id_customer_id_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['tenant_id', 'id'];
          },
          {
            foreignKeyName: 'invoices_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_tenant_id_quote_id_fkey';
            columns: ['tenant_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      mpesa_requests: {
        Row: {
          amount_minor: number;
          callback_token_hash: string;
          checkout_request_id: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          invoice_id: string;
          merchant_request_id: string | null;
          payload: Json | null;
          payment_id: string | null;
          phone: string;
          receipt: string | null;
          requested_by: string | null;
          result_code: number | null;
          result_desc: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_minor: number;
          callback_token_hash: string;
          checkout_request_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          invoice_id: string;
          merchant_request_id?: string | null;
          payload?: Json | null;
          payment_id?: string | null;
          phone: string;
          receipt?: string | null;
          requested_by?: string | null;
          result_code?: number | null;
          result_desc?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          callback_token_hash?: string;
          checkout_request_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          merchant_request_id?: string | null;
          payload?: Json | null;
          payment_id?: string | null;
          phone?: string;
          receipt?: string | null;
          requested_by?: string | null;
          result_code?: number | null;
          result_desc?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mpesa_requests_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mpesa_requests_tenant_id_invoice_id_fkey';
            columns: ['tenant_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['tenant_id', 'id'];
          },
          {
            foreignKeyName: 'mpesa_requests_tenant_id_payment_id_fkey';
            columns: ['tenant_id', 'payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      payments: {
        Row: {
          amount_minor: number;
          created_at: string;
          id: string;
          invoice_id: string;
          method: string;
          note: string;
          received_at: string;
          recorded_by: string | null;
          reference: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_minor: number;
          created_at?: string;
          id?: string;
          invoice_id: string;
          method: string;
          note?: string;
          received_at?: string;
          recorded_by?: string | null;
          reference?: string | null;
          tenant_id: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          method?: string;
          note?: string;
          received_at?: string;
          recorded_by?: string | null;
          reference?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_tenant_id_invoice_id_fkey';
            columns: ['tenant_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      permissions: {
        Row: {
          description: string;
          key: string;
          module: string;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          key: string;
          module: string;
        };
        Update: {
          description?: string;
          key?: string;
          module?: string;
        };
        Relationships: [];
      };
      reservation_series: {
        Row: {
          created_at: string;
          created_by: string | null;
          every: string;
          id: string;
          occurrences: number;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          every: string;
          id?: string;
          occurrences: number;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          every?: string;
          id?: string;
          occurrences?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reservation_series_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      reservations: {
        Row: {
          cancelled_at: string | null;
          checked_in_at: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          during: unknown;
          ends_at: string | null;
          guests: number;
          id: string;
          notes: string;
          price_minor: number;
          resource_id: string;
          series_id: string | null;
          source: string;
          starts_at: string | null;
          status: string;
          tenant_id: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          during: unknown;
          ends_at?: never;
          guests?: number;
          id?: string;
          notes?: string;
          price_minor?: number;
          resource_id: string;
          series_id?: string | null;
          source?: string;
          starts_at?: never;
          status?: string;
          tenant_id: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          during?: unknown;
          ends_at?: never;
          guests?: number;
          id?: string;
          notes?: string;
          price_minor?: number;
          resource_id?: string;
          series_id?: string | null;
          source?: string;
          starts_at?: never;
          status?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reservations_tenant_id_customer_id_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['tenant_id', 'id'];
          },
          {
            foreignKeyName: 'reservations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reservations_tenant_id_resource_id_fkey';
            columns: ['tenant_id', 'resource_id'];
            isOneToOne: false;
            referencedRelation: 'resources';
            referencedColumns: ['tenant_id', 'id'];
          },
          {
            foreignKeyName: 'reservations_tenant_id_series_id_fkey';
            columns: ['tenant_id', 'series_id'];
            isOneToOne: false;
            referencedRelation: 'reservation_series';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      resource_hours: {
        Row: {
          closes: string;
          id: string;
          opens: string;
          resource_id: string;
          tenant_id: string;
          weekday: number;
        };
        ComputedFields: never;
        Insert: {
          closes: string;
          id?: string;
          opens: string;
          resource_id: string;
          tenant_id: string;
          weekday: number;
        };
        Update: {
          closes?: string;
          id?: string;
          opens?: string;
          resource_id?: string;
          tenant_id?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'resource_hours_tenant_id_resource_id_fkey';
            columns: ['tenant_id', 'resource_id'];
            isOneToOne: false;
            referencedRelation: 'resources';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      resources: {
        Row: {
          active: boolean;
          attributes: NonNullable<Json>;
          capacity: number;
          created_at: string;
          description: string;
          id: string;
          kind: string;
          name: string;
          position: number;
          rate_minor: number;
          rate_unit: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          attributes?: NonNullable<Json>;
          capacity?: number;
          created_at?: string;
          description?: string;
          id?: string;
          kind?: string;
          name: string;
          position?: number;
          rate_minor?: number;
          rate_unit?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          attributes?: NonNullable<Json>;
          capacity?: number;
          created_at?: string;
          description?: string;
          id?: string;
          kind?: string;
          name?: string;
          position?: number;
          rate_minor?: number;
          rate_unit?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'resources_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      role_permissions: {
        Row: {
          created_at: string;
          permission_key: string;
          role_id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          permission_key: string;
          role_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          permission_key?: string;
          role_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permissions_permission_key_fkey';
            columns: ['permission_key'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['key'];
          },
          {
            foreignKeyName: 'role_permissions_tenant_id_role_id_fkey';
            columns: ['tenant_id', 'role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          is_system: boolean;
          key: string;
          name: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          is_system?: boolean;
          key: string;
          name: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          is_system?: boolean;
          key?: string;
          name?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'roles_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_members: {
        Row: {
          created_at: string;
          display_name: string;
          email: string;
          role_id: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string;
          email: string;
          role_id: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          email?: string;
          role_id?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_members_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_members_tenant_id_role_id_fkey';
            columns: ['tenant_id', 'role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['tenant_id', 'id'];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          locale: string;
          name: string;
          settings: NonNullable<Json>;
          slug: string;
          theme: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          locale?: string;
          name: string;
          settings?: NonNullable<Json>;
          slug: string;
          theme?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          locale?: string;
          name?: string;
          settings?: NonNullable<Json>;
          slug?: string;
          theme?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      available_resources: {
        Args: {
          p_ends_local: string;
          p_guests?: number;
          p_kind?: string;
          p_starts_local: string;
          p_tenant_id: string;
        };
        Returns: {
          active: boolean;
          attributes: NonNullable<Json>;
          capacity: number;
          created_at: string;
          description: string;
          id: string;
          kind: string;
          name: string;
          position: number;
          rate_minor: number;
          rate_unit: string;
          tenant_id: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'resources';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      available_slots: {
        Args: {
          p_day: string;
          p_duration_minutes: number;
          p_resource_id: string;
          p_step_minutes?: number;
        };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      convert_quote: { Args: { p_quote_id: string }; Returns: string };
      create_recurring_reservations: {
        Args: {
          p_customer_id?: string;
          p_duration_minutes: number;
          p_every: string;
          p_guests?: number;
          p_notes?: string;
          p_occurrences: number;
          p_resource_id: string;
          p_starts_local: string;
          p_title?: string;
        };
        Returns: {
          cancelled_at: string | null;
          checked_in_at: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          during: unknown;
          ends_at: string | null;
          guests: number;
          id: string;
          notes: string;
          price_minor: number;
          resource_id: string;
          series_id: string | null;
          source: string;
          starts_at: string | null;
          status: string;
          tenant_id: string;
          title: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'reservations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_reservation: {
        Args: {
          p_customer_id?: string;
          p_ends_local: string;
          p_guests?: number;
          p_notes?: string;
          p_resource_id: string;
          p_starts_local: string;
          p_status?: string;
          p_title?: string;
        };
        Returns: {
          cancelled_at: string | null;
          checked_in_at: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          during: unknown;
          ends_at: string | null;
          guests: number;
          id: string;
          notes: string;
          price_minor: number;
          resource_id: string;
          series_id: string | null;
          source: string;
          starts_at: string | null;
          status: string;
          tenant_id: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'reservations';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_tenant: { Args: { p_name: string; p_slug: string }; Returns: string };
      draft_invoice_for_source: {
        Args: {
          p_customer_id: string;
          p_lines: Json;
          p_source_id: string;
          p_source_type: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      has_permission: { Args: { p_permission: string; p_tenant_id: string }; Returns: boolean };
      issue_invoice: {
        Args: { p_invoice_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string | null;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: string;
          notes: string;
          number: string | null;
          paid_minor: number;
          quote_id: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          subtotal_minor: number;
          tax_minor: number;
          tenant_id: string;
          total_minor: number;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'invoices';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      mpesa_attach_checkout: {
        Args: {
          p_checkout_request_id: string;
          p_merchant_request_id: string;
          p_request_id: string;
        };
        Returns: undefined;
      };
      mpesa_fail_request: {
        Args: { p_request_id: string; p_result_code: number; p_result_desc: string };
        Returns: string;
      };
      mpesa_record_callback: { Args: { p_payload: Json; p_token: string }; Returns: string };
      mpesa_start_request: {
        Args: {
          p_amount_minor: number;
          p_invoice_id: string;
          p_phone: string;
          p_token_hash: string;
        };
        Returns: {
          account_reference: string;
          description: string;
          request_id: string;
        }[];
      };
      my_permissions: { Args: { p_tenant_id: string }; Returns: string[] };
      my_tenants: {
        Args: Record<PropertyKey, never>;
        Returns: {
          name: string;
          role_key: string;
          role_name: string;
          slug: string;
          tenant_id: string;
        }[];
      };
      normalize_phone: { Args: { p_phone: string }; Returns: string };
      reservation_price: {
        Args: { p_during: unknown; p_rate_minor: number; p_rate_unit: string; p_timezone: string };
        Returns: number;
      };
      save_invoice_draft: {
        Args: {
          p_customer_id: string;
          p_due_date: string;
          p_invoice_id: string;
          p_kind: string;
          p_lines: Json;
          p_notes: string;
          p_source_id?: string;
          p_source_type?: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string | null;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: string;
          notes: string;
          number: string | null;
          paid_minor: number;
          quote_id: string | null;
          source_id: string | null;
          source_type: string | null;
          status: string;
          subtotal_minor: number;
          tax_minor: number;
          tenant_id: string;
          total_minor: number;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'invoices';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
