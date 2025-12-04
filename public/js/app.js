/**
 * Banana Image Generator - Main Application
 */

import { startGeneration, connectSSE, createClientZip, getImageUrl } from './api.js';
import { VariableManager } from './variable-manager.js';
import { ImageGallery } from './image-gallery.js';

// Initialize components
const variableManager = new VariableManager();
const gallery = new ImageGallery();

// Built-in templates
const TEMPLATES = {
  'isometric-city': {
    name: 'Isometric City Weather',
    prompt: `Present a clear, 45° top-down isometric miniature 3D cartoon scene of <CITY>, featuring its most iconic landmarks and architectural elements. Use soft, refined textures with realistic PBR materials and gentle, lifelike lighting and shadows. Integrate <WEATHER> weather conditions directly into the city environment to create an immersive atmospheric mood.
Use a clean, minimalistic composition with a soft, white/transparent background.

At the top-center, place the title "<CITY>" in large bold text with a prominent weather icon beneath it.
All text must be centered and may subtly overlap the tops of the buildings.
Square 1080x1080 dimension`,
    variables: {
      CITY: ['Tokyo', 'Paris', 'New York', 'London', 'Sydney'],
      WEATHER: ['sunny', 'rainy', 'snowy', 'foggy', 'stormy'],
    },
    model: 'nano-banana',
    aspectRatio: '1:1',
  },
  'painting': {
    name: 'Artistic Painting',
    prompt: 'A beautiful <STYLE> painting of <SUBJECT> at <TIME_OF_DAY>',
    variables: {
      STYLE: ['impressionist', 'watercolor', 'oil painting'],
      SUBJECT: ['a mountain landscape', 'a city skyline', 'a peaceful lake'],
      TIME_OF_DAY: ['sunrise', 'sunset', 'golden hour'],
    },
    model: 'nano-banana',
    aspectRatio: '1:1',
  },
};

// Load custom templates from localStorage
function loadCustomTemplates() {
  try {
    const saved = localStorage.getItem('banana-custom-templates');
    if (saved) {
      const custom = JSON.parse(saved);
      Object.assign(TEMPLATES, custom);
    }
  } catch (e) {
    console.error('Failed to load custom templates:', e);
  }
}

// Save custom template
function saveCustomTemplate(id, template) {
  try {
    const saved = localStorage.getItem('banana-custom-templates');
    const custom = saved ? JSON.parse(saved) : {};
    custom[id] = template;
    localStorage.setItem('banana-custom-templates', JSON.stringify(custom));
    TEMPLATES[id] = template;
  } catch (e) {
    console.error('Failed to save template:', e);
  }
}

// State
let currentEventSource = null;
let isGenerating = false;
let startTime = null;

// DOM Elements
const form = document.getElementById('generate-form');
const promptInput = document.getElementById('prompt');
const modelSelect = document.getElementById('model');
const batchSizeInput = document.getElementById('batch-size');
const aspectRatioSelect = document.getElementById('aspect-ratio');
const generateBtn = document.getElementById('generate-btn');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const progressTime = document.getElementById('progress-time');
const cancelBtn = document.getElementById('cancel-btn');
const downloadAllBtn = document.getElementById('download-all');
const downloadSelectedBtn = document.getElementById('download-selected');
const removeBackgroundCheckbox = document.getElementById('remove-background');

/**
 * Remove background from an image
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<string>} - Data URL of image with transparent background
 */
async function removeImageBackground(imageUrl) {
  if (!window.removeBackground) {
    console.warn('Background removal library not loaded');
    return imageUrl;
  }

  try {
    // Fetch the image as a blob
    const response = await fetch(imageUrl);
    const blob = await response.blob();

    // Remove background
    const resultBlob = await window.removeBackground(blob, {
      progress: (key, current, total) => {
        // Could show progress here if needed
      },
    });

    // Convert to data URL
    return URL.createObjectURL(resultBlob);
  } catch (error) {
    console.error('Background removal failed:', error);
    return imageUrl; // Return original on failure
  }
}

