/**
 * Calculates a signal value by comparing a score against a threshold.
 *
 * Returns `1` if the score is above the threshold, `-1` if below,
 * and `0` if equal to the threshold.
 *
 * @param input - The score value to evaluate.
 * @param threshold - The threshold to compare against.
 * @returns The calculated signal value: `1`, `-1`, or `0`.
 */
export function calculateSignal(input: number, threshold: number): number {
	if (input > threshold) {
		return 1;
	} else if (input < threshold) {
		return -1;
	} else {
		return 0;
	}
}
