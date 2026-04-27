/**
 * Calculates the signal value based on the provided inputs.
 *
 * @param input - The primary input value for signal calculation.
 * @param threshold - The threshold to compare against.
 * @returns The calculated signal value.
 */
export function calculateSignal(input: number, threshold: number): number {
	if (input > threshold) {
		return 1;
	}
	if (input < threshold) {
		return -1;
	}
	return 0;
}
