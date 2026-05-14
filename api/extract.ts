import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEY = process.env.OPENROUTER_API_KEY as string;
const MODEL_ID = process.env.OPENROUTER_MODEL_ID || 'anthropic/claude-haiku-4-5';

// ── System prompts (server-side only — never sent to or supplied by the client) ──

const SYSTEM_PROMPTS: Record<string, string> = {
  v1: `You are a precise menu data extraction assistant. 
Extract all menu items from the provided image and return ONLY a valid JSON array.
The JSON must follow this exact structure:
[
  {
    "title": "Category Name",
    "entries": [
      { "title": "Item Name", "price": 12.99, "description": "Item description or null" }
    ]
  }
]

Rules:
- Return ONLY the JSON array, no markdown, no explanation
- Use null for missing price or description fields
- Group items by their menu category/section
- Strip all currency symbols from prices and return only the numeric value (e.g. 12.99, 8.5, 5)
- If no categories are visible, use a single category like "MENU ITEMS"
- "title" (category name) must be UPPER CASE — e.g. "ICED DRINKS", "MAIN COURSE"
- "title" (item name) must be Capitalized Case — every word starts with a capital letter, e.g. "Iced Americano", "Grilled Chicken Burger"
- "description" must be Sentence case — only the first word and proper nouns are capitalized, e.g. "Served with a side of fries and coleslaw"`,

  v2: `You are a precise menu data extraction assistant.
Extract all menu items from the provided image and return ONLY a valid JSON array.
The JSON must follow this exact structure:
[
  {
    "uuid": null,
    "key": null,
    "name": "Category Name",
    "position": 0,
    "menuItems": [
      {
        "uuid": null,
        "key": null,
        "position": 0,
        "title": "Item Name",
        "description": null,
        "price": 12.99
      }
    ]
  }
]

Rules:
- Return ONLY the JSON array, no markdown, no explanation
- Always set "uuid" and "key" to null for every category and every menu item
- "position" is a zero-based integer index: categories are numbered 0, 1, 2… and menuItems within each category are numbered 0, 1, 2…
- "price" must be a JSON number (float or integer), never a string — strip all currency symbols and parse the numeric value (e.g. 3.90, 4.20, 5)
- Use null (not a string) for missing description or missing price
- "name" is the category/section name; "title" is the individual item name
- Group items by their menu category/section
- If no categories are visible, use a single category with name "MENU ITEMS" at position 0
- "name" (category name) must be UPPER CASE — e.g. "ICED DRINKS", "MAIN COURSE"
- "title" (item name) must be Capitalized Case — every word starts with a capital letter, e.g. "Iced Americano", "Grilled Chicken Burger"
- "description" must be Sentence case — only the first word and proper nouns are capitalized, e.g. "Served with a side of fries and coleslaw"`,
};

/** Accepted format values — validated server-side; client cannot inject arbitrary prompts. */
const VALID_FORMATS = new Set(['v1', 'v2']);

/**
 * Map an upstream HTTP status to a safe, user-facing message.
 * The raw upstream body is logged server-side and never forwarded to the client.
 */
function safeUpstreamError(status: number): string {
  if (status === 401) return 'Authentication failed. Check your API key configuration.';
  if (status === 403) return 'Access denied by the AI service.';
  if (status === 429) return 'Rate limit reached. Please wait a moment and try again.';
  if (status === 413) return 'Image is too large for the AI model to process.';
  if (status >= 500 && status <= 599) return 'The AI service is temporarily unavailable. Please try again.';
  return 'An unexpected error occurred while contacting the AI service.';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Method guard ─────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API key presence ──────────────────────────────────────────────────────────
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: API key is not set.' });
  }

  // ── Input validation ──────────────────────────────────────────────────────────
  const { base64Image, mimeType, format } = req.body as {
    base64Image?: unknown;
    mimeType?: unknown;
    format?: unknown;
  };

  if (!base64Image || typeof base64Image !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid field: base64Image' });
  }
  if (!mimeType || typeof mimeType !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid field: mimeType' });
  }
  // format must be exactly 'v1' or 'v2' — client cannot supply an arbitrary prompt
  if (!format || typeof format !== 'string' || !VALID_FORMATS.has(format)) {
    return res.status(400).json({ error: 'Invalid field: format must be "v1" or "v2"' });
  }

  // ── Size guard (base64 of 20 MB ≈ 26.7 MB) ───────────────────────────────────
  if (base64Image.length > 28 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image too large. Maximum source size is 20 MB.' });
  }

  // ── Look up system prompt server-side (never from the client) ─────────────────
  const systemPrompt = SYSTEM_PROMPTS[format];

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.headers.origin ?? 'https://menu-extractor.vercel.app',
        'X-Title': 'AI Menu Extractor',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
              {
                type: 'text',
                text: 'Extract all menu items from this image and return the structured JSON.',
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 30720,
      }),
    });

    if (!upstream.ok) {
      // Log the full body server-side for debugging; send only a safe message to the client.
      const rawBody = await upstream.text().catch(() => '(unreadable)');
      console.error(`[extract] Upstream error ${upstream.status}:`, rawBody);
      return res.status(upstream.status).json({ error: safeUpstreamError(upstream.status) });
    }

    const data = await upstream.json() as {
      choices: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (data.error) {
      // Model-level error — log internally, return generic message
      console.error('[extract] Model error:', data.error.message);
      return res.status(502).json({ error: 'The AI model returned an error. Please try again.' });
    }

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      return res.status(502).json({ error: 'Empty response from AI model.' });
    }

    const cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    return res.status(200).json({ result: cleaned });
  } catch (err) {
    // Log the real error server-side; never forward internal details to the client.
    console.error('[extract] Unexpected error:', err);
    return res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
  }
}
