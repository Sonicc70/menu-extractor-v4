import type { MenuData, MenuDataV2 } from '../types';
import {
  MENU_EXTRACTION_SYSTEM_PROMPT,
  MENU_EXTRACTION_SYSTEM_PROMPT_V2,
} from './systemPrompt';

const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string;
const MODEL_ID =
  (import.meta.env.VITE_OPENROUTER_MODEL_ID as string) || 'anthropic/claude-haiku-4-5';

// ─── Delay between sequential V1 → V2 calls (ms) ────────────────────────────
const INTER_CALL_DELAY_MS = 1000;

// ─── Retry config ────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000; // doubles each attempt: 2s, 4s, 8s

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export interface ExtractOptions {
  enableJson: boolean;
  enableJsonV2: boolean;
}

export interface ExtractResult {
  menu: MenuData | null;
  menuV2: MenuDataV2 | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ─── Core fetch with retry + exponential backoff ──────────────────────────────
async function callOpenRouter(
  base64Image: string,
  mimeType: string,
  systemPrompt: string
): Promise<string> {
  if (!API_KEY) {
    throw new OpenRouterError(
      'Missing VITE_OPENROUTER_API_KEY environment variable. Please add it to your .env file.'
    );
  }

  let lastError: OpenRouterError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
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
    } catch (networkErr) {
      lastError = new OpenRouterError(
        `Network error: ${networkErr instanceof Error ? networkErr.message : 'Failed to fetch'}`
      );
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      if (isRetryableStatus(response.status)) {
        lastError = new OpenRouterError(
          `OpenRouter API error (${response.status}): ${errorBody}`,
          response.status
        );
        continue;
      }
      throw new OpenRouterError(
        `OpenRouter API error (${response.status}): ${errorBody}`,
        response.status
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new OpenRouterError(data.error.message);
    }

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new OpenRouterError('Empty response from AI model.');
    }

    return rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
  }

  throw lastError ?? new OpenRouterError('Request failed after maximum retries.');
}

// ─── V1 extraction ────────────────────────────────────────────────────────────
async function extractV1(base64Image: string, mimeType: string): Promise<MenuData> {
  const cleaned = await callOpenRouter(base64Image, mimeType, MENU_EXTRACTION_SYSTEM_PROMPT);
  try {
    const parsed = JSON.parse(cleaned) as MenuData;
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
    return parsed;
  } catch {
    throw new OpenRouterError(`Failed to parse JSON (V1). Raw: ${cleaned.slice(0, 200)}`);
  }
}

// ─── V2 extraction ────────────────────────────────────────────────────────────
async function extractV2(base64Image: string, mimeType: string): Promise<MenuDataV2> {
  const cleaned = await callOpenRouter(base64Image, mimeType, MENU_EXTRACTION_SYSTEM_PROMPT_V2);
  try {
    const parsed = JSON.parse(cleaned) as MenuDataV2;
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
    return parsed;
  } catch {
    throw new OpenRouterError(`Failed to parse JSON (V2). Raw: ${cleaned.slice(0, 200)}`);
  }
}

// ─── Public: extract only the enabled formats, sequentially ──────────────────
export async function extractMenuBoth(
  base64Image: string,
  mimeType: string,
  options: ExtractOptions
): Promise<ExtractResult> {
  const { enableJson, enableJsonV2 } = options;

  let menu: MenuData | null = null;
  let menuV2: MenuDataV2 | null = null;

  if (enableJson) {
    menu = await extractV1(base64Image, mimeType);
  }

  // Only pause if both calls are being made
  if (enableJson && enableJsonV2) {
    await sleep(INTER_CALL_DELAY_MS);
  }

  if (enableJsonV2) {
    menuV2 = await extractV2(base64Image, mimeType);
  }

  return { menu, menuV2 };
}
