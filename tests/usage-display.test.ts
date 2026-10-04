import test from "node:test";
import assert from "node:assert/strict";

import { convertThresholds, getDisplayPercent } from "../src/utils/usage-display.ts";

test("Used percentage matches the API value", () => {
	for (const used of [0, 1, 32, 39, 100]) {
		assert.equal(getDisplayPercent(used, "used"), used);
	}
});

test("Remaining percentage complements usage", () => {
	for (const [used, remaining] of [[0, 100], [1, 99], [32, 68], [39, 61], [100, 0]]) {
		assert.equal(getDisplayPercent(used, "remaining"), remaining);
	}
});

test("both modes clamp negative and oversized usage", () => {
	assert.equal(getDisplayPercent(-5, "used"), 0);
	assert.equal(getDisplayPercent(105, "used"), 100);
	assert.equal(getDisplayPercent(-5, "remaining"), 100);
	assert.equal(getDisplayPercent(105, "remaining"), 0);
});

test("missing or invalid usage stays unknown in both modes", () => {
	for (const value of [undefined, null, NaN, Infinity, -Infinity, "32", {}, false]) {
		assert.equal(getDisplayPercent(value, "used"), null);
		assert.equal(getDisplayPercent(value, "remaining"), null);
	}
});

test("threshold conversion preserves custom levels and round-trips", () => {
	const used = { warning: 75, critical: 95 };
	const remaining = convertThresholds(used, "used", "remaining");
	assert.deepEqual(remaining, { warning: 25, critical: 5 });
	assert.deepEqual(convertThresholds(remaining, "remaining", "used"), used);
	assert.deepEqual(used, { warning: 75, critical: 95 });
});
