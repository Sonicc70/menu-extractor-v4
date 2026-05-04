# AI Menu Extractor

Upload a photo or PDF scan of any restaurant menu and instantly extract all items into structured JSON using AI vision.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your [OpenRouter](https://openrouter.ai) API key:
   ```
   VITE_OPENROUTER_API_KEY=your_api_key_here
   VITE_OPENROUTER_MODEL_ID=anthropic/claude-haiku-4-5
   ```

3. **Run the dev server**
   ```bash
   npm run dev
   ```

## Supported Models (OpenRouter)

Any vision-capable model works. Recommended:
- `anthropic/claude-haiku-4-5` — fast & accurate (default)
- `google/gemini-flash-1.5` — very fast, good quality
- `openai/gpt-4o` — highest accuracy

## Output Format

```json
[
  {
    "title": "Category Name",
    "entries": [
      { "title": "Item Name", "price": "$12.99", "description": "Item description" }
    ]
  }
]
```

## Tech Stack

- Vite + React 19 + TypeScript
- pdfjs-dist for PDF → image conversion
- OpenRouter API for AI vision
