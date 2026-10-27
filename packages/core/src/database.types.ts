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
      create_tenant: { Args: { p_name: string; p_slug: string }; Returns: string };
      has_permission: { Args: { p_permission: string; p_tenant_id: string }; Returns: boolean };
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
