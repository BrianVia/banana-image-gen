/**
 * Job Manager Service
 * Handles job state management using KV
 */

import type { JobState, CompletedImage } from "../types";

const JOB_TTL_SECONDS = 86400; // 24 hours

/**
 * Create a new job in KV
 */
export async function createJob(
	kv: KVNamespace,
	jobId: string,
	totalPrompts: number,
	model: string,
	aspectRatio: string,
	promptTemplate: string
): Promise<JobState> {
	const job: JobState = {
		jobId,
		status: "pending",
		totalPrompts,
		completedImages: [],
		failedCount: 0,
		errors: [],
		startTime: Date.now(),
		model,
		aspectRatio,
		promptTemplate,
	};

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});

	return job;
}

/**
 * Get job state from KV
 */
export async function getJob(kv: KVNamespace, jobId: string): Promise<JobState | null> {
	const data = await kv.get(`job:${jobId}`, "json");
	return data as JobState | null;
}

/**
 * Update job status
 */
export async function updateJobStatus(
	kv: KVNamespace,
	jobId: string,
	status: JobState["status"]
): Promise<void> {
	const job = await getJob(kv, jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	job.status = status;

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});
}

/**
 * Add completed images to a job
 */
export async function addCompletedImages(
	kv: KVNamespace,
	jobId: string,
	images: CompletedImage[]
): Promise<JobState> {
	const job = await getJob(kv, jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	job.completedImages.push(...images);
	job.status = "processing";

	// Check if job is complete
	if (job.completedImages.length + job.failedCount >= job.totalPrompts) {
		job.status = "complete";
	}

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});

	return job;
}

/**
 * Add errors to a job
 */
export async function addJobErrors(
	kv: KVNamespace,
	jobId: string,
	errors: Array<{ prompt: string; error: string; index: number }>
): Promise<JobState> {
	const job = await getJob(kv, jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	job.errors.push(...errors);
	job.failedCount += errors.length;

	// Check if job is complete
	if (job.completedImages.length + job.failedCount >= job.totalPrompts) {
		job.status = "complete";
	}

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});

	return job;
}

/**
 * Update job progress (both completed images and errors)
 */
export async function updateJobProgress(
	kv: KVNamespace,
	jobId: string,
	completedImages: CompletedImage[],
	errors: Array<{ prompt: string; error: string; index: number }>
): Promise<JobState> {
	const job = await getJob(kv, jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	job.completedImages.push(...completedImages);
	job.errors.push(...errors);
	job.failedCount += errors.length;
	job.status = "processing";

	// Check if job is complete
	if (job.completedImages.length + job.failedCount >= job.totalPrompts) {
		job.status = "complete";
	}

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});

	return job;
}

/**
 * Mark job as failed
 */
export async function markJobFailed(kv: KVNamespace, jobId: string, error: string): Promise<void> {
	const job = await getJob(kv, jobId);
	if (!job) {
		throw new Error(`Job ${jobId} not found`);
	}

	job.status = "failed";
	job.errors.push({ prompt: "Job failed", error, index: -1 });

	await kv.put(`job:${jobId}`, JSON.stringify(job), {
		expirationTtl: JOB_TTL_SECONDS,
	});
}

/**
 * Delete a job from KV
 */
export async function deleteJob(kv: KVNamespace, jobId: string): Promise<void> {
	await kv.delete(`job:${jobId}`);
}

/**
 * List all jobs (with optional pagination)
 */
export async function listJobs(
	kv: KVNamespace,
	options?: { limit?: number; cursor?: string }
): Promise<{ jobs: string[]; cursor?: string }> {
	const listed = await kv.list({
		prefix: "job:",
		limit: options?.limit || 100,
		cursor: options?.cursor,
	});

	return {
		jobs: listed.keys.map((k) => k.name.replace("job:", "")),
		cursor: listed.list_complete ? undefined : listed.cursor,
	};
}

/**
 * Get job progress percentage
 */
export function getJobProgress(job: JobState): number {
	if (job.totalPrompts === 0) return 100;
	const completed = job.completedImages.length + job.failedCount;
	return Math.round((completed / job.totalPrompts) * 100);
}

/**
 * Get elapsed time for a job in seconds
 */
export function getJobDuration(job: JobState): number {
	return Math.round((Date.now() - job.startTime) / 1000);
}
