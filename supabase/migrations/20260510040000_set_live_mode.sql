-- Switch Quick Order to live AI mode.
UPDATE app_config SET value = '"live"'::jsonb WHERE key = 'quick_order_parser_mode';
