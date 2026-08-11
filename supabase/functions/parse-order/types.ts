export type ParseStatus = 'ok' | 'needs_review' | 'needs_clarification' | 'unit_unrecognized' | 'qa_answer' | 'error';

export type QuickOrderSource = 'typed' | 'voice';

export type ComposerMode = 'order' | 'inventory';

export type ProcessQuickOrderStatus =
  | 'success'
  | 'needs_clarification'
  | 'unit_unrecognized'
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
  | 'employee_alias'
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
  supplier_id?: string | null;
  location_id?: string | null;
  allowed_units?: string[] | null;
  unit_options?: string[] | null;
  hard_cap?: number | null;
  soft_cap?: number | null;
  safety_stock?: number | null;
  target_stock?: number | null;
  default_order_unit?: string | null;
  qo_item_id?: string | null;
  tracking_unit?: string | null;
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
  employee_names?: string | null;
  max_quantity?: number | null;
  order_quantity?: number | null;
  order_unit?: string | null;
};

export type EmployeeQuickOrderAlias = {
  id?: string;
  employee_name: string;
  employee_name_key: string;
  employee_user_id?: string | null;
  alias_text: string;
  alias_key: string;
  inventory_item_id: string;
  location_id?: string | null;
  active?: boolean | null;
  notes?: string | null;
  source?: string | null;
};

export type QuickOrderRuleScope = 'global' | 'employee';
export type QuickOrderRuleModeScope = 'order' | 'inventory' | 'both';

export type QuickOrderResolutionMetadata = {
  reason_codes?: string[];
  resolution_trace?: string[];
  alias_source?: 'employee' | 'global' | 'exact' | 'fuzzy' | null;
  unit_source?: 'employee_rule' | 'global_rule' | 'item_default' | 'typed' | null;
  unit_resolution_scope?: 'employee' | 'global' | 'item_default' | 'unrecognized' | null;
  reorder_rule_source?: 'employee_rule' | 'global_rule' | 'target_stock' | 'none' | null;
  status_term_applied?: string | null;
  confidence?: number;
  user_visible_note?: string | null;
};

export type QuickOrderAliasRule = {
  id?: string;
  alias_text: string;
  alias_key?: string | null;
  item_id: string;
  scope_type: QuickOrderRuleScope;
  employee_name?: string | null;
  employee_name_key?: string | null;
  employee_user_id?: string | null;
  mode_scope: QuickOrderRuleModeScope;
  location_id?: string | null;
  active?: boolean | null;
  notes?: string | null;
  source?: string | null;
};

export type QuickOrderUnitRule = {
  id?: string;
  item_id?: string | null;
  from_unit?: string | null;
  from_unit_key?: string | null;
  to_unit: string;
  multiplier: number;
  scope_type: QuickOrderRuleScope;
  employee_name?: string | null;
  employee_name_key?: string | null;
  employee_user_id?: string | null;
  mode_scope: QuickOrderRuleModeScope;
  location_id?: string | null;
  is_default_when_missing?: boolean | null;
  active?: boolean | null;
  notes?: string | null;
  source?: string | null;
  is_custom_counting_unit?: boolean | null;
  tracking_unit?: string | null;
};

export type QuickOrderReorderRule = {
  id?: string;
  item_id: string;
  scope_type: QuickOrderRuleScope;
  employee_name?: string | null;
  employee_name_key?: string | null;
  employee_user_id?: string | null;
  mode_scope: QuickOrderRuleModeScope;
  location_id?: string | null;
  counted_unit?: string | null;
  trigger_type: 'below' | 'at_or_below' | 'between' | 'equal' | 'status';
  trigger_qty_min?: number | null;
  trigger_qty_max?: number | null;
  action_type: 'fixed_order_qty' | 'top_up_to_target' | 'no_order' | 'ask';
  order_qty?: number | null;
  order_unit?: string | null;
  target_qty?: number | null;
  target_unit?: string | null;
  priority?: number | null;
  active?: boolean | null;
  notes?: string | null;
  source?: string | null;
};

