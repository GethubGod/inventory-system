import { supabase } from '@/lib/supabase';

const MODULE_KEYS = [
  'ordering_simple',
  'ordering_advanced',
  'stock_check',
  'tips',
  'fulfillment',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleState {
  key: ModuleKey;
  enabled: boolean;
}

type ModuleRow = {
  module_key: string;
  enabled: unknown;
};

function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && MODULE_KEYS.includes(value as ModuleKey);
}

function toModuleStates(rows: ModuleRow[] | null): ModuleState[] {
  return (rows ?? []).flatMap((row) => {
    if (!isModuleKey(row.module_key) || typeof row.enabled !== 'boolean') {
      return [];
    }

    return [{ key: row.module_key, enabled: row.enabled }];
  });
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new Error('You must be signed in to manage modules.');
  }

  return userId;
}

export async function getMyModules(): Promise<ModuleState[]> {
  return getModulesForUser(await getCurrentUserId());
}

export async function getModulesForUser(userId: string): Promise<ModuleState[]> {
  const { data, error } = await supabase.rpc('get_effective_modules', {
    p_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return toModuleStates((data ?? null) as ModuleRow[] | null);
}

export async function setUserModule(
  userId: string,
  key: ModuleKey,
  enabled: boolean,
): Promise<void> {
  const updatedBy = await getCurrentUserId();
  const { error } = await supabase
    .from('user_modules')
    .upsert(
      {
        user_id: userId,
        module_key: key,
        enabled,
        updated_by: updatedBy,
      },
      { onConflict: 'user_id,module_key' },
    );

  if (error) {
    throw error;
  }
}

export function subscribeToMyModules(onChange: () => void): () => void {
  let disposed = false;
  let channel: any = null;

  void (async () => {
    try {
      const userId = await getCurrentUserId();
      if (disposed) return;

      channel = supabase
        .channel(`user-module-updates-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_modules',
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .subscribe();
    } catch (error) {
      console.error('Failed to subscribe to module updates', error);
    }
  })();

  return () => {
    disposed = true;
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
