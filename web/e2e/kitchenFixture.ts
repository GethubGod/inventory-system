// Fixture accounts for the kitchen E2E suite. Runs ONLY against a local
// Supabase stack (the service-role key is required and the URL must be
// localhost): it creates auth users through the admin API and writes the
// profile / users / user_modules rows directly, then sets a name + PIN
// credential for the chef so the login-with-name path is exercised.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface KitchenFixtureUser {
  email: string;
  password: string;
  name: string;
  role: "manager" | "employee";
  modules: Partial<Record<"kitchen_requests" | "kitchen_display", boolean>>;
  /** Location short_code the account is pinned to, or null for all. */
  worksAt: "sushi" | "pokipho" | null;
  pin?: string;
  id?: string;
}

export const KITCHEN_USERS = {
  chef: {
    email: "kitchen-e2e-chef@example.com",
    password: "kitchen-e2e-chef-pass!",
    name: "Chef E2E",
    role: "employee",
    modules: { kitchen_requests: true },
    worksAt: null,
    pin: "4321",
  },
  display: {
    email: "kitchen-e2e-display@example.com",
    password: "kitchen-e2e-display-pass!",
    name: "Display E2E",
    role: "employee",
    modules: { kitchen_display: true },
    worksAt: null,
  },
  pokiDisplay: {
    email: "kitchen-e2e-poki-display@example.com",
    password: "kitchen-e2e-poki-display-pass!",
    name: "Poki Display E2E",
    role: "employee",
    modules: { kitchen_display: true },
    worksAt: "pokipho",
  },
  nobody: {
    email: "kitchen-e2e-nobody@example.com",
    password: "kitchen-e2e-nobody-pass!",
    name: "Nobody E2E",
    role: "employee",
    modules: {},
    worksAt: null,
  },
  manager: {
    email: "kitchen-e2e-manager@example.com",
    password: "kitchen-e2e-manager-pass!",
    name: "Manager E2E",
    role: "manager",
    modules: {},
    worksAt: null,
  },
} satisfies Record<string, KitchenFixtureUser>;

export type KitchenUserKey = keyof typeof KITCHEN_USERS;