export type QuickOrderStatusTerm = {
  id?: string;
  phrase: string;
  phrase_key?: string | null;
  status: 'enough' | 'out' | 'low' | 'unknown';
  recommendation_action: 'no_order' | 'order_needed' | 'calculate_order' | 'ask';
  active?: boolean | null;
  notes?: string | null;
  source?: string | null;
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
  stock_updates?: StockOperation[];
  inventory_updates?: {
    item_id?: string | null;
    item_name?: string | null;
    current_quantity?: number | null;
    current_unit?: string | null;
    new_quantity?: number | null;
    new_unit?: string | null;
    no_order_reason?: string | null;
  }[];
  safety_warnings?: SafetyWarning[];
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
  /** Phrase from the employee's personal alias that resolved this item, if any. */
  matched_alias?: string | null;
  diagnostics?: Record<string, unknown>;
  resolution?: QuickOrderResolutionMetadata;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
  pending_conflict_id?: string;
  merge_behavior?: 'add_to_existing' | 'replace_existing' | 'keep_separate';
  merge_delta_quantity?: number | null;
  existing_item_key?: string;
  source?: 'manual' | 'voice' | 'inventory_recommendation' | 'remaining_recommendation' | 'remaining_inventory' | 'history_reorder' | 'missing_item';
  isSuggested?: boolean;
  suggestionReason?: string;
  suggestionSource?: 'remaining_inventory' | 'missing_item' | 'history';
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
  tracking_unit?: string | null;
  /**
   * True when the employee typed a quantity with no unit. The unit was filled
   * in from the item itself, so it should be treated as the item's only/implied
   * unit rather than a distinct unit that needs conversion.
   */
  unit_inferred?: boolean;
  approximate_modifier?: 'about' | 'almost' | 'around' | 'only' | 'low' | null;
  source: QuickOrderSource;
  confidence: number;
  original_text: string;
  /**
   * When set, this item was resolved from the employee's personal Quick Order
   * alias — the phrase they typed (e.g. "shrimp"). Surfaced so the UI can show
   * that personalization, not a generic match, linked the term to the item.
   */
  personal_alias?: string | null;
  resolution?: QuickOrderResolutionMetadata;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type UnitUnrecognizedError = {
  status: 'unit_unrecognized';
  item: string;
  item_id?: string | null;
  quantity: number | null;
  unit_typed: string;
  message: string;
  suggested_units: string[];
  original_text?: string | null;
  resolution?: QuickOrderResolutionMetadata | null;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type InventoryStatusTermStatus = 'enough' | 'zero' | 'partial' | 'low' | 'unknown';
export type InventoryStatusRemainingUnitBehavior = 'none' | 'detected_unit' | 'item_default_unit';
export type InventoryStatusRecommendationAction =
  | 'no_order'
  | 'check_reorder_rule'
  | 'ask_quantity'
  | 'use_existing_recommendation_engine';

export type InventoryStatusTerm = {
  id?: string;
  active?: boolean | null;
  phrase: string;
  phrase_key: string;
  status: InventoryStatusTermStatus;
  remaining_qty?: number | null;
  remaining_unit_behavior: InventoryStatusRemainingUnitBehavior;
  recommendation_action: InventoryStatusRecommendationAction;
  priority?: number | null;
  notes?: string | null;
  source?: string | null;
};

export type InventoryStatusItem = {
  item_id: string | null;
  item_name: string | null;
  item_text: string;
  phrase: string;
  phrase_key: string;
  status: InventoryStatusTermStatus;
  recommendation_action: InventoryStatusRecommendationAction;
  remaining_qty: number | null;
  remaining_unit: string | null;
  original_text: string;
  confidence: number;
  issue?: string | null;
  missing_quantity?: number | null;
  suggested_units?: string[];
  resolution?: QuickOrderResolutionMetadata | null;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type SafetyWarningType =
  | 'above_soft_max'
  | 'above_hard_max'
  | 'unusual_unit'
  | 'voice_number_risk'
  | 'low_confidence_match'
  | 'manager_approval_required'
  | 'recommendation_unavailable'
  | 'no_order_needed';

export type SafetyWarning = {
  type: SafetyWarningType;
  message: string;
  item_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  original_text?: string | null;
  severity: 'info' | 'warning' | 'blocked';
  resolution?: QuickOrderResolutionMetadata;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
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
  recommendation_type?: 'stock_reorder_rule' | 'history_profile' | 'recent_history';
  auto_apply_eligible?: boolean;
  resolution?: QuickOrderResolutionMetadata;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type ReorderRoundingPolicy =
  | 'none'
  | 'ceil'
  | 'floor'
  | 'half_up'
  | 'floor_conservative'
  | 'ceil_prevent_stockout'
  | 'nearest'
  | 'floor_normal_ceil_if_low'
  | 'custom_threshold';

export type ItemReorderRule = {
  id?: string;
  item_id: string;
  location_id: string | null;
  supplier_id?: string | null;
  is_active?: boolean | null;
  target_stock_quantity?: number | null;
  target_stock_unit?: string | null;
  reorder_point?: number | null;
  reorder_to_quantity?: number | null;
  min_stock_quantity?: number | null;
  max_stock_quantity?: number | null;
  usual_order_quantity?: number | null;
  usual_order_unit?: string | null;
  preferred_unit?: string | null;
  min_order_quantity?: number | null;
  max_order_quantity?: number | null;
  order_multiple?: number | null;
  order_increment?: number | null;
  allow_fractional_stock_count?: boolean | null;
  allow_fractional_order?: boolean | null;
  rounding_policy?: ReorderRoundingPolicy | null;
  safety_stock_quantity?: number | null;
  lookback_days?: number | null;
  target_days_on_hand?: number | null;
  priority?: number | null;
  criticality?: string | null;
  shelf_life_days?: number | null;
  lead_time_days?: number | null;
  notes?: string | null;
};

export type InventoryReorderRuleTriggerType =
  | 'below'
  | 'at_or_below'
  | 'equal'
  | 'between'
  | 'at_or_above'
  | 'always';

export type InventoryReorderRuleOrderStrategy =
  | 'fixed_order_qty'
  | 'no_order'
  | 'use_existing_recommendation_engine';

export type InventoryReorderRuleAppliesToMode = 'inventory_only' | 'order_only' | 'both';

export type InventoryReorderRule = {
  id?: string;
  active?: boolean | null;
  location_id: string | null;
  location_key?: string | null;
  inventory_item_id: string;
  applies_to_mode: InventoryReorderRuleAppliesToMode;
  trigger_type: InventoryReorderRuleTriggerType;
  trigger_qty?: number | null;
  trigger_qty_max?: number | null;
  trigger_unit?: string | null;
  order_strategy: InventoryReorderRuleOrderStrategy;
  order_qty?: number | null;
  order_unit?: string | null;
  priority?: number | null;
  notes?: string | null;
  source?: string | null;
};

export type ItemOrderProfile = {
  id?: string;
  item_id: string;
  location_id: string | null;
  supplier_id?: string | null;
  is_active?: boolean | null;
  default_order_quantity?: number | null;
  median_order_quantity?: number | null;
  average_order_quantity?: number | null;
  average_daily_usage?: number | null;
  usual_quantity?: number | null;
  usual_unit?: string | null;
  p50_quantity?: number | null;
  p75_quantity?: number | null;
  p95_quantity?: number | null;
  last_order_quantity?: number | null;
  last_order_unit?: string | null;
  last_ordered_at?: string | null;
  weekday_pattern_json?: Record<string, unknown> | null;
  monthly_pattern_json?: Record<string, unknown> | null;
  day_of_week_quantities?: Record<string, number> | null;
  preferred_unit?: string | null;
  confidence?: number | null;
  sample_size?: number | null;
  weekday?: number | null;
  ordered_count_recent?: number | null;
  total_similar_orders?: number | null;
  confidence_score?: number | null;
  source?: 'manual' | 'history' | 'computed' | 'submitted_orders' | 'manager_import' | null;
};

export type QuickOrderCartMutationType =
  | 'recommendation_add'
  | 'recommendation_update'
  | 'manual_add'
  | 'manual_update'
  | 'remove'
  | 'clear'
  | 'accept_suggestion'
  | 'reject_suggestion';

export type QuickOrderCartMutation = {
  id?: string;
  session_id: string | null;
  user_id: string;
  location_id: string | null;
  mutation_type: QuickOrderCartMutationType;
  item_id: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  previous_quantity?: number | null;
  previous_unit?: string | null;
  recommendation?: Record<string, unknown> | null;
  source?: QuickOrderSource | 'system' | 'manager';
  status?: 'pending' | 'applied' | 'rejected' | 'undone';
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

export type QuickOrderSmartOrderingContext = {
  location_id: string;
  supplier_id?: string | null;
  current_stock_by_item?: Record<string, number | null>;
  reorder_rules: ItemReorderRule[];
  order_profiles: ItemOrderProfile[];
  cart_mutations?: QuickOrderCartMutation[];
};

export type SmartAssistantMessageAction = {
  type: 'revert';
  label: string;
  mutationId: string;
};

export type SmartAssistantMessage = {
  type: 'smart_suggestion' | 'tutorial' | 'history_answer' | 'clarification' | 'error' | 'success';
  text: string;
  actions?: SmartAssistantMessageAction[];
  explanation?: {
    reason: string;
    confidence: 'high' | 'medium' | 'low';
    dataSources: string[];
  };
};

export type QuickOrderContextPatch = {
  lastReferencedItemId?: string | null;
  lastReferencedItemName?: string | null;
  lastAction?: string | null;
  lastMutationId?: string | null;
  lastSuggestedQuantity?: number | null;
  pendingClarificationId?: string | null;
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
    | 'unit_unrecognized'
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
    | 'unit_unrecognized'
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
  llm_intent_time_range?: string;
};

export type ParseResponse = {
  status?: ParseStatus;
  item?: string;
  quantity?: number | null;
  unit_typed?: string;
  message?: string;
  suggested_units?: string[];
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
  mode?: ComposerMode;
  mode_conflict_resolution?: 'keep_inventory';
  message: string;
  session_id: string | null;
  location_id: string;
  user_id: string;
  existing_items: ParsedItem[];
  recent_messages?: RecentMessage[];
  voice_metadata?: VoiceMetadata;
  operation?: 'parse' | 'record_mutation' | 'revert_mutation';
  mutation_id?: string | null;
  before_cart?: unknown;
  after_cart?: unknown;
  mutation_type?: string | null;
  assistant_message_text?: string | null;
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
  assistantMessage?: SmartAssistantMessage;
  contextPatch?: QuickOrderContextPatch;
  cartUpdates?: unknown[];
};
