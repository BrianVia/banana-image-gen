import { MODELS, type ModelKey, type OpenRouterImageResponse } from "../types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface GenerateImageOptions {
	prompt: string;
	model: ModelKey;
	aspectRatio?: string;
	apiKey: string;
	referenceImage?: string;
}

export interface GenerateImageResult {
	success: true;
	imageBuffer: ArrayBuffer;
	mimeType: string;
}

export interface GenerateImageError {
	success: false;
	error: string;
	retryable: boolean;
}

export type GenerateImageResponse = GenerateImageResult | GenerateImageError;

/**
 * Build message content for OpenRouter API
 * Supports optional reference image (URL or base64 data URI) for style/content guidance
 */
function buildMessageContent(
	prompt: string,
	referenceImage?: string
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
	if (!referenceImage) {
		return prompt;
	}

	// When reference image is provided, use multimodal content array
	// Works with both URLs and base64 data URIs
	return [
		{ type: "image_url", image_url: { url: referenceImage } },
		{ type: "text", text: prompt },
	];
}

/**
 * Generate an image using OpenRouter's nano-banana models
 */
export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResponse> {
	const { prompt, model, aspectRatio = "1:1", apiKey, referenceImage } = options;

	try {
		const messageContent = buildMessageContent(prompt, referenceImage);

		const response = await fetch(OPENROUTER_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"X-Title": "Banana Image Generator",
			},
			body: JSON.stringify({
				model: MODELS[model],
				messages: [{ role: "user", content: messageContent }],
				modalities: ["image", "text"],
				image_config: { aspect_ratio: aspectRatio },
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			const retryable = response.status === 429 || response.status >= 500;
			return {
				success: false,
				error: `OpenRouter API error: ${response.status} - ${errorText}`,
				retryable,
			};
		}

		const data = (await response.json()) as OpenRouterImageResponse;
		const message = data.choices?.[0]?.message;

		if (!message) {
			return {
				success: false,
				error: "No message in OpenRouter response",
				retryable: false,
			};
		}

		// Try to extract image from the response
		const imageUrl = extractImageUrl(message);

		if (!imageUrl) {
			return {
				success: false,
				error: "No image returned from API",
				retryable: false,
			};
		}

		// Convert base64 data URI to ArrayBuffer
		const imageBuffer = base64ToArrayBuffer(imageUrl);
		const mimeType = extractMimeType(imageUrl);

		return {
			success: true,
			imageBuffer,
			mimeType,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
			retryable: true,
		};
	}
}

/**
 * Generate image with exponential backoff retry
 */
export async function generateImageWithRetry(
	options: GenerateImageOptions,
	maxRetries = 3,
	baseDelayMs = 1000
): Promise<GenerateImageResponse> {
	let lastResult: GenerateImageResponse | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const result = await generateImage(options);

		if (result.success) {
			return result;
		}

		lastResult = result;

		// Don't retry if not retryable
		if (!result.retryable) {
			return result;
		}

		// Don't delay on last attempt
		if (attempt < maxRetries - 1) {
			const delay = baseDelayMs * Math.pow(2, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	return (
		lastResult || {
			success: false,
			error: "Max retries exceeded",
			retryable: false,
		}
	);
}

/**
 * Extract image URL from OpenRouter message response
 */
function extractImageUrl(
	message: OpenRouterImageResponse["choices"][0]["message"]
): string | null {
	// Try images array first (OpenRouter's format for Gemini image models)
	if (message.images && Array.isArray(message.images)) {
		for (const img of message.images) {
			if (img.type === "image_url" && img.image_url?.url) {
				return img.image_url.url;
			}
		}
	}

	// Fallback: check content array
	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "image_url" && part.image_url?.url) {
				return part.image_url.url;
			}
		}
	}

	return null;
}

/**
 * Convert base64 data URI to ArrayBuffer
 */
function base64ToArrayBuffer(dataUri: string): ArrayBuffer {
	// Extract base64 data after "data:image/xxx;base64,"
	const base64Match = dataUri.match(/^data:image\/\w+;base64,(.+)$/);
	if (!base64Match) {
		throw new Error("Invalid base64 data URI");
	}

	const base64Data = base64Match[1];
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);

	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return bytes.buffer;
}

/**
 * Extract MIME type from data URI
 */
function extractMimeType(dataUri: string): string {
	const mimeMatch = dataUri.match(/^data:(image\/\w+);base64,/);
	return mimeMatch ? mimeMatch[1] : "image/png";
}
