import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext, Env, JobState, ProgressEvent, CompleteEvent } from "../types";
import { getJob, getJobDuration } from "../services/jobManager";

export class GenerateStatus extends OpenAPIRoute {
	schema = {
		tags: ["Generation"],
		summary: "Get job status via Server-Sent Events",
		description:
			"Connect to receive real-time progress updates for a generation job. Returns SSE stream with progress, error, and complete events.",
		request: {
			params: z.object({
				jobId: Str({ description: "Job ID returned from POST /api/generate" }),
			}),
		},
		responses: {
			"200": {
				description: "SSE stream of job progress",
				content: {
					"text/event-stream": {
						schema: z.object({}),
					},
				},
			},
			"404": {
				description: "Job not found",
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
		const { jobId } = c.req.param();

		// Check if job exists
		const initialJob = await getJob(env.KV, jobId);
		if (!initialJob) {
			return c.json({ success: false, error: "Job not found" }, 404);
		}

		// Create SSE stream
		const stream = new TransformStream();
		const writer = stream.writable.getWriter();
		const encoder = new TextEncoder();

		const sendEvent = async (event: string, data: object) => {
			try {
				await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			} catch {
				// Stream closed, ignore
			}
		};

		// Monitor job in background
		c.executionCtx.waitUntil(
			(async () => {
				let lastSentCount = 0;
				const pollInterval = 500; // ms
				const maxPolls = 600; // 5 minutes max
				let pollCount = 0;

				while (pollCount < maxPolls) {
					try {
						const job = await getJob(env.KV, jobId);

						if (!job) {
							await sendEvent("error", { error: "Job not found" });
							break;
						}

						// Send new images
						if (job.completedImages.length > lastSentCount) {
							const newImages = job.completedImages.slice(lastSentCount);
							const progressEvent: ProgressEvent = {
								completed: job.completedImages.length,
								total: job.totalPrompts,
								images: newImages.map((img) => ({
									id: img.id,
									prompt: img.prompt,
									url: `/api/images/${img.id}`,
									variableValues: img.variableValues,
									timestamp: img.timestamp,
								})),
							};
							await sendEvent("progress", progressEvent);
							lastSentCount = job.completedImages.length;
						}

						// Send errors if any new ones
						if (job.errors.length > 0) {
							// Send latest errors (could track last sent error index for better handling)
							for (const err of job.errors.slice(-10)) {
								await sendEvent("error", {
									prompt: err.prompt,
									error: err.error,
									index: err.index,
									retryable: false,
								});
							}
						}

						// Check if job is complete
						if (job.status === "complete" || job.status === "failed") {
							const completeEvent: CompleteEvent = {
								totalGenerated: job.completedImages.length,
								totalFailed: job.failedCount,
								durationSeconds: getJobDuration(job),
							};
							await sendEvent("complete", completeEvent);
							break;
						}

						await new Promise((resolve) => setTimeout(resolve, pollInterval));
						pollCount++;
					} catch {
						// Error polling, continue
						pollCount++;
						await new Promise((resolve) => setTimeout(resolve, pollInterval));
					}
				}

				try {
					await writer.close();
				} catch {
					// Already closed
				}
			})()
		);

		return new Response(stream.readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
}

/**
 * Non-SSE endpoint for simple job status polling
 */
export class GenerateStatusPoll extends OpenAPIRoute {
	schema = {
		tags: ["Generation"],
		summary: "Get job status (polling)",
		description: "Get current status of a generation job without SSE.",
		request: {
			params: z.object({
				jobId: Str({ description: "Job ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Current job status",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							job: z.object({
								jobId: z.string(),
								status: z.enum(["pending", "processing", "complete", "failed"]),
								totalPrompts: z.number(),
								completedCount: z.number(),
								failedCount: z.number(),
								durationSeconds: z.number(),
								images: z.array(
									z.object({
										id: z.string(),
										prompt: z.string(),
										url: z.string(),
									})
								),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Job not found",
			},
		},
	};

	async handle(c: AppContext) {
		const env = c.env as Env;
		const { jobId } = c.req.param();

		const job = await getJob(env.KV, jobId);
		if (!job) {
			return c.json({ success: false, error: "Job not found" }, 404);
		}

		return c.json({
			success: true,
			job: {
				jobId: job.jobId,
				status: job.status,
				totalPrompts: job.totalPrompts,
				completedCount: job.completedImages.length,
				failedCount: job.failedCount,
				durationSeconds: getJobDuration(job),
				images: job.completedImages.map((img) => ({
					id: img.id,
					prompt: img.prompt,
					url: `/api/images/${img.id}`,
					variableValues: img.variableValues,
				})),
			},
		});
	}
}
