/**
 * Image Gallery
 * Handles progressive rendering and selection of generated images
 */

export class ImageGallery {
  constructor() {
    this.container = document.getElementById('gallery');
    this.section = document.getElementById('gallery-section');
    this.countElement = document.getElementById('gallery-count');
    this.lightbox = document.getElementById('lightbox');

    this.images = []; // Array of {id, prompt, url, variableValues}
    this.selectedIds = new Set();

    this.setupLightbox();
    this.setupSelectionButtons();
  }

  /**
   * Setup lightbox event handlers
   */
  setupLightbox() {
    const backdrop = this.lightbox.querySelector('.lightbox-backdrop');
    const closeBtn = this.lightbox.querySelector('.lightbox-close');

    backdrop.addEventListener('click', () => this.closeLightbox());
    closeBtn.addEventListener('click', () => this.closeLightbox());

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.lightbox.hidden) {
        this.closeLightbox();
      }
    });

    // Download button in lightbox
    const downloadBtn = document.getElementById('lightbox-download');
    downloadBtn.addEventListener('click', () => {
      if (this.currentLightboxImage) {
        this.downloadImage(this.currentLightboxImage);
      }
    });
  }

  /**
   * Setup selection buttons
   */
  setupSelectionButtons() {
    const selectAllBtn = document.getElementById('select-all');
    const deselectAllBtn = document.getElementById('deselect-all');
    const downloadSelectedBtn = document.getElementById('download-selected');

    selectAllBtn.addEventListener('click', () => this.selectAll());
    deselectAllBtn.addEventListener('click', () => this.deselectAll());
  }

  /**
   * Show the gallery section
   */
  show() {
    this.section.hidden = false;
  }

  /**
   * Hide the gallery section
   */
  hide() {
    this.section.hidden = true;
  }

  /**
   * Clear all images from the gallery
   */
  clear() {
    this.images = [];
    this.selectedIds.clear();
    this.container.innerHTML = '';
    this.updateCount();
    this.updateSelectionUI();
  }

  /**
   * Add placeholders for expected images
   * @param {number} count - Number of placeholders
   */
  addPlaceholders(count) {
    for (let i = 0; i < count; i++) {
      const card = document.createElement('div');
      card.className = 'image-card loading';
      card.dataset.index = i;
      this.container.appendChild(card);
    }
    this.show();
  }

  /**
   * Add an image to the gallery
   * @param {Object} imageData - {id, prompt, url, variableValues}
   */
  addImage(imageData) {
    this.images.push(imageData);

    // Find the next placeholder or create a new card
    const placeholder = this.container.querySelector('.image-card.loading');

    if (placeholder) {
      this.populateCard(placeholder, imageData);
    } else {
      const card = this.createImageCard(imageData);
      this.container.appendChild(card);
    }

    this.updateCount();
  }

  /**
   * Create a new image card
   * @param {Object} imageData
   * @returns {HTMLElement}
   */
  createImageCard(imageData) {
    const card = document.createElement('div');
    card.className = 'image-card';
    this.populateCard(card, imageData);
    return card;
  }

  /**
   * Populate a card with image data
   * @param {HTMLElement} card
   * @param {Object} imageData
   */
  populateCard(card, imageData) {
    card.className = 'image-card';
    card.dataset.id = imageData.id;

    const img = document.createElement('img');
    img.src = imageData.url;
    img.alt = imageData.prompt;
    img.loading = 'lazy';

    const checkMark = document.createElement('div');
    checkMark.className = 'check-mark';
    checkMark.textContent = '✓';

    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';

    const promptPreview = document.createElement('div');
    promptPreview.className = 'prompt-preview';
    promptPreview.textContent = imageData.prompt;

    overlay.appendChild(promptPreview);
    card.appendChild(img);
    card.appendChild(checkMark);
    card.appendChild(overlay);

    // Click to open lightbox, Shift+click to select
    card.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Shift+click toggles selection
        this.toggleSelection(imageData.id, card);
      } else {
        // Regular click opens lightbox
        this.openLightbox(imageData);
      }
    });
  }

  /**
   * Toggle image selection
   * @param {string} imageId
   * @param {HTMLElement} card
   */
  toggleSelection(imageId, card) {
    if (this.selectedIds.has(imageId)) {
      this.selectedIds.delete(imageId);
      card.classList.remove('selected');
    } else {
      this.selectedIds.add(imageId);
      card.classList.add('selected');
    }
    this.updateSelectionUI();
  }

  /**
   * Select all images
   */
  selectAll() {
    for (const image of this.images) {
      this.selectedIds.add(image.id);
    }
    this.container.querySelectorAll('.image-card').forEach(card => {
      if (card.dataset.id) {
        card.classList.add('selected');
      }
    });
    this.updateSelectionUI();
  }

  /**
   * Deselect all images
   */
  deselectAll() {
    this.selectedIds.clear();
    this.container.querySelectorAll('.image-card.selected').forEach(card => {
      card.classList.remove('selected');
    });
    this.updateSelectionUI();
  }

  /**
   * Update selection UI elements
   */
  updateSelectionUI() {
    const selectAllBtn = document.getElementById('select-all');
    const deselectAllBtn = document.getElementById('deselect-all');
    const downloadSelectedBtn = document.getElementById('download-selected');

    const hasSelection = this.selectedIds.size > 0;
    const allSelected = this.selectedIds.size === this.images.length && this.images.length > 0;

    selectAllBtn.hidden = allSelected;
    deselectAllBtn.hidden = !hasSelection;
    downloadSelectedBtn.disabled = !hasSelection;

    if (hasSelection) {
      downloadSelectedBtn.textContent = `Download Selected (${this.selectedIds.size})`;
    } else {
      downloadSelectedBtn.textContent = 'Download Selected';
    }
  }

  /**
   * Update the image count display
   */
  updateCount() {
    this.countElement.textContent = `(${this.images.length})`;
  }

  /**
   * Open lightbox for an image
   * @param {Object} imageData
   */
  openLightbox(imageData) {
    this.currentLightboxImage = imageData;

    const img = document.getElementById('lightbox-image');
    const prompt = document.getElementById('lightbox-prompt');
    const variables = document.getElementById('lightbox-variables');

    img.src = imageData.url;
    prompt.textContent = imageData.prompt;

    // Show variable values
    variables.innerHTML = '';
    if (imageData.variableValues) {
      for (const [name, value] of Object.entries(imageData.variableValues)) {
        const tag = document.createElement('span');
        tag.className = 'variable-tag';
        tag.textContent = `${name}: ${value}`;
        variables.appendChild(tag);
      }
    }

    this.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close the lightbox
   */
  closeLightbox() {
    this.lightbox.hidden = true;
    this.currentLightboxImage = null;
    document.body.style.overflow = '';
  }

  /**
   * Download a single image
   * @param {Object} imageData
   */
  async downloadImage(imageData) {
    try {
      const response = await fetch(imageData.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${imageData.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download image');
    }
  }

  /**
   * Get all images
   * @returns {Array}
   */
  getAllImages() {
    return this.images;
  }

  /**
   * Get selected images
   * @returns {Array}
   */
  getSelectedImages() {
    return this.images.filter(img => this.selectedIds.has(img.id));
  }

  /**
   * Get selected image IDs
   * @returns {string[]}
   */
  getSelectedIds() {
    return Array.from(this.selectedIds);
  }

  /**
   * Mark an error for an expected image
   * @param {number} index - The index of the failed image
   */
  markError(index) {
    const placeholder = this.container.querySelector(`.image-card.loading[data-index="${index}"]`);
    if (placeholder) {
      placeholder.className = 'image-card error';
    }
  }
}
