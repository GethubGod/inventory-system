// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const {
      transcript,
      conversationHistory = [],
      employeeId,
      locationShortCode,
    } = await req.json();

    if (!transcript) {
      return jsonResponse({ error: 'Missing required field: transcript' }, 400);
    }
    if (!locationShortCode) {
      return jsonResponse({ error: 'Missing required field: locationShortCode' }, 400);
    }
    if (!employeeId) {
      return jsonResponse({ error: 'Employee not authenticated' }, 401);
    }
    if (!GOOGLE_API_KEY) {
      return jsonResponse({ error: 'GOOGLE_API_KEY not configured' }, 500);
    }

    // ── Step 1: Fetch inventory for this location ──

    const { data: areaItems, error: dbError } = await supabaseAdmin
      .from('area_items')
      .select(`
        id,
        inventory_item_id,
        unit_type,
        order_unit,
        inventory_items!inner(id, name, emoji, category),
        storage_areas!inner(id, name, locations!inner(short_code))
      `)
      .eq('storage_areas.locations.short_code', locationShortCode)
      .eq('active', true);

    if (dbError) {
      console.error('Database query failed:', dbError);
      return jsonResponse({ error: `Database error: ${dbError.message}` }, 500);
    }

    const inventoryList = (areaItems || []).map((item) => ({
      area_item_id: item.id,
      inventory_item_id: item.inventory_item_id,
      name: item.inventory_items.name,
      emoji: item.inventory_items.emoji || '',
      category: item.inventory_items.category,
      order_unit: item.order_unit || item.unit_type,
      count_unit: item.unit_type,
    }));

    const inventoryForPrompt = inventoryList
      .map(
        (i) =>
          `- ${i.name} (${i.emoji}) [order in: ${i.order_unit}, count in: ${i.count_unit}]`,
      )
      .join('\n');

    // ── Step 2: Fetch this employee's recent orders (last 30 days) ──

    let employeeOrderHistory = 'No recent orders found.';

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get location ID from short code
      const { data: locationData } = await supabaseAdmin
        .from('locations')
        .select('id')
        .eq('short_code', locationShortCode)
        .single();

      if (locationData) {
        const { data: recentOrders } = await supabaseAdmin
          .from('orders')
          .select(`
            id,
            created_at,
            order_items(
              quantity,
              unit_type,
              inventory_item_id,
              inventory_items(name)
            )
          `)
          .eq('user_id', employeeId)
          .eq('location_id', locationData.id)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .in('status', ['submitted', 'processing', 'fulfilled'])
          .order('created_at', { ascending: false })
          .limit(10);

        if (recentOrders && recentOrders.length > 0) {
          employeeOrderHistory = recentOrders
            .map((order) => {
              const date = new Date(order.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              const items = (order.order_items || [])
                .map((oi) => {
                  const name = oi.inventory_items?.name || 'Unknown';
                  return `${name} ${oi.quantity} ${oi.unit_type === 'pack' ? 'cases' : 'units'}`;
                })
                .join(', ');
              return `${date}: ${items}`;
            })
            .join('\n  ');
        }
      }
    } catch (err) {
      console.error('Failed to fetch employee order history:', err);
      // Non-fatal — continue without history
    }

    // ── Step 3: Send to Gemini 2.0 Flash (conversational) ──

    const locationName = locationShortCode === 'sushi'
      ? 'Babytuna Sushi'
      : 'Babytuna Poki & Pho';

    const systemPrompt = `You are Tuna Specialist, the AI ordering assistant for Babytuna restaurant. You help employees place inventory orders by voice.

PERSONALITY:
- Friendly, efficient, casual. Like a helpful coworker.
- Keep responses SHORT — 1-2 sentences max for confirmations.
- Use the item emoji when confirming items.
- Say "Got it" or similar when adding items, not long explanations.

LOCATION: ${locationName}

AVAILABLE INVENTORY (only these items can be ordered):
${inventoryForPrompt}

THIS EMPLOYEE'S RECENT ORDERS (last 30 days):
  ${employeeOrderHistory}

RULES:
1. When the employee names items with quantities, confirm them and include them in the structured JSON.
2. The employee may speak in Chinese (Mandarin or Cantonese), English, or mixed. Common mappings:
   三文鱼/鲑鱼=Salmon, 金枪鱼/吞拿鱼=Tuna, 虾=Shrimp, 鳗鱼=Eel/Unagi, 章鱼=Octopus/Tako, 米/米饭=Rice, 豆腐=Tofu, 海苔/紫菜=Nori/Seaweed, 酱油=Soy Sauce, 醋=Rice Vinegar, 芥末=Wasabi, 姜=Ginger, 牛油果/鳄梨=Avocado, 黄瓜=Cucumber
   Units: 箱=case, 磅=pound/lb, 包=bag, 瓶=bottle, 个=each/piece
3. Handle messy speech: pauses, filler words (um, uh, 那个, 呃), restarts, reversed word order, abbreviations.
4. If the employee asks about their past orders (e.g. "how much shrimp did I order last week"), reference ONLY their order history above. Never reference other employees' orders.
5. If an item is ambiguous (e.g. "tofu" could be Firm Tofu or Silken Tofu), ask which one.
6. If no quantity is stated, default to 1 of that item's order unit.
7. If the employee asks to change a quantity of something already mentioned, update it.
8. If the employee says "same as last time" or "the usual", look at their most recent order and suggest those items.
9. ONLY suggest or add items that exist in the AVAILABLE INVENTORY list above.

RESPONSE FORMAT:
Always respond with a JSON object (and nothing else) containing exactly two fields:
{
  "message": "Your conversational response text here",
  "items": [
    {
      "area_item_id": "uuid-string",
      "inventory_item_id": "uuid-string",
      "item_name": "Salmon",
      "emoji": "🐟",
      "spoken_text": "三文鱼",
      "quantity": 2,
      "unit": "case",
      "confidence": 0.95
    }
  ]
}

The "items" array should contain ONLY items confirmed in THIS specific response turn. If you're just answering a question or asking for clarification, items should be an empty array [].
The "message" field is what gets displayed to the employee.`;

    // Build contents with conversation history + new user message
    const contents = [
      ...conversationHistory,
      { role: 'user', parts: [{ text: transcript }] },
    ];

    const geminiController = new AbortController();
    const geminiTimer = setTimeout(() => geminiController.abort(), 30000);

    let geminiResponse;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: geminiController.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.3,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
    } finally {
      clearTimeout(geminiTimer);
    }

    if (!geminiResponse.ok) {
      const geminiError = await geminiResponse.text();
      console.error('Gemini API error:', geminiError);
      return jsonResponse({
        success: false,
        aiMessage: "I'm having trouble thinking right now. Try again in a moment.",
        parsedItems: [],
      });
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let aiMessage = "I couldn't understand that. Could you try again?";
    let parsedItems = [];

    try {
      const parsed = JSON.parse(rawText);
      aiMessage = parsed.message || aiMessage;
      parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      // Try to extract JSON from the response with regex
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          aiMessage = parsed.message || aiMessage;
          parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
        } catch {
          console.error('Failed to parse Gemini response:', rawText);
          aiMessage = rawText || aiMessage;
        }
      } else {
        aiMessage = rawText || aiMessage;
      }
    }

    return jsonResponse({
      success: true,
      aiMessage,
      parsedItems,
      geminiTurn: {
        role: 'model',
        parts: [{ text: rawText }],
      },
    });
  } catch (err) {
    console.error('voice-order error:', err);
    return jsonResponse({
      success: false,
      aiMessage: "I'm having trouble thinking right now. Try again in a moment.",
      parsedItems: [],
    }, 500);
  }
});
