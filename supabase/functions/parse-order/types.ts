export type ParseStatus = 'ok' | 'needs_review' | 'needs_clarification' | 'qa_answer' | 'error';

export type QuickOrderSource = 'typed' | 'voice';

export type ProcessQuickOrderStatus =
  | 'success'
  | 'needs_clarification'
  | 'blocked'
  | 'partial_success'
  | 'qa_answer'
  | 'error';

export type QuickOrderModelUsed =
  | 'none'
  | 'gemini-2.5-flash'
  | 'gemini-3.1-pro'
  | 'other';

export type ParseSource = 'deterministic' | 'fuzzy' | 'llm' | 'manual' | 'correction';

export type ParsedItemStatus =
  | 'valid'
  | 'no_match'
  | 'missing_quantity'
  | 'missing_unit'
  | 'missing_quantity_and_unit'
  | 'ambiguous'
  | 'invalid_unit'
  | 'duplicate_needs_decision';

export type ParsedItemAction =
  | null
  | 'Add quantity'
  | 'Choose unit'
  | 'Fix unit'
  | 'Choose item'
  | 'Add or replace';

export type MatchType =
  | 'exact_name'
  | 'exact_alias'
  | 'correction'
  | 'parenthetical'
  | 'parenthetical_or_generated_exact'
  | 'parenthetical_exact'
  | 'generated_term_exact'
  | 'normalized_exact'
  | 'compact_exact'
  | 'token_set'
  | 'prefix'
  | 'plural_normalized'
  | 'ambiguous'
  | 'no_match'
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
  | 'choose_existing'
  | 'clear_order'
  | 'use_item'
  | 'use_unit'
  | 'request_approval';

export type CatalogItem = {
  id: string;
  name: string;
  aliases: string[];
  default_unit: string | null;
  base_unit?: string | null;
  pack_unit?: string | null;
  order_unit?: string | null;
  allowed_units?: string[] | null;
  unit_options?: string[] | null;
};

export type ItemOrderLimit = {
  id?: string;
  item_id: string;
  location_id: string | null;
  supplier_id?: string | null;
  default_order_unit?: string | null;
  typical_min_quantity?: number | null;
  typical_max_quantity?: number | null;
  soft_max_quantity?: number | null;
  hard_max_quantity?: number | null;
  manager_approval_quantity?: number | null;
  allow_employee_override?: boolean | null;
  allow_manager_override?: boolean | null;
  max_single_order_quantity?: number | null;
  max_daily_quantity?: number | null;
  max_weekly_quantity?: number | null;
  historical_median_quantity?: number | null;
  historical_p95_quantity?: number | null;
  historical_max_quantity?: number | null;
};

export type ItemAllowedUnitRule = {
  id?: string;
  item_id: string;
  unit: string;
  is_default?: boolean | null;
  conversion_to_base_unit?: number | null;
  min_quantity?: number | null;
  soft_max_quantity?: number | null;
  hard_max_quantity?: number | null;
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
  line_id: string;
  raw_text: string;
  normalized_text: string;
  item_text: string;
  quantity: number | null;
  unit: string | null;
  unit_raw?: string | null;
  unit_normalized?: string | null;
  parse_source: 'deterministic';
  parse_confidence: number;
  line_index: number;
  issue?: string;
};

export type CatalogAlternative = {
  item_id: string;
  item_name: string;
  confidence: number;
  term?: string;
  matched_term?: string;
  score?: number;
  match_type?: MatchType;
  reason?: string;
  token_coverage?: number;
  generic_token_overlap?: string[];
  specific_token_overlap?: string[];
  missing_specific_tokens?: string[];
  semantic_validation_passed?: boolean;
};

export type CatalogMatchResult = {
  item_id: string | null;
  item_name: string | null;
  display_name?: string;
  matched_alias?: string;
  match_type: MatchType;
  confidence: number;
  needs_clarification: boolean;
  issue?: string;
  reason?: string;
  matched_term?: string;
  token_coverage?: number;
  generic_token_overlap?: string[];
  specific_token_overlap?: string[];
  missing_specific_tokens?: string[];
  semantic_validation_passed?: boolean;
  alternatives?: CatalogAlternative[];
  confidence_tier?: 'high' | 'medium' | 'low';
  decision_reason?: string;
};

