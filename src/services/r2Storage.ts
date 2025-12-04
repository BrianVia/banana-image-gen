/**
 * R2 Storage Service
 * Handles storing and retrieving generated images from R2
 */

export interface StoreImageOptions {
	bucket: R2Bucket;
	jobId: string;
	imageId: string;
	imageBuffer: ArrayBuffer;
	mimeType?: string;
	prompt?: string;
	variableValues?: Record<string, string>;
}

export interface StoredImageMetadata {
	prompt?: string;
	variableValues?: string;
	timestamp: string;
	jobId: string;
}

/**
 * Store a generated image in R2
 */
export async function storeImage(options: StoreImageOptions): Promise<string> {
	const { bucket, jobId, imageId, imageBuffer, mimeType = "image/png", prompt, variableValues } =
		options;

	const r2Key = `generated/${jobId}/${imageId}.png`;

	const customMetadata: StoredImageMetadata = {
		timestamp: new Date().toISOString(),
		jobId,
	};

	if (prompt) {
		customMetadata.prompt = prompt;
	}

	if (variableValues) {
		customMetadata.variableValues = JSON.stringify(variableValues);
	}

	await bucket.put(r2Key, imageBuffer, {
		httpMetadata: {
			contentType: mimeType,
		},
		customMetadata,
	});

	return r2Key;
}

/**
 * Retrieve an image from R2
 */
export async function getImage(
	bucket: R2Bucket,
	imageId: string
): Promise<{ body: ReadableStream; contentType: string } | null> {
	// Image ID format: {jobId}-{index}-{timestamp}
	// We need to find it by listing or by full key
	// First try direct lookup assuming we have the full key structure

	const object = await bucket.get(`generated/${imageId.split("-")[0]}/${imageId}.png`);

	if (!object) {
		// Try searching for the image
		const prefix = `generated/`;
		const listed = await bucket.list({ prefix, limit: 1000 });

		for (const item of listed.objects) {
			if (item.key.includes(imageId)) {
				const foundObject = await bucket.get(item.key);
				if (foundObject) {
					return {
						body: foundObject.body,
						contentType: foundObject.httpMetadata?.contentType || "image/png",
					};
				}
			}
		}

		return null;
	}

	return {
		body: object.body,
		contentType: object.httpMetadata?.contentType || "image/png",
	};
}

/**
 * Get image by exact R2 key
 */
export async function getImageByKey(
	bucket: R2Bucket,
	r2Key: string
): Promise<{ body: ReadableStream; contentType: string; metadata?: R2ObjectMetadata } | null> {
	const object = await bucket.get(r2Key);

	if (!object) {
		return null;
	}

	return {
		body: object.body,
		contentType: object.httpMetadata?.contentType || "image/png",
		metadata: object,
	};
}

/**
 * List all images for a job
 */
export async function listJobImages(
	bucket: R2Bucket,
	jobId: string
): Promise<Array<{ key: string; size: number; uploaded: Date }>> {
	const prefix = `generated/${jobId}/`;
	const listed = await bucket.list({ prefix });

	return listed.objects.map((obj) => ({
		key: obj.key,
		size: obj.size,
		uploaded: obj.uploaded,
	}));
}

/**
 * Delete all images for a job
 */
export async function deleteJobImages(bucket: R2Bucket, jobId: string): Promise<number> {
	const images = await listJobImages(bucket, jobId);

	if (images.length === 0) {
		return 0;
	}

	// R2 delete takes an array of keys
	const keys = images.map((img) => img.key);
	await bucket.delete(keys);

	return keys.length;
}

/**
 * Get multiple images as ArrayBuffers (for ZIP generation)
 */
export async function getImagesForDownload(
	bucket: R2Bucket,
	r2Keys: string[]
): Promise<Array<{ key: string; buffer: ArrayBuffer; filename: string }>> {
	const results: Array<{ key: string; buffer: ArrayBuffer; filename: string }> = [];

	for (const key of r2Keys) {
		const object = await bucket.get(key);
		if (object) {
			const buffer = await object.arrayBuffer();
			// Extract filename from key: generated/{jobId}/{imageId}.png -> {imageId}.png
			const filename = key.split("/").pop() || `${Date.now()}.png`;
			results.push({ key, buffer, filename });
		}
	}

	return results;
}

interface R2ObjectMetadata {
	key: string;
	version: string;
	size: number;
	etag: string;
	httpEtag: string;
	uploaded: Date;
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: Record<string, string>;
}

interface R2HTTPMetadata {
	contentType?: string;
	contentLanguage?: string;
	contentDisposition?: string;
	contentEncoding?: string;
	cacheControl?: string;
	cacheExpiry?: Date;
}
