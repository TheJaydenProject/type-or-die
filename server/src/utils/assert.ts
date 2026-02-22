/**
 * Throws a descriptive error if value is null or undefined.
 * Replaces optional chaining in core business logic — if a value
 * is required for an operation to be correct, its absence is a crash,
 * not a branch.
 */
export function assert<T>(value: T | null | undefined, context: string): T {
	if (value === null || value === undefined) {
		throw new Error(`[ASSERTION_FAILURE] ${context}`);
	}
	return value;
}