export type ParsedItem = {
  id?: string;
  client_id?: string;
  line_id?: string;
  client_key?: string;
  source_text?: string;
  item_id: string | null;
  item_name: string | null;
  display_name?: string;
  name?: string;
  item_text?: string;
  raw_token: string;
  raw_text?: string;
  quantity: number | null;
  unit: string | null;
  unit_raw?: string | null;
  unit_normalized?: string | null;
  valid_units?: string[];
  confidence: number;
  needs_clarification: boolean;
  unresolved: boolean;
  notes: string | null;
  issue?: string;
  issue_code?: ParsedItemStatus | 'unsupported_unit' | 'invalid_unit' | 'quantity_missing' | 'unit_missing' | 'item_not_found';
  action?: ParsedItemAction;
  alternatives?: CatalogAlternative[];
  candidate_matches?: CatalogAlternative[];
  parse_source?: ParseSource;
  status?: ParsedItemStatus;
  match_type?: MatchType;
  diagnostics?: Record<string, unknown>;
  pending_conflict_id?: string;
  merge_behavior?: 'add_to_existing' | 'replace_existing' | 'keep_separate';
  merge_delta_quantity?: number | null;
  existing_item_key?: string;
};

export type QuickOrderOperationType =
  | 'add'
  | 'remove'
  | 'replace'
  | 'update_quantity'
  | 'update_unit'
  | 'clear'
  | 'no_op';

export type QuickOrderOperation = {
  type: QuickOrderOperationType;
  target_item_id: string | null;
  target_display_name: string;
  target_item_key?: string;
  quantity?: number | null;
  unit?: string | null;
  status: 'applied' | 'pending' | 'failed';
  message?: string;
};

export type StockOperation = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  source: QuickOrderSource;
  confidence: number;
  original_text: string;
};

export type SafetyWarningType =
  | 'above_soft_max'
  | 'above_hard_max'
  | 'unusual_unit'
  | 'voice_number_risk'
  | 'low_confidence_match'
  | 'manager_approval_required';

export type SafetyWarning = {
  type: SafetyWarningType;
  message: string;
  item_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  severity: 'info' | 'warning' | 'blocked';
};

export type BlockedOperation = {
  type: 'cart_add' | 'cart_update' | 'stock_update' | 'recommendation';
  item_id?: string | null;
  item_name?: string | null;
  attempted_quantity?: number | null;
  unit?: string | null;
  reason: SafetyWarningType | 'catalog_missing' | 'invalid_request';
  message: string;
};

export type Recommendation = {
  item_id: string;
  item_name: string;
  suggested_quantity: number;
  unit: string | null;
  confidence: number;
  reason: string;
  inputs: {
    current_stock?: number | null;
    expected_usage?: number | null;
    safety_stock?: number | null;
    previous_average?: number | null;
    day_of_week_pattern?: number | null;
    next_delivery_date?: string | null;
  };
  safety_status: 'normal' | 'confirm' | 'manager_approval' | 'blocked';
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

export type ParseSuggestionItem = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_type: string | null;
};

export type ParseSuggestion = {
  type: 'reorder_recent' | 'reorder_last_week' | 'usual_item' | 'missing_item';
  title: string;
  message: string;
  items: ParseSuggestionItem[];
  confidence: number;
  action: 'preview' | 'add';
  item_id?: string;
  item_name?: string;
  suggested_qty?: number;
  unit?: string | null;
  unit_type?: string | null;
  reason?: string | null;
};

export type PendingQuickOrderAction = {
  id: ConflictActionId;
  label: string;
  preview?: string;
  existing_item_key?: string;
  unit?: string;
};

export type PendingQuickOrderClarification = {
  id: string;
  type:
    | 'quantity_conflict'
    | 'unit_conflict'
    | 'missing_quantity'
    | 'missing_unit'
    | 'ambiguous_item'
    | 'choose_existing_line'
    | 'clear_order'
    | 'remove_ambiguous'
    | 'item_not_found'
    | 'quantity_safety'
    | 'manager_approval_required'
    | 'low_confidence_match'
    | 'invalid_unit';
  item_id: string | null;
  item_name: string;
  existing_item_key?: string;
  existing_item_keys?: string[];
  incoming_item?: ParsedItem;
  message: string;
  actions: PendingQuickOrderAction[];
};

