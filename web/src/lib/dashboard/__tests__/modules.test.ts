import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildModulePreset,
  fetchModulesForUser,
  getRoleDefaultModules,
  moduleKeysForRole,
  setUserModule,
  toModuleMap,
} from "../modules";

const rpc = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));
const getUser = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    rpc,
    from,
    auth: { getUser },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({
    data: { user: { id: "manager-id" } },
    error: null,
  });
});

describe("getRoleDefaultModules", () => {
  it("mirrors the SQL defaults for employees (ordering checklist + stock check)", () => {
    expect(getRoleDefaultModules("employee")).toEqual({
      ordering_simple: true,
      ordering_advanced: false,
      stock_check: true,
      tips: false,
      fulfillment: false,
      kitchen_requests: false,
      kitchen_display: false,
    });
  });

  it("mirrors the SQL defaults for managers (everything on)", () => {
    expect(Object.values(getRoleDefaultModules("manager"))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("moduleKeysForRole", () => {
  it("hides the manager-side fulfillment module from employee rows", () => {
    expect(moduleKeysForRole("employee")).toEqual([
      "ordering_simple",
      "ordering_advanced",
      "stock_check",
      "tips",
      "kitchen_requests",
      "kitchen_display",
    ]);
  });

  it("exposes all seven keys for managers", () => {
    expect(moduleKeysForRole("manager")).toContain("fulfillment");
    expect(moduleKeysForRole("manager")).toHaveLength(7);
  });
});

describe("toModuleMap", () => {
  it("folds RPC rows over role defaults and ignores junk", () => {
    const map = toModuleMap(
      [
        { module_key: "ordering_advanced", enabled: true },
        { module_key: "stock_check", enabled: false },
        { module_key: "not_a_module", enabled: true },
        { module_key: "tips", enabled: "yes" },
      ],
      "employee",
    );

    expect(map).toEqual({
      ordering_simple: true,
      ordering_advanced: true,
      stock_check: false,
      tips: false,
      fulfillment: false,
      kitchen_requests: false,
      kitchen_display: false,
    });
  });

  it("returns role defaults for an empty response", () => {
    expect(toModuleMap(null, "manager")).toEqual(
      getRoleDefaultModules("manager"),
    );
  });
});

describe("fetchModulesForUser", () => {
  it("reads through rpc get_effective_modules", async () => {
    rpc.mockResolvedValue({
      data: [{ module_key: "tips", enabled: true }],
      error: null,
    });

    const map = await fetchModulesForUser("employee-id", "employee");

    expect(rpc).toHaveBeenCalledWith("get_effective_modules", {
      p_user_id: "employee-id",
    });
    expect(map.tips).toBe(true);
    expect(map.ordering_simple).toBe(true);
  });

  it("surfaces RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not authorized" } });

    await expect(
      fetchModulesForUser("employee-id", "employee"),
    ).rejects.toThrow("not authorized");
  });
});

describe("setUserModule", () => {
  it("upserts the override and records the signed-in manager", async () => {
    upsert.mockResolvedValue({ error: null });

    await setUserModule("employee-id", "ordering_simple", true);

    expect(from).toHaveBeenCalledWith("user_modules");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "employee-id",
        module_key: "ordering_simple",
        enabled: true,
        updated_by: "manager-id",
      },
      { onConflict: "user_id,module_key" },
    );
  });

  it("refuses to write without a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(
      setUserModule("employee-id", "tips", false),
    ).rejects.toThrow("signed in");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("surfaces write errors", async () => {
    upsert.mockResolvedValue({ error: { message: "managers only" } });

    await expect(
      setUserModule("employee-id", "tips", true),
    ).rejects.toThrow("managers only");
  });
});

describe("buildModulePreset", () => {
  it("restricts the preset to keys valid for the invited role", () => {
    const selection = {
      ...getRoleDefaultModules("employee"),
      ordering_simple: true,
      fulfillment: true, // must be dropped for employees
    };

    expect(buildModulePreset("employee", selection)).toEqual({
      ordering_simple: true,
      ordering_advanced: false,
      stock_check: true,
      tips: false,
      kitchen_requests: false,
      kitchen_display: false,
    });
  });

  it("keeps fulfillment for manager invites", () => {
    const preset = buildModulePreset(
      "manager",
      getRoleDefaultModules("manager"),
    );
    expect(preset.fulfillment).toBe(true);
    expect(Object.keys(preset)).toHaveLength(7);
  });
});
