import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext, Env } from "../types";
import { DownloadRequestSchema } from "../types";
import { getJob } from "../services/jobManager";
import { getImagesForDownload } from "../services/r2Storage";

export class ImagesDownload extends OpenAPIRoute {
	schema = {
		tags: ["Images"],
		summary: "Download images as ZIP",
		description: "Download multiple generated images as a ZIP file.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: DownloadRequestSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "ZIP file containing images",
				content: {
					"application/zip": {
						schema: z.any(),
					},
				},
			},
			"400": {
				description: "Invalid request",
			},
			"404": {
				description: "Images not found",
			},
		},
	};

	async handle(c: AppContext) {
		const env = c.env as Env;

		const data = await this.getValidatedData<typeof this.schema>();
		const { imageIds, filename } = data.body;

		if (imageIds.length === 0) {
			return c.json({ success: false, error: "No image IDs provided" }, 400);
		}

		// Limit to 100 images per download
		if (imageIds.length > 100) {
			return c.json({ success: false, error: "Maximum 100 images per download" }, 400);
		}

		// Collect R2 keys from image IDs
		const r2Keys: string[] = [];
		const jobCache = new Map<string, Awaited<ReturnType<typeof getJob>>>();

		for (const imageId of imageIds) {
			// Extract jobId from imageId
			const parts = imageId.split("-");
			if (parts.length < 6) continue;

			const jobId = parts.slice(0, 5).join("-");

			// Get job from cache or fetch
			let job = jobCache.get(jobId);
			if (job === undefined) {
				job = await getJob(env.KV, jobId);
				jobCache.set(jobId, job);
			}

			if (!job) continue;

			// Find image in job
			const image = job.completedImages.find((img) => img.id === imageId);
			if (image) {
				r2Keys.push(image.r2Key);
			}
		}

		if (r2Keys.length === 0) {
			return c.json({ success: false, error: "No valid images found" }, 404);
		}

		// Get image data from R2
		const images = await getImagesForDownload(env.R2_BUCKET, r2Keys);

		if (images.length === 0) {
			return c.json({ success: false, error: "Failed to retrieve images" }, 500);
		}

		// Create ZIP file using simple ZIP format
		// Using a minimal ZIP implementation since we don't have JSZip server-side
		const zipBuffer = createSimpleZip(images);

		const zipFilename = filename || `banana-images-${Date.now()}.zip`;

		return new Response(zipBuffer, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${zipFilename}"`,
				"Access-Control-Allow-Origin": "*",
			},
		});
	}
}

/**
 * Create a simple ZIP file from image buffers
 * This is a minimal implementation - for production, consider using a proper ZIP library
 */
