/**
 * Variable Manager
 * Handles template variable detection and value management
 */

export class VariableManager {
  constructor() {
    this.container = document.getElementById('variables-list');
    this.countElement = document.getElementById('variable-count');
    this.noVariablesElement = document.getElementById('no-variables');
    this.promptCountElement = document.getElementById('prompt-count');

    this.variables = new Map(); // Map<name, string[]>
    this.currentVarNames = [];
  }

  /**
   * Update the list of variables based on the template
   * @param {string[]} varNames - Array of variable names found in template
   */
  updateVariables(varNames) {
    this.currentVarNames = varNames;

    // Update count display
    this.countElement.textContent = `(${varNames.length} detected)`;

    if (varNames.length === 0) {
      this.container.innerHTML = '';
      this.noVariablesElement.hidden = false;
      this.updatePromptCount();
      return;
    }

    this.noVariablesElement.hidden = true;

    // Remove variables that are no longer in the template
    for (const name of this.variables.keys()) {
      if (!varNames.includes(name)) {
        this.variables.delete(name);
      }
    }

    // Add new variables
    for (const name of varNames) {
      if (!this.variables.has(name)) {
        this.variables.set(name, []);
      }
    }

    // Render the variable inputs
    this.render();
  }

  /**
   * Render all variable inputs
   */
  render() {
    this.container.innerHTML = '';

    for (const name of this.currentVarNames) {
      const values = this.variables.get(name) || [];
      const item = this.createVariableItem(name, values);
      this.container.appendChild(item);
    }
  }

  /**
   * Create a variable input element
   * @param {string} name - Variable name
   * @param {string[]} values - Current values
   * @returns {HTMLElement}
   */
  createVariableItem(name, values) {
    const item = document.createElement('div');
    item.className = 'variable-item';
    item.dataset.name = name;

    const header = document.createElement('div');
    header.className = 'variable-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'variable-name';
    nameSpan.textContent = `<${name}>`;

    const countSpan = document.createElement('span');
    countSpan.className = 'variable-value-count';
    countSpan.textContent = `${values.length} value${values.length !== 1 ? 's' : ''}`;

    header.appendChild(nameSpan);
    header.appendChild(countSpan);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'variable-input';

    const textarea = document.createElement('textarea');
    textarea.placeholder = `Enter values for ${name} (comma or newline separated)`;
    textarea.value = values.join(', ');
    textarea.rows = 2;

    textarea.addEventListener('input', (e) => {
      this.handleValueChange(name, e.target.value, countSpan);
    });

    inputWrapper.appendChild(textarea);
    item.appendChild(header);
    item.appendChild(inputWrapper);

    return item;
  }

  /**
   * Handle value change in textarea
   * @param {string} name - Variable name
   * @param {string} value - Raw input value
   * @param {HTMLElement} countElement - Element to update with count
   */
  handleValueChange(name, value, countElement) {
    const values = this.parseValues(value);
    this.variables.set(name, values);
    countElement.textContent = `${values.length} value${values.length !== 1 ? 's' : ''}`;
    this.updatePromptCount();
  }

  /**
   * Parse comma/newline separated values
   * @param {string} input - Raw input
   * @returns {string[]}
   */
  parseValues(input) {
    return input
      .split(/[,\n]/)
      .map(v => v.trim())
      .filter(v => v.length > 0);
  }

  /**
   * Get all variable values
   * @returns {Record<string, string[]>}
   */
  getValues() {
    const result = {};
    for (const [name, values] of this.variables) {
      result[name] = values;
    }
    return result;
  }

  /**
   * Check if all variables have at least one value
   * @returns {boolean}
   */
  isValid() {
    if (this.currentVarNames.length === 0) {
      return true; // No variables is valid (single prompt)
    }

    for (const name of this.currentVarNames) {
      const values = this.variables.get(name) || [];
      if (values.length === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get missing variable names (no values provided)
   * @returns {string[]}
   */
  getMissingVariables() {
    const missing = [];
    for (const name of this.currentVarNames) {
      const values = this.variables.get(name) || [];
      if (values.length === 0) {
        missing.push(name);
      }
    }
    return missing;
  }

  /**
   * Calculate total number of combinations
   * @returns {number}
   */
  getCombinationCount() {
    if (this.currentVarNames.length === 0) {
      return 1;
    }

    let count = 1;
    for (const name of this.currentVarNames) {
      const values = this.variables.get(name) || [];
      if (values.length > 0) {
        count *= values.length;
      }
    }
    return count;
  }

  /**
   * Update the prompt count display
   */
  updatePromptCount() {
    const count = this.getCombinationCount();
    const missing = this.getMissingVariables();

    if (missing.length > 0) {
      this.promptCountElement.textContent = `Missing values for: ${missing.join(', ')}`;
      this.promptCountElement.style.color = 'var(--error)';
    } else {
      this.promptCountElement.textContent = `${count} image${count !== 1 ? 's' : ''} will be generated`;
      this.promptCountElement.style.color = '';
    }
  }

  /**
   * Clear all variables
   */
  clear() {
    this.variables.clear();
    this.currentVarNames = [];
    this.container.innerHTML = '';
    this.countElement.textContent = '(0 detected)';
    this.noVariablesElement.hidden = false;
    this.updatePromptCount();
  }

  /**
   * Load values from an object
   * @param {Record<string, string[]>} values
   */
  loadValues(values) {
    for (const [name, vals] of Object.entries(values)) {
      this.variables.set(name, vals);
    }
    this.render();
    this.updatePromptCount();
  }
}