/**
 * Extract variable names from template
 * @param {string} template
 * @returns {string[]}
 */
function extractVariables(template) {
  const pattern = /<([A-Z_][A-Z0-9_]*)>/g;
  const matches = [...template.matchAll(pattern)];
  return [...new Set(matches.map(m => m[1]))];
}

/**
 * Update progress display
 * @param {number} completed
 * @param {number} total
 */
function updateProgress(completed, total) {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${completed} / ${total} completed`;

  if (startTime) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    progressTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')} elapsed`;
  }
}

/**
 * Show progress section
 */
function showProgress() {
  progressSection.hidden = false;
  progressFill.style.width = '0%';
  progressText.textContent = '0 / 0 completed';
  progressTime.textContent = '';
}

/**
 * Hide progress section
 */
function hideProgress() {
  progressSection.hidden = true;
}

/**
 * Set generation state
 * @param {boolean} generating
 */
function setGenerating(generating) {
  isGenerating = generating;

  const btnText = generateBtn.querySelector('.btn-text');
  const btnLoading = generateBtn.querySelector('.btn-loading');

  if (generating) {
    generateBtn.disabled = true;
    btnText.hidden = true;
    btnLoading.hidden = false;
    promptInput.disabled = true;
    modelSelect.disabled = true;
    batchSizeInput.disabled = true;
    aspectRatioSelect.disabled = true;
  } else {
    generateBtn.disabled = false;
    btnText.hidden = false;
    btnLoading.hidden = true;
    promptInput.disabled = false;
    modelSelect.disabled = false;
    batchSizeInput.disabled = false;
    aspectRatioSelect.disabled = false;
  }
}

/**
 * Cancel current generation
 */
function cancelGeneration() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  setGenerating(false);
  hideProgress();
}

/**
 * Handle form submission
 * @param {Event} e
 */
async function handleSubmit(e) {
  e.preventDefault();

  if (isGenerating) return;

  const promptTemplate = promptInput.value.trim();
  if (!promptTemplate) {
    alert('Please enter a prompt template');
    return;
  }

  // Validate variables
  if (!variableManager.isValid()) {
    const missing = variableManager.getMissingVariables();
    alert(`Please provide values for: ${missing.join(', ')}`);
    return;
  }

  // Prepare request data
  const data = {
    promptTemplate,
    variables: variableManager.getValues(),
    model: modelSelect.value,
    batchSize: parseInt(batchSizeInput.value, 10),
    aspectRatio: aspectRatioSelect.value,
  };

  setGenerating(true);
  showProgress();
  gallery.clear();
  startTime = Date.now();

  try {
    // Start generation
    const response = await startGeneration(data);

    if (!response.success) {
      throw new Error(response.error || 'Failed to start generation');
    }

    const { jobId, totalPrompts } = response;

    // Add placeholders
    gallery.addPlaceholders(totalPrompts);
    updateProgress(0, totalPrompts);

    const shouldRemoveBackground = removeBackgroundCheckbox?.checked;

    // Connect to SSE for progress
    currentEventSource = connectSSE(jobId, {
      onProgress: async ({ completed, total, images }) => {
        updateProgress(completed, total);
        for (const img of images) {
          let imageUrl = img.url;

          // Process background removal if enabled
          if (shouldRemoveBackground) {
            try {
              progressText.textContent = `${completed} / ${total} - Removing background...`;
              imageUrl = await removeImageBackground(img.url);
            } catch (e) {
              console.error('Background removal failed for', img.id, e);
            }
          }

          gallery.addImage({
            id: img.id,
            prompt: img.prompt,
            url: imageUrl,
            originalUrl: img.url,
            variableValues: img.variableValues,
          });
        }
      },
      onError: (error) => {
        console.error('Generation error:', error);
      },
      onComplete: ({ totalGenerated, totalFailed, durationSeconds }) => {
        setGenerating(false);

        // Update final progress
        const total = totalGenerated + totalFailed;
        updateProgress(total, total);

        // Show completion message
        let message = `Generated ${totalGenerated} image${totalGenerated !== 1 ? 's' : ''}`;
        if (totalFailed > 0) {
          message += ` (${totalFailed} failed)`;
        }
        message += ` in ${durationSeconds}s`;
        progressText.textContent = message;

        currentEventSource = null;
      },
    });
  } catch (error) {
    console.error('Generation failed:', error);
    alert(`Error: ${error.message}`);
    setGenerating(false);
    hideProgress();
  }
}

