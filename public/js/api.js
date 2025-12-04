/**
 * API Client for Banana Image Generator
 */

const API_BASE = '';

/**
 * Start image generation
 * @param {Object} data - Generation request data
 * @returns {Promise<{success: boolean, jobId?: string, totalPrompts?: number, error?: string}>}
 */
export async function startGeneration(data) {
  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return response.json();
}

/**
 * Connect to job status SSE stream
 * @param {string} jobId - Job ID to monitor
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onProgress - Called with progress updates
 * @param {Function} callbacks.onError - Called with errors
 * @param {Function} callbacks.onComplete - Called when job completes
 * @returns {EventSource} - The EventSource connection
 */
export function connectSSE(jobId, callbacks) {
  const eventSource = new EventSource(`${API_BASE}/api/generate/${jobId}/status`);

  eventSource.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    callbacks.onProgress?.(data);
  });

  eventSource.addEventListener('error', (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      callbacks.onError?.(data);
    }
  });

  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    callbacks.onComplete?.(data);
    eventSource.close();
  });

  eventSource.onerror = () => {
    // Connection error - try to reconnect or close
    if (eventSource.readyState === EventSource.CLOSED) {
      callbacks.onError?.({ error: 'Connection closed' });
    }
  };

  return eventSource;
}

/**
 * Poll job status (alternative to SSE)
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>}
 */
export async function pollJobStatus(jobId) {
  const response = await fetch(`${API_BASE}/api/generate/${jobId}/poll`);
  return response.json();
}

/**
 * Get image URL
 * @param {string} imageId - Image ID
 * @returns {string}
 */
export function getImageUrl(imageId) {
  return `${API_BASE}/api/images/${imageId}`;
}

/**
 * Fetch image as blob
 * @param {string} imageId - Image ID
 * @returns {Promise<Blob>}
 */
export async function fetchImageBlob(imageId) {
  const response = await fetch(getImageUrl(imageId));
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  return response.blob();
}

/**
 * Download images as ZIP (server-side)
 * @param {string[]} imageIds - Array of image IDs
 * @param {string} filename - Optional filename
 * @returns {Promise<Blob>}
 */
export async function downloadImagesZip(imageIds, filename) {
  const response = await fetch(`${API_BASE}/api/images/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageIds, filename }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Download failed');
  }

  return response.blob();
}

/**
 * Create ZIP client-side using JSZip
 * @param {Array<{id: string, prompt: string}>} images - Images to include
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Blob>}
 */
export async function createClientZip(images, onProgress) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip not loaded');
  }

  const zip = new JSZip();
  let completed = 0;

  for (const image of images) {
    try {
      const blob = await fetchImageBlob(image.id);
      // Create filename from prompt (sanitized) and index
      const safeName = image.prompt
        .substring(0, 50)
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/_+/g, '_');
      const filename = `${String(completed + 1).padStart(4, '0')}_${safeName}.png`;

      zip.file(filename, blob);
      completed++;
      onProgress?.(completed, images.length);
    } catch (error) {
      console.error(`Failed to fetch image ${image.id}:`, error);
    }
  }

  return zip.generateAsync({ type: 'blob' });
}
