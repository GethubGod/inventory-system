"use client";

// The manager's flag rules, kept in this browser's localStorage. Display-time
// preferences only: nothing on the server changes when a rule changes, and
// Verify still clears a row for everyone.

import { useCallback, useState } from "react";
import { DEFAULT_FLAG_RULES, parseFlagRules, type FlagRules } from "@/lib/tips/flagRules";

const STORAGE_KEY = "smelter_tip_flag_rules";

function readStored(): FlagRules {
  try {
    if (typeof window === "undefined") return DEFAULT_FLAG_RULES;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseFlagRules(JSON.parse(raw)) : DEFAULT_FLAG_RULES;
  } catch {
    return DEFAULT_FLAG_RULES;
  }
}

export function useFlagRules(): [FlagRules, (rules: FlagRules) => void] {
  // Safe to read localStorage in the initializer: the shell only mounts
  // client-side behind the auth gate. try/catch covers blocked storage.
  const [rules, setRulesState] = useState<FlagRules>(readStored);
  const setRules = useCallback((next: FlagRules) => {
    setRulesState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preference simply won't persist.
    }
  }, []);
  return [rules, setRules];
}
