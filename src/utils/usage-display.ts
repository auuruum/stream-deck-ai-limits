import type { StatusThresholds } from "../providers/types.ts";

export type DisplayMode = "remaining" | "used";

/** Unknown usage stays unknown; it must never look like a full remaining quota. */
export function getDisplayPercent(usedPercent: unknown, displayMode: DisplayMode): number | null {
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
		return null;
	}
	const percent = displayMode === "remaining" ? 100 - usedPercent : usedPercent;
	return Math.max(0, Math.min(100, percent));
}

/** Convert warning levels without changing the amount of usage that triggers them. */
export function convertThresholds(
	thresholds: StatusThresholds,
	from: DisplayMode,
	to: DisplayMode,
): StatusThresholds {
	return from === to ? { ...thresholds } : {
		warning: 100 - thresholds.warning,
		critical: 100 - thresholds.critical,
	};
}
