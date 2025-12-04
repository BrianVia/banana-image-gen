import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext, Env, ModelKey } from "../types";
import { GenerateRequestSchema, GenerateResponseSchema } from "../types";
import { expandTemplate, validateVariables } from "../utils/templateParser";
import { createJob } from "../services/jobManager";
import { processBatches } from "../utils/batchProcessor";

export class Generate extends OpenAPIRoute {
	schema = {
		tags: ["Generation"],
		summary: "Start batch image generation",
		description:
			"Start generating images from a prompt template with variable substitution. Returns immediately with a job ID for tracking progress.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: GenerateRequestSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Generation job started successfully",
				content: {
					"application/json": {
						schema: GenerateResponseSchema,
					},
				},
			},
			"400": {
				description: "Invalid request",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: Str(),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const env = c.env as Env;

		// Validate request body
		const data = await this.getValidatedData<typeof this.schema>();
		const { promptTemplate, variables, model, batchSize, aspectRatio } = data.body;

		// Validate that all variables in template are provided
		const validation = validateVariables(promptTemplate, variables);
		if (!validation.valid) {
			const errorMessages: string[] = [];
			if (validation.missing.length > 0) {
				errorMessages.push(`Missing variables: ${validation.missing.join(", ")}`);
			}
			if (validation.empty.length > 0) {
				errorMessages.push(`Empty variables: ${validation.empty.join(", ")}`);
			}
			return c.json({ success: false, error: errorMessages.join("; ") }, 400);
		}

		// Expand template to get all prompts
		const expansion = expandTemplate(promptTemplate, variables);
		const totalPrompts = expansion.totalCombinations;

		// Enforce max batch size
		const maxBatchSize = parseInt(env.MAX_BATCH_SIZE || "20", 10);
		const effectiveBatchSize = Math.min(batchSize, maxBatchSize);

		// Generate unique job ID
		const jobId = crypto.randomUUID();

		// Create job in KV
		await createJob(env.KV, jobId, totalPrompts, model, aspectRatio, promptTemplate);

		// Start batch processing in background
		c.executionCtx.waitUntil(
			processBatches({
				env,
				jobId,
				prompts: expansion.prompts,
				model: model as ModelKey,
				aspectRatio,
				batchSize: effectiveBatchSize,
			})
		);

		// Estimate time based on model and batch count
		const batchCount = Math.ceil(totalPrompts / effectiveBatchSize);
		const avgTimePerBatch = model === "nano-banana" ? 10 : 20; // seconds
		const estimatedTimeSeconds = batchCount * avgTimePerBatch;

		return c.json({
			success: true,
			jobId,
			totalPrompts,
			estimatedTimeSeconds,
		});
	}
}
