export type ParseStatus = 'ok' | 'needs_review' | 'needs_clarification' | 'error';

export type ParseSource = 'deterministic' | 'fuzzy' | 'llm' | 'manual' | 'correction';

export type ParsedItemStatus =
  | 'valid'
  | 'review'
  | 'missing_quantity'
  | 'missing_unit'
  | 'ambiguous'
  | 'invalid';

export type MatchType =
  | 'exact_name'
  | 'exact_alias'
  | 'correction'
  | 'normalized'
  | 'token'
  | 'fuzzy'
  | 'llm'
  | 'unresolved';

export type ConflictActionId =
  | 'add'
  | 'replace'
  | 'keep_separate'
  | 'cancel'
  | 'choose_existing';

export type CatalogItem = {
  id: string;
  name: string;
  aliases: string[];
  default_unit: string | null;
  base_unit?: string | null;
  pack_unit?: string | null;
  order_unit?: string | null;
  allowed_units?: string[] | null;
};

export type ParserExample = {
  id: string;
  raw_text: string;
  structured_output: unknown;
};

export type ParserCorrection = {
  raw_token: string;
  parser_suggested_item_id: string | null;
  user_corrected_item_id: string | null;
  user_corrected_qty: number | null;
  user_corrected_unit: string | null;
  location_id?: string | null;
  correction_type?: string | null;
};

export type QuickOrderMessage = {
  role?: string;
  content?: string;
  text?: string;
  raw_text?: string;
  reply_text?: string;
  parsed_items?: ParsedItem[];
  pending_clarifications?: PendingQuickOrderClarification[];
};

export type CandidateParsedLine = {
  raw_text: string;
  normalized_text: string;
  item_text: string;
  quantity: number | null;
  unit: string | null;
  parse_source: 'deterministic';
  parse_confidence: number;
  line_index: number;
  issue?: string;
};

export type CatalogAlternative = {
  item_id: string;
  item_name: string;
  confidence: number;
};

export type CatalogMatchResult = {
  item_id: string | null;
  item_name: string | null;
  matched_alias?: string;
  match_type: MatchType;
  confidence: number;
  needs_clarification: boolean;
  issue?: string;
  alternatives?: CatalogAlternative[];
};

export type ParsedItem = {
  id?: string;
  client_key?: string;
  item_id: string | null;
  item_name: string | null;
  display_name?: string;
  name?: string;
  raw_token: string;
  raw_text?: string;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  needs_clarification: boolean;
  unresolved: boolean;
  notes: string | null;
  issue?: string;
  alternatives?: CatalogAlternative[];
  parse_source?: ParseSource;
  status?: ParsedItemStatus;
  match_type?: MatchType;
  pending_conflict_id?: string;
  merge_behavior?: 'add_to_existing' | 'replace_existing' | 'keep_separate';
  existing_item_key?: string;
};

export type ParseFlag = {
  type:
    | 'llm_timeout'
    | 'llm_error'
    | 'invalid_item_id'
    | 'missing_quantity'
    | 'missing_unit'
    | 'unresolved_item'
    | 'ambiguous_item'
    | 'invalid_unit'
    | 'unsupported_unit'
    | 'invalid_json'
    | 'quantity_conflict';
  message: string;
  raw_token?: string;
  item_id?: string;
  possible_matches?: CatalogAlternative[];
  reason?: string;
};

export type ParseSuggestion = {
  item_id: string;
  item_name: string;
  suggested_qty: number;
  unit: string | null;
  unit_type: string | null;
  reason: string | null;
  confidence: number;
};

export type PendingQuickOrderAction = {
  id: ConflictActionId;
  label: string;
  preview?: string;
  existing_item_key?: string;
};

export type PendingQuickOrderClarification = {
  id: string;
  type:
    | 'quantity_conflict'
    | 'unit_conflict'
    | 'missing_quantity'
    | 'missing_unit'
    | 'ambiguous_item'
    | 'choose_existing_line';
  item_id: string | null;
  item_name: string;
  existing_item_key?: string;
  existing_item_keys?: string[];
  incoming_item?: ParsedItem;
  message: string;
  actions: PendingQuickOrderAction[];
};

export type ParserMetrics = {
  parse_mode_used: 'deterministic_only' | 'deterministic_plus_llm' | 'llm_only_fallback';
  lines_parsed: number;
  high_confidence_matches: number;
  fuzzy_matches: number;
  unresolved_items: number;
  conflicts: number;
  json_repair_needed: boolean;
  llm_failed: boolean;
  llm_used: boolean;
};

export type ParseDiagnostics = {
  parse_mode?: string;
  items_received?: number;
  items_accepted?: number;
  items_rejected?: number;
  rejected_reasons?: string[];
  pending_action_count?: number;
  unchanged_count?: number;
  repeated_existing_count?: number;
  raw_input_length?: number;
  candidate_lines?: number;
};

export type ParseResponse = {
  status?: ParseStatus;
  assistant_message?: string;
  reply_text: string;
  parsed_items: ParsedItem[];
  flags: ParseFlag[];
  suggestions: ParseSuggestion[];
  pending_actions?: PendingQuickOrderClarification[];
  pending_clarifications?: PendingQuickOrderClarification[];
  session_state: {
    total_items: number;
    ready_to_submit: boolean;
  };
  metrics?: ParserMetrics;
  diagnostics?: ParseDiagnostics;
};
