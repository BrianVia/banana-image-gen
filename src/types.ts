import { Str, Num } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

// Environment bindings
export interface Env {
	R2_BUCKET: R2Bucket;
	KV: KVNamespace;
	OPENROUTER_API_KEY: string;
	MAX_BATCH_SIZE: string;
	DEFAULT_BATCH_SIZE: string;
	ASSETS: Fetcher;
	CF_ACCESS_TEAM_NAME: string;
	CF_ACCESS_AUD: string;
}

export type AppContext = Context<{ Bindings: Env }>;

// OpenRouter model IDs
export const MODELS = {
	"nano-banana": "google/gemini-2.5-flash-image",
	"nano-banana-pro": "google/gemini-3-pro-image-preview",
} as const;

export type ModelKey = keyof typeof MODELS;

// Custom validator for reference image (URL or base64 data URI)
const referenceImageSchema = z
	.string()
	.refine(
		(val) => {
			// Accept valid URLs
			try {
				new URL(val);
				return true;
			} catch {
				// Accept base64 data URIs for images
				return /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(val);
			}
		},
		{ message: "Must be a valid URL or base64 data URI (data:image/...;base64,...)" }
	)
	.optional()
	.describe("Optional reference image as URL or base64 data URI for style/content guidance");

// Generation request schema
export const GenerateRequestSchema = z.object({
	promptTemplate: Str({ description: "Prompt template with <VARIABLE> placeholders" }),
	variables: z.record(z.string(), z.array(z.string())).describe(
		"Map of variable names to arrays of values"
	),
	model: z.enum(["nano-banana", "nano-banana-pro"]).default("nano-banana"),
	batchSize: Num({ description: "Number of parallel requests", required: false }).default(10),
	aspectRatio: z
		.enum(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"])
		.default("1:1")
		.describe("Image aspect ratio"),
	referenceImage: referenceImageSchema,
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

// Generation response schema
export const GenerateResponseSchema = z.object({
	success: z.boolean(),
	jobId: Str({ description: "Unique job identifier" }),
	totalPrompts: Num({ description: "Total number of images to generate" }),
	estimatedTimeSeconds: Num({ description: "Estimated time to complete", required: false }),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

// Completed image schema
export const CompletedImageSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	variableValues: z.record(z.string(), z.string()),
	timestamp: z.number(),
	r2Key: z.string(),
});

export type CompletedImage = z.infer<typeof CompletedImageSchema>;

// Job state schema (stored in KV)
export const JobStateSchema = z.object({
	jobId: z.string(),
	status: z.enum(["pending", "processing", "complete", "failed"]),
	totalPrompts: z.number(),
	completedImages: z.array(CompletedImageSchema),
	failedCount: z.number(),
	errors: z.array(
		z.object({
			prompt: z.string(),
			error: z.string(),
			index: z.number(),
		})
	),
	startTime: z.number(),
	model: z.string(),
	aspectRatio: z.string(),
	promptTemplate: z.string(),
});

export type JobState = z.infer<typeof JobStateSchema>;

// SSE event types
export interface ProgressEvent {
	completed: number;
	total: number;
	images: Array<{
		id: string;
		prompt: string;
		url: string;
		variableValues: Record<string, string>;
		timestamp: number;
	}>;
}

export interface ErrorEvent {
	prompt: string;
	error: string;
	index: number;
	retryable: boolean;
}

export interface CompleteEvent {
	totalGenerated: number;
	totalFailed: number;
	durationSeconds: number;
}

// Template schema (for stretch goal)
export const TemplateSchema = z.object({
	id: z.string(),
	name: Str({ description: "Template name" }),
	promptTemplate: Str({ description: "Prompt template with <VARIABLE> placeholders" }),
	variables: z.record(z.string(), z.array(z.string())),
	model: z.enum(["nano-banana", "nano-banana-pro"]).default("nano-banana"),
	aspectRatio: z.enum(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"]).default("1:1"),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export type Template = z.infer<typeof TemplateSchema>;

// Download request schema
export const DownloadRequestSchema = z.object({
	imageIds: z.array(z.string()).min(1),
	filename: Str({ description: "ZIP filename", required: false }),
});

export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;

// OpenRouter API types
export interface OpenRouterMessage {
	role: "user" | "assistant";
	content: string;
}

export interface OpenRouterImageResponse {
	id: string;
	model: string;
	choices: Array<{
		message: {
			role: "assistant";
			content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
			images?: Array<{
				type: "image_url";
				image_url: { url: string };
			}>;
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