export type QuickOrderTimings = {
  total_ms: number;
  auth_ms?: number;
  context_load_ms?: number;
  deterministic_parse_ms?: number;
  catalog_match_ms?: number;
  safety_validation_ms?: number;
  llm_fallback_ms?: number;
  recommendation_engine_ms?: number;
  db_write_ms?: number;
  response_build_ms?: number;
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
  parser_version?: string;
  parse_mode?: string;
  catalog_count?: number;
  candidate_count?: number;
  items_before_validation?: number;
  items_after_validation?: number;
  valid_count?: number;
  review_count?: number;
  items_received?: number;
  items_accepted?: number;
  items_rejected?: number;
  rejected_reasons?: string[];
  pending_action_count?: number;
  unchanged_count?: number;
  repeated_existing_count?: number;
  llm_lines_sent?: number;
  llm_replaced_count?: number;
  replaced_review_count?: number;
  duplicate_line_count?: number;
  ignored_llm_extra_count?: number;
  item_diagnostics?: {
    line_id?: string;
    raw_text?: string;
    item_text?: string;
    quantity?: number | null;
    raw_unit?: string | null;
    normalized_unit?: string | null;
    matched_item_id?: string | null;
    matched_item_name?: string | null;
    match_type?: MatchType;
    match_confidence?: number;
    status?: ParsedItemStatus | 'no_op' | 'action_applied';
    action?: string | null;
    item_id?: string | null;
    item_name?: string | null;
    confidence?: number;
    reason?: string | null;
    issue?: string | null;
    alternatives?: CatalogAlternative[];
    top_alternatives?: CatalogAlternative[];
    failure_reason?: string | null;
    selected_item_id?: string | null;
    selected_item_name?: string | null;
    top_candidates?: CatalogAlternative[];
    ambiguity_reason?: string | null;
    selected_location_catalog_contains_exact?: boolean;
    global_catalog_contains_exact?: boolean;
    was_added_to_order_list?: boolean;
    no_op_reason?: string | null;
    pending_action_resolved?: boolean;
    existing_item_resolved?: boolean;
    action_type?: string | null;
    pending_action_id?: string | null;
    input_tokens?: string[];
    input_generic_tokens?: string[];
    input_specific_tokens?: string[];
    token_coverage?: number;
    generic_token_overlap?: string[];
    specific_token_overlap?: string[];
    missing_specific_tokens?: string[];
    semantic_validation_passed?: boolean;
    stale_status_corrected?: boolean;
  }[];
  catalog_debug?: {
    location_id?: string;
    catalog_count: number;
    global_catalog_count?: number;
    searched_terms: string[];
    catalog_contains: Record<string, boolean>;
    global_contains?: Record<string, boolean>;
    possible_matches: Record<string, CatalogAlternative[]>;
  };
  raw_input_length?: number;
  candidate_lines?: number;
  error_code?: string;
  input_classification?: string;
  input_classification_reason?: string;
  segment_count?: number;
  order_segment_count?: number;
  stock_segment_count?: number;
  recommendation_segment_count?: number;
  unknown_segment_count?: number;
  segment_intents?: {
    text: string;
    intent: string;
    reason: string;
  }[];
  suggestion_count?: number;
  history_lookup_result?: string;
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
  operations?: QuickOrderOperation[];
};

export type RecentMessage = QuickOrderMessage;

export type VoiceMetadata = {
  transcript_confidence?: number;
  raw_transcript?: string;
  language?: string;
};

export type ProcessQuickOrderMessageRequest = {
  source: QuickOrderSource;
  message: string;
  session_id: string | null;
  location_id: string;
  user_id: string;
  existing_items: ParsedItem[];
  recent_messages?: RecentMessage[];
  voice_metadata?: VoiceMetadata;
};

export type ProcessQuickOrderResponse = Omit<ParseResponse, 'status'> & {
  status: ProcessQuickOrderStatus;
  legacy_status: ParseStatus;
  display_message: string;
  speech_message: string;
  parsed_items: ParsedItem[];
  cart_operations: QuickOrderOperation[];
  stock_updates: StockOperation[];
  recommendations: Recommendation[];
  clarifications: PendingQuickOrderClarification[];
  safety_warnings: SafetyWarning[];
  blocked_operations: BlockedOperation[];
  model_used: QuickOrderModelUsed;
  confidence: number;
  timings: QuickOrderTimings;
};
