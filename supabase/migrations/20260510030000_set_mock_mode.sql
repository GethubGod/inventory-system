-- Set Quick Order to mock mode for development/testing.
-- Change to 'live' or 'auto' when ready for production AI calls.
UPDATE app_config SET value = '"mock"'::jsonb WHERE key = 'quick_order_parser_mode';