export interface KitchenFixture {
  supabaseUrl: string;
  anonKey: string;
  users: Record<KitchenUserKey, KitchenFixtureUser & { id: string }>;
  locations: { sushi: string; pokipho: string };
  admin: SupabaseClient;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. The kitchen suite needs a LOCAL Supabase stack.`,
    );
  }
  return value;
}

function assertLocal(url: string): void {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
    throw new Error(
      `Refusing to create fixture accounts on ${url}: the kitchen E2E suite only runs against a local stack.`,
    );
  }
}

let cached: KitchenFixture | null = null;

/** Create (or reuse) every fixture account and return their ids. Idempotent. */
export async function ensureKitchenFixture(): Promise<KitchenFixture> {
  if (cached) return cached;
  const supabaseUrl = need("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = need("E2E_SERVICE_ROLE_KEY");
  assertLocal(supabaseUrl);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sushi = await ensureLocation(admin, "sushi", "Babytuna Sushi");
  const pokipho = await ensureLocation(admin, "pokipho", "Babytuna Poki & Pho");

  const users = {} as KitchenFixture["users"];
  for (const [key, spec] of Object.entries(KITCHEN_USERS) as Array<
    [KitchenUserKey, KitchenFixtureUser]
  >) {
    const id = await ensureAuthUser(admin, spec);
    const defaultLocation =
      spec.worksAt === "sushi"
        ? sushi
        : spec.worksAt === "pokipho"
          ? pokipho
          : null;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id,
        full_name: spec.name,
        role: spec.role,
        profile_completed: true,
        provider: "email",
        email: spec.email,
        is_suspended: false,
      },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`profiles: ${profileError.message}`);

    const { error: userError } = await admin.from("users").upsert(
      {
        id,
        email: spec.email,
        name: spec.name,
        role: spec.role,
        default_location_id: defaultLocation,
      },
      { onConflict: "id" },
    );
    if (userError) throw new Error(`users: ${userError.message}`);

    const { error: clearError } = await admin
      .from("user_modules")
      .delete()
      .eq("user_id", id)
      .in("module_key", ["kitchen_requests", "kitchen_display"]);
    if (clearError) throw new Error(`user_modules: ${clearError.message}`);
    const moduleRows = Object.entries(spec.modules).map(
      ([module_key, enabled]) => ({
        user_id: id,
        module_key,
        enabled: enabled === true,
        updated_by: null,
      }),
    );
    if (moduleRows.length > 0) {
      const { error: moduleError } = await admin
        .from("user_modules")
        .upsert(moduleRows, { onConflict: "user_id,module_key" });
      if (moduleError) throw new Error(`user_modules: ${moduleError.message}`);
    }

    if (spec.pin) await ensurePin(supabaseUrl, anonKey, spec, spec.pin);

    users[key] = { ...spec, id };
  }

  cached = {
    supabaseUrl,
    anonKey,
    users,
    locations: { sushi, pokipho },
    admin,
  };
  return cached;
}

/** The local stack's schema is DDL-only; mirror production's two locations. */
async function ensureLocation(
  admin: SupabaseClient,
  shortCode: string,
  name: string,
): Promise<string> {
  const { data: existing, error: findError } = await admin
    .from("locations")
    .select("id")
    .eq("short_code", shortCode)
    .limit(1);
  if (findError) throw new Error(`locations: ${findError.message}`);
  if (existing && existing.length > 0) return existing[0].id;
  const { data: created, error: insertError } = await admin
    .from("locations")
    .insert({
      name,
      short_code: shortCode,
      location_key: shortCode,
      active: true,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`locations: ${insertError.message}`);
  return created.id;
}

async function ensureAuthUser(
  admin: SupabaseClient,
  spec: KitchenFixtureUser,
): Promise<string> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: { full_name: spec.name },
  });
  if (!error && created.user) return created.user.id;
  // Already exists: find it and make sure the password matches.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(listError.message);
  const existing = list.users.find((user) => user.email === spec.email);
  if (!existing)
    throw new Error(`Cannot create or find ${spec.email}: ${error?.message}`);
  const { error: updateError } = await admin.auth.admin.updateUserById(
    existing.id,
    {
      password: spec.password,
      email_confirm: true,
    },
  );
  if (updateError) throw new Error(updateError.message);
  return existing.id;
}

async function ensurePin(
  supabaseUrl: string,
  anonKey: string,
  spec: KitchenFixtureUser,
  pin: string,
): Promise<void> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: spec.email,
    password: spec.password,
  });
  if (signInError)
    throw new Error(`sign in ${spec.email}: ${signInError.message}`);
  const { error } = await client.rpc("set_my_login_credential", {
    p_kind: "pin",
    p_secret: pin,
  });
  if (error) throw new Error(`set_my_login_credential: ${error.message}`);
  await client.auth.signOut();
}

/** Remove every request the fixture accounts created (between tests). */
export async function clearKitchenRequests(
  fixture: KitchenFixture,
): Promise<void> {
  const ids = Object.values(fixture.users).map((user) => user.id);
  const { error } = await fixture.admin
    .from("kitchen_requests")
    .delete()
    .in("requested_by", ids);
  if (error) throw new Error(error.message);
}

export async function countRequestsBy(
  fixture: KitchenFixture,
  userId: string,
): Promise<number> {
  const { count, error } = await fixture.admin
    .from("kitchen_requests")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Look up a seeded item id by name (service role). */
export async function kitchenItemId(
  fixture: KitchenFixture,
  name: string,
): Promise<string> {
  const { data, error } = await fixture.admin
    .from("kitchen_items")
    .select("id")
    .eq("name", name)
    .limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.id;
  if (typeof id !== "string") throw new Error(`No kitchen item named ${name}`);
  return id;
}

/**
 * Replay a send as a signed-in user through the real RPC, outside the
 * browser: proves the server treats the client key idempotently.
 */
export async function replaySendAs(
  fixture: KitchenFixture,
  who: KitchenUserKey,
  input: {
    clientKey: string;
    itemId: string;
    quantity: number;
    locationId: string;
  },
): Promise<{ id: string; status: string }> {
  const user = fixture.users[who];
  const client = createClient(fixture.supabaseUrl, fixture.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) throw new Error(signInError.message);
  const { data, error } = await client.rpc("kitchen_send_request", {
    p_client_key: input.clientKey,
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_location_id: input.locationId,
  });
  await client.auth.signOut();
  if (error) throw new Error(error.message);
  const row = data as { id?: unknown; status?: unknown } | null;
  if (!row || typeof row.id !== "string" || typeof row.status !== "string") {
    throw new Error("Unexpected kitchen_send_request response");
  }
  return { id: row.id, status: row.status };
}
