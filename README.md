# Banana Image Gen

A Cloudflare Worker API & Simple UI for batch image generation using Google's Gemini models via OpenRouter.

<img width="965" height="1470" alt="image" src="https://github.com/user-attachments/assets/73f22a9b-6554-4f7c-884f-12577280dfb7" />


## Features

- **Batch Generation**: Generate multiple images from a prompt template with variable substitution
- **Async Processing**: Jobs run in the background with status polling and SSE support
- **R2 Storage**: Generated images stored in Cloudflare R2
- **Bulk Download**: Download multiple images as a ZIP archive
- **OpenAPI Docs**: Auto-generated API documentation at `/api/docs`
- **Cloudflare Access**: Protected by Zero Trust authentication

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/generate` | Start a batch generation job |
| GET | `/api/generate/:jobId/status` | Get job status |
| GET | `/api/generate/:jobId/poll` | SSE stream for real-time updates |
| GET | `/api/images/:imageId` | Retrieve a generated image |
| POST | `/api/images/download` | Download multiple images as ZIP |

## Models

- `nano-banana` - Gemini 2.5 Flash Image
- `nano-banana-pro` - Gemini 3 Pro Image Preview

## Setup

1. Install dependencies: `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and add your `OPENROUTER_API_KEY`
3. Run locally: `npm run dev`
4. Deploy: `npm run deploy`

## Configuration

Set these in `wrangler.jsonc` or via Cloudflare dashboard:

- `OPENROUTER_API_KEY` - Your OpenRouter API key (secret)
- `CF_ACCESS_TEAM_NAME` - Your Cloudflare Access team name
- `CF_ACCESS_AUD` - Your Cloudflare Access application AUD tag
- `MAX_BATCH_SIZE` - Maximum parallel requests (default: 20)
- `DEFAULT_BATCH_SIZE` - Default parallel requests (default: 10)

## Example Request

```json
POST /api/generate
{
  "promptTemplate": "A <STYLE> painting of a <SUBJECT>",
  "variables": {
    "STYLE": ["watercolor", "oil"],
    "SUBJECT": ["cat", "dog"]
  },
  "model": "nano-banana",
  "aspectRatio": "1:1"
}
```

This generates 4 images (2 styles × 2 subjects).
