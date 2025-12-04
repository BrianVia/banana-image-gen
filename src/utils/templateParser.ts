/**
 * Template Parser Utility
 * Handles parsing and expanding template variables
 */

export interface ExpandedPrompt {
	prompt: string;
	variableValues: Record<string, string>;
	index: number;
}

export interface TemplateExpansionResult {
	prompts: ExpandedPrompt[];
	variableNames: string[];
	totalCombinations: number;
}

/**
 * Extract variable names from a template string
 * Variables are in the format <VARIABLE_NAME>
 */
export function extractVariables(template: string): string[] {
	const varPattern = /<([A-Z_][A-Z0-9_]*)>/g;
	const matches = [...template.matchAll(varPattern)];
	const varNames = matches.map((m) => m[1]);
	return [...new Set(varNames)]; // Remove duplicates
}

/**
 * Validate that all required variables are provided
 */
export function validateVariables(
	template: string,
	variables: Record<string, string[]>
): { valid: boolean; missing: string[]; empty: string[] } {
	const required = extractVariables(template);
	const missing: string[] = [];
	const empty: string[] = [];

	for (const varName of required) {
		if (!(varName in variables)) {
			missing.push(varName);
		} else if (variables[varName].length === 0) {
			empty.push(varName);
		}
	}

	return {
		valid: missing.length === 0 && empty.length === 0,
		missing,
		empty,
	};
}

/**
 * Calculate total number of combinations (cartesian product)
 */
export function calculateCombinations(variables: Record<string, string[]>): number {
	const values = Object.values(variables);
	if (values.length === 0) return 1;
	return values.reduce((acc, arr) => acc * arr.length, 1);
}

/**
 * Generate cartesian product of arrays
 */
function cartesianProduct<T>(arrays: T[][]): T[][] {
	if (arrays.length === 0) return [[]];

	return arrays.reduce<T[][]>(
		(acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
		[[]]
	);
}

/**
 * Expand a template with all variable combinations
 */
export function expandTemplate(
	template: string,
	variables: Record<string, string[]>
): TemplateExpansionResult {
	const variableNames = extractVariables(template);

	// If no variables, return the template as-is
	if (variableNames.length === 0) {
		return {
			prompts: [{ prompt: template, variableValues: {}, index: 0 }],
			variableNames: [],
			totalCombinations: 1,
		};
	}

	// Filter variables to only those used in the template
	const usedVariables: Record<string, string[]> = {};
	for (const name of variableNames) {
		if (variables[name] && variables[name].length > 0) {
			usedVariables[name] = variables[name];
		}
	}

	// Generate all combinations
	const valueArrays = variableNames.map((name) => usedVariables[name] || [""]);
	const combinations = cartesianProduct(valueArrays);

	const prompts: ExpandedPrompt[] = combinations.map((combo, index) => {
		let prompt = template;
		const variableValues: Record<string, string> = {};

		variableNames.forEach((varName, i) => {
			const value = combo[i];
			prompt = prompt.replace(new RegExp(`<${varName}>`, "g"), value);
			variableValues[varName] = value;
		});

		return { prompt, variableValues, index };
	});

	return {
		prompts,
		variableNames,
		totalCombinations: prompts.length,
	};
}

/**
 * Parse a comma-separated or newline-separated list of values
 */
export function parseValueList(input: string): string[] {
	return input
		.split(/[,\n]/)
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

/**
 * Generate a preview of what prompts will be generated
 */
export function previewExpansion(
	template: string,
	variables: Record<string, string[]>,
	limit = 5
): { previews: string[]; total: number; hasMore: boolean } {
	const result = expandTemplate(template, variables);
	const previews = result.prompts.slice(0, limit).map((p) => p.prompt);

	return {
		previews,
		total: result.totalCombinations,
		hasMore: result.totalCombinations > limit,
	};
}
