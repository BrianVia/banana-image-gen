import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext, Env } from "../types";
import { getJob } from "../services/jobManager";
import { getImageByKey } from "../services/r2Storage";

export class ImageGet extends OpenAPIRoute {
	schema = {
		tags: ["Images"],
		summary: "Get a generated image",
		description: "Retrieve a generated image by its ID from R2 storage.",
		request: {
			params: z.object({
				imageId: Str({ description: "Image ID (format: jobId-index-timestamp)" }),
			}),
		},
		responses: {
			"200": {
				description: "Image data",
				content: {
					"image/png": {
						schema: z.any(),
					},
				},
			},
			"404": {
				description: "Image not found",
			},
		},
	};

	async handle(c: AppContext) {
		const env = c.env as Env;
		const { imageId } = c.req.param();

		// Extract jobId from imageId (format: jobId-index-timestamp)
		const parts = imageId.split("-");
		if (parts.length < 6) {
			// UUID has 5 parts, then index and timestamp
			return c.json({ success: false, error: "Invalid image ID format" }, 400);
		}

		// Reconstruct jobId (first 5 parts joined by -)
		const jobId = parts.slice(0, 5).join("-");

		// Check if the job exists and find the image
		const job = await getJob(env.KV, jobId);
		if (!job) {
			return c.json({ success: false, error: "Job not found" }, 404);
		}

		// Find the image in completed images
		const image = job.completedImages.find((img) => img.id === imageId);
		if (!image) {
			return c.json({ success: false, error: "Image not found in job" }, 404);
		}

		// Get image from R2
		const r2Image = await getImageByKey(env.R2_BUCKET, image.r2Key);
		if (!r2Image) {
			return c.json({ success: false, error: "Image not found in storage" }, 404);
		}

		return new Response(r2Image.body, {
			headers: {
				"Content-Type": r2Image.contentType,
				"Cache-Control": "public, max-age=31536000, immutable",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
}
