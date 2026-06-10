/**
 * Calculates a signal value by comparing a score against a threshold.
 *
 * Returns `1` if the score is above the threshold, `-1` if below,
 * and `0` if equal to the threshold.
 *
 * @param score - The score value to evaluate.
 * @param threshold - The threshold to compare against.
 * @returns The calculated signal value: `1`, `-1`, or `0`.
 */
export function calculateSignal(score: number, threshold: number): number {
	if (score > threshold) {
		return 1;
	} else if (score < threshold) {
		return -1;
	} else {
		return 0;
	}
}
