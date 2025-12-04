import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";

// Import endpoints
import { Generate } from "./endpoints/generate";
import { GenerateStatus, GenerateStatusPoll } from "./endpoints/generateStatus";
import { ImageGet } from "./endpoints/imageGet";
import { ImagesDownload } from "./endpoints/imagesDownload";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use("*", cors());

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/api/docs",
	schema: {
		info: {
			title: "Banana Image Generator API",
			version: "1.0.0",
			description:
				"Generate images using Google's Nano Banana (Gemini) models via OpenRouter. Supports batch processing with template variables.",
		},
	},
});

// Register API endpoints
openapi.post("/api/generate", Generate);
openapi.get("/api/generate/:jobId/status", GenerateStatus);
openapi.get("/api/generate/:jobId/poll", GenerateStatusPoll);
openapi.get("/api/images/:imageId", ImageGet);
openapi.post("/api/images/download", ImagesDownload);

// Health check endpoint
app.get("/api/health", (c) => {
	return c.json({ status: "ok", timestamp: Date.now() });
});

// Export the Hono app
export default app;
