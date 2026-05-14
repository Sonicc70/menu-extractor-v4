import type { MenuData, MenuDataV2 } from '../types';

// ─── Delay between sequential V1 → V2 calls (ms) ────────────────────────────
const INTER_CALL_DELAY_MS = 1000;

// ─── Retry config ────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000; // doubles each attempt: 2s → 4s → 8s

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

// ─── Core fetch — calls the server proxy; API key never leaves the server ────
// Sends `format` ('v1' | 'v2') instead of the raw system prompt so the client
// cannot inject arbitrary prompts or abuse the proxied API key.
async function callProxy(
  base64Image: string,
  mimeType: string,
  format: 'v1' | 'v2'
): Promise<string> {
  let lastError: OpenRouterError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    let response: Response;
    try {
      response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Image, mimeType, format }),
      });
    } catch (networkErr) {
      lastError = new OpenRouterError(
        `Network error: ${networkErr instanceof Error ? networkErr.message : 'Failed to fetch'}`
      );
      continue;
    }

    if (!response.ok) {
      const errorBody = await response
        .json()
        .then((j: { error?: string }) => j.error ?? 'Unknown error')
        .catch(() => 'Unknown error');

      if (isRetryableStatus(response.status)) {
        lastError = new OpenRouterError(
          `API error (${response.status}): ${errorBody}`,
          response.status
        );
        continue;
      }

      throw new OpenRouterError(
        `API error (${response.status}): ${errorBody}`,
        response.status
      );
    }

    const data = await response.json() as { result?: string; error?: string };

    if (data.error) {
      throw new OpenRouterError(data.error);
    }

    if (!data.result) {
      throw new OpenRouterError('Empty response from proxy.');
    }

    return data.result;
  }

  throw lastError ?? new OpenRouterError('Request failed after maximum retries.');
}

// ─── V1 extraction ────────────────────────────────────────────────────────────
async function extractV1(base64Image: string, mimeType: string): Promise<MenuData> {
  const cleaned = await callProxy(base64Image, mimeType, 'v1');
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
  const cleaned = await callProxy(base64Image, mimeType, 'v2');
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