function createSimpleZip(
	files: Array<{ filename: string; buffer: ArrayBuffer }>
): ArrayBuffer {
	// ZIP file format: https://en.wikipedia.org/wiki/ZIP_(file_format)
	const entries: Array<{
		filename: Uint8Array;
		data: Uint8Array;
		crc32: number;
		offset: number;
	}> = [];

	let offset = 0;

	// Prepare entries
	for (const file of files) {
		const filenameBytes = new TextEncoder().encode(file.filename);
		const data = new Uint8Array(file.buffer);
		const crc32 = crc32Checksum(data);

		entries.push({
			filename: filenameBytes,
			data,
			crc32,
			offset,
		});

		// Calculate offset for next entry
		// Local file header: 30 bytes + filename length + data length
		offset += 30 + filenameBytes.length + data.length;
	}

	// Calculate sizes
	let centralDirectorySize = 0;
	for (const entry of entries) {
		centralDirectorySize += 46 + entry.filename.length;
	}

	const totalSize = offset + centralDirectorySize + 22;
	const zipBuffer = new ArrayBuffer(totalSize);
	const view = new DataView(zipBuffer);
	const bytes = new Uint8Array(zipBuffer);

	let pos = 0;

	// Write local file headers and data
	for (const entry of entries) {
		// Local file header signature
		view.setUint32(pos, 0x04034b50, true);
		pos += 4;

		// Version needed
		view.setUint16(pos, 20, true);
		pos += 2;

		// General purpose bit flag
		view.setUint16(pos, 0, true);
		pos += 2;

		// Compression method (0 = store)
		view.setUint16(pos, 0, true);
		pos += 2;

		// Last mod file time
		view.setUint16(pos, 0, true);
		pos += 2;

		// Last mod file date
		view.setUint16(pos, 0, true);
		pos += 2;

		// CRC-32
		view.setUint32(pos, entry.crc32, true);
		pos += 4;

		// Compressed size
		view.setUint32(pos, entry.data.length, true);
		pos += 4;

		// Uncompressed size
		view.setUint32(pos, entry.data.length, true);
		pos += 4;

		// Filename length
		view.setUint16(pos, entry.filename.length, true);
		pos += 2;

		// Extra field length
		view.setUint16(pos, 0, true);
		pos += 2;

		// Filename
		bytes.set(entry.filename, pos);
		pos += entry.filename.length;

		// File data
		bytes.set(entry.data, pos);
		pos += entry.data.length;
	}

	const centralDirectoryStart = pos;

	// Write central directory
	for (const entry of entries) {
		// Central directory file header signature
		view.setUint32(pos, 0x02014b50, true);
		pos += 4;

		// Version made by
		view.setUint16(pos, 20, true);
		pos += 2;

		// Version needed
		view.setUint16(pos, 20, true);
		pos += 2;

		// General purpose bit flag
		view.setUint16(pos, 0, true);
		pos += 2;

		// Compression method
		view.setUint16(pos, 0, true);
		pos += 2;

		// Last mod file time
		view.setUint16(pos, 0, true);
		pos += 2;

		// Last mod file date
		view.setUint16(pos, 0, true);
		pos += 2;

		// CRC-32
		view.setUint32(pos, entry.crc32, true);
		pos += 4;

		// Compressed size
		view.setUint32(pos, entry.data.length, true);
		pos += 4;

		// Uncompressed size
		view.setUint32(pos, entry.data.length, true);
		pos += 4;

		// Filename length
		view.setUint16(pos, entry.filename.length, true);
		pos += 2;

		// Extra field length
		view.setUint16(pos, 0, true);
		pos += 2;

		// File comment length
		view.setUint16(pos, 0, true);
		pos += 2;

		// Disk number start
		view.setUint16(pos, 0, true);
		pos += 2;

		// Internal file attributes
		view.setUint16(pos, 0, true);
		pos += 2;

		// External file attributes
		view.setUint32(pos, 0, true);
		pos += 4;

		// Relative offset of local header
		view.setUint32(pos, entry.offset, true);
		pos += 4;

		// Filename
		bytes.set(entry.filename, pos);
		pos += entry.filename.length;
	}

	// End of central directory record
	view.setUint32(pos, 0x06054b50, true);
	pos += 4;

	// Number of this disk
	view.setUint16(pos, 0, true);
	pos += 2;

	// Disk with central directory
	view.setUint16(pos, 0, true);
	pos += 2;

	// Number of entries on this disk
	view.setUint16(pos, entries.length, true);
	pos += 2;

	// Total number of entries
	view.setUint16(pos, entries.length, true);
	pos += 2;

	// Size of central directory
	view.setUint32(pos, centralDirectorySize, true);
	pos += 4;

	// Offset of central directory
	view.setUint32(pos, centralDirectoryStart, true);
	pos += 4;

	// ZIP comment length
	view.setUint16(pos, 0, true);

	return zipBuffer;
}

/**
 * Calculate CRC-32 checksum
 */
function crc32Checksum(data: Uint8Array): number {
	let crc = 0xffffffff;

	// CRC-32 lookup table
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c;
	}

	for (let i = 0; i < data.length; i++) {
		crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}
