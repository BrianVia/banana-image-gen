/**
 * Batch Processor Utility
 * Handles parallel batch processing of image generation requests
 */

import { generateImageWithRetry, type GenerateImageOptions } from "../services/openrouter";
import { storeImage } from "../services/r2Storage";
import { updateJobProgress } from "../services/jobManager";
import type { CompletedImage, Env, ModelKey } from "../types";
import type { ExpandedPrompt } from "./templateParser";

// Max concurrent API requests to avoid rate limiting
const MAX_CONCURRENCY = 2;

export interface BatchProcessorOptions {
	env: Env;
	jobId: string;
	prompts: ExpandedPrompt[];
	model: ModelKey;
	aspectRatio: string;
	batchSize: number;
}

export interface BatchResult {
	index: number;
	prompt: string;
	variableValues: Record<string, string>;
	success: boolean;
	imageId?: string;
	r2Key?: string;
	error?: string;
}

/**
 * Split array into chunks of specified size
 */
function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

/**
 * Run promises with limited concurrency
 */
async function runWithConcurrency<T, R>(
	items: T[],
	fn: (item: T) => Promise<R>,
	concurrency: number
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			try {
				const value = await fn(items[index]);
				results[index] = { status: "fulfilled", value };
			} catch (error) {
				results[index] = { status: "rejected", reason: error };
			}
		}
	}

	// Start workers up to concurrency limit
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);

	return results;
}

/**
 * Process a single prompt and return result
 */
async function processPrompt(
	env: Env,
	jobId: string,
	prompt: ExpandedPrompt,
	model: ModelKey,
	aspectRatio: string
): Promise<BatchResult> {
	const options: GenerateImageOptions = {
		prompt: prompt.prompt,
		model,
		aspectRatio,
		apiKey: env.OPENROUTER_API_KEY,
	};

	const result = await generateImageWithRetry(options);

	if (!result.success) {
		return {
			index: prompt.index,
			prompt: prompt.prompt,
			variableValues: prompt.variableValues,
			success: false,
			error: result.error,
		};
	}

	// Generate unique image ID
	const imageId = `${jobId}-${String(prompt.index).padStart(4, "0")}-${Date.now()}`;

	// Store in R2
	const r2Key = await storeImage({
		bucket: env.R2_BUCKET,
		jobId,
		imageId,
		imageBuffer: result.imageBuffer,
		mimeType: result.mimeType,
		prompt: prompt.prompt,
		variableValues: prompt.variableValues,
	});

	return {
		index: prompt.index,
		prompt: prompt.prompt,
		variableValues: prompt.variableValues,
		success: true,
		imageId,
		r2Key,
	};
}

/**
 * Process all prompts in parallel batches
 */
export async function processBatches(options: BatchProcessorOptions): Promise<void> {
	const { env, jobId, prompts, model, aspectRatio, batchSize } = options;

	const batches = chunk(prompts, batchSize);

	for (const batch of batches) {
		// Process batch in parallel
		const results = await Promise.allSettled(
			batch.map((prompt) => processPrompt(env, jobId, prompt, model, aspectRatio))
		);

		// Collect completed images and errors
		const completedImages: CompletedImage[] = [];
		const errors: Array<{ prompt: string; error: string; index: number }> = [];

		for (const result of results) {
			if (result.status === "fulfilled") {
				const batchResult = result.value;
				if (batchResult.success && batchResult.imageId && batchResult.r2Key) {
					completedImages.push({
						id: batchResult.imageId,
						prompt: batchResult.prompt,
						variableValues: batchResult.variableValues,
						timestamp: Date.now(),
						r2Key: batchResult.r2Key,
					});
				} else if (!batchResult.success) {
					errors.push({
						prompt: batchResult.prompt,
						error: batchResult.error || "Unknown error",
						index: batchResult.index,
					});
				}
			} else {
				// Promise rejected (shouldn't happen with our error handling, but just in case)
				errors.push({
					prompt: "Unknown",
					error: result.reason?.message || "Promise rejected",
					index: -1,
				});
			}
		}

		// Update job progress in KV
		if (completedImages.length > 0 || errors.length > 0) {
			await updateJobProgress(env.KV, jobId, completedImages, errors);
		}
	}
}

/**
 * Process batches with a callback for each batch completion
 * Useful for streaming progress
 */
export async function processBatchesWithCallback(
	options: BatchProcessorOptions,
	onBatchComplete: (completedImages: CompletedImage[], errors: BatchResult[]) => Promise<void>
): Promise<{ totalCompleted: number; totalFailed: number }> {
	const { env, jobId, prompts, model, aspectRatio, batchSize } = options;

	const batches = chunk(prompts, batchSize);
	let totalCompleted = 0;
	let totalFailed = 0;

	for (const batch of batches) {
		// Process batch in parallel
		const results = await Promise.allSettled(
			batch.map((prompt) => processPrompt(env, jobId, prompt, model, aspectRatio))
		);

		// Collect completed images and errors
		const completedImages: CompletedImage[] = [];
		const errorResults: BatchResult[] = [];

		for (const result of results) {
			if (result.status === "fulfilled") {
				const batchResult = result.value;
				if (batchResult.success && batchResult.imageId && batchResult.r2Key) {
					completedImages.push({
						id: batchResult.imageId,
						prompt: batchResult.prompt,
						variableValues: batchResult.variableValues,
						timestamp: Date.now(),
						r2Key: batchResult.r2Key,
					});
					totalCompleted++;
				} else {
					errorResults.push(batchResult);
					totalFailed++;
				}
			} else {
				errorResults.push({
					index: -1,
					prompt: "Unknown",
					variableValues: {},
					success: false,
					error: result.reason?.message || "Promise rejected",
				});
				totalFailed++;
			}
		}

		// Update KV
		const kvErrors = errorResults.map((e) => ({
			prompt: e.prompt,
			error: e.error || "Unknown error",
			index: e.index,
		}));

		if (completedImages.length > 0 || kvErrors.length > 0) {
			await updateJobProgress(env.KV, jobId, completedImages, kvErrors);
		}

		// Call the callback
		await onBatchComplete(completedImages, errorResults);
	}

	return { totalCompleted, totalFailed };
}
