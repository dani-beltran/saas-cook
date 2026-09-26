/** Deliberately accepts only strings: components own their variants. */
export function cn(...values: (string | undefined)[]) {
	return values.filter(Boolean).join(" ");
}