/**
 * Handle download all
 */
async function handleDownloadAll() {
  const images = gallery.getAllImages();
  if (images.length === 0) {
    alert('No images to download');
    return;
  }

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'Creating ZIP...';

  try {
    const blob = await createClientZip(images, (completed, total) => {
      downloadAllBtn.textContent = `Downloading ${completed}/${total}...`;
    });

    // Download the ZIP
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banana-images-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download failed:', error);
    alert('Failed to create ZIP file');
  } finally {
    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = 'Download All';
  }
}

/**
 * Handle download selected
 */
async function handleDownloadSelected() {
  const images = gallery.getSelectedImages();
  if (images.length === 0) {
    alert('No images selected');
    return;
  }

  downloadSelectedBtn.disabled = true;
  const originalText = downloadSelectedBtn.textContent;
  downloadSelectedBtn.textContent = 'Creating ZIP...';

  try {
    const blob = await createClientZip(images, (completed, total) => {
      downloadSelectedBtn.textContent = `Downloading ${completed}/${total}...`;
    });

    // Download the ZIP
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banana-images-selected-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download failed:', error);
    alert('Failed to create ZIP file');
  } finally {
    downloadSelectedBtn.disabled = false;
    downloadSelectedBtn.textContent = originalText;
  }
}

/**
 * Load a template by ID
 */
function loadTemplate(templateId) {
  const template = TEMPLATES[templateId];
  if (!template) return;

  promptInput.value = template.prompt;
  const vars = extractVariables(template.prompt);
  variableManager.updateVariables(vars);
  variableManager.loadValues(template.variables);

  if (template.model) {
    modelSelect.value = template.model;
  }
  if (template.aspectRatio) {
    aspectRatioSelect.value = template.aspectRatio;
  }
}

/**
 * Populate template selector
 */
function populateTemplateSelector() {
  const selector = document.getElementById('template-selector');
  if (!selector) return;

  selector.innerHTML = '<option value="">-- Select a template --</option>';
  for (const [id, template] of Object.entries(TEMPLATES)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = template.name;
    selector.appendChild(option);
  }
}

/**
 * Save current prompt as template
 */
function saveCurrentAsTemplate() {
  const name = prompt('Enter a name for this template:');
  if (!name) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const template = {
    name,
    prompt: promptInput.value,
    variables: variableManager.getValues(),
    model: modelSelect.value,
    aspectRatio: aspectRatioSelect.value,
  };

  saveCustomTemplate(id, template);
  populateTemplateSelector();
  alert(`Template "${name}" saved!`);
}

/**
 * Initialize the application
 */
function init() {
  // Load custom templates
  loadCustomTemplates();

  // Listen for prompt changes
  promptInput.addEventListener('input', () => {
    const vars = extractVariables(promptInput.value);
    variableManager.updateVariables(vars);
  });

  // Form submission
  form.addEventListener('submit', handleSubmit);

  // Cancel button
  cancelBtn.addEventListener('click', cancelGeneration);

  // Download buttons
  downloadAllBtn.addEventListener('click', handleDownloadAll);
  downloadSelectedBtn.addEventListener('click', handleDownloadSelected);

  // Template selector
  const templateSelector = document.getElementById('template-selector');
  if (templateSelector) {
    populateTemplateSelector();
    templateSelector.addEventListener('change', (e) => {
      if (e.target.value) {
        loadTemplate(e.target.value);
      }
    });
  }

  // Save template button
  const saveTemplateBtn = document.getElementById('save-template-btn');
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener('click', saveCurrentAsTemplate);
  }

  // Load default template (isometric city)
  loadTemplate('isometric-city');
}

// Start the app
init();
