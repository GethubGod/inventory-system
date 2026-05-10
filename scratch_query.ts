import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function run() {
  const { data, error } = await supabase
    .from('parser_usage_log')
    .select('created_at, error_code, duration_ms, ai_provider')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching logs:', error);
  } else {
    console.log('Recent logs:', JSON.stringify(data, null, 2));
  }
}

run();
