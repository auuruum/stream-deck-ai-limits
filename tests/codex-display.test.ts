import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCodexUsage } from "../src/providers/codex/codex-normalizer.ts";
import { renderUsageIcon } from "../src/render/usage-icon.ts";
import { renderSingleWindowIcon } from "../src/render/single-window-icon.ts";
import { resolveUsageSettings } from "../src/settings/usage-settings.ts";
import type { UsageSnapshot } from "../src/providers/types.ts";

const now = new Date("2026-10-04T10:00:00Z");
const options = { window: "session", resetDisplay: "none", dateFormat: "day-month", providerAccent: "none", now } as const;

function snapshot(session: number | null = 32, weekly: number | null = 39): UsageSnapshot {
	const config = resolveUsageSettings({ displayMode: "remaining", warningThreshold: 20, criticalThreshold: 10 }, "codex");
	return normalizeCodexUsage({ rate_limit: {
		primary_window: { used_percent: session, reset_at: 1791115200 },
		secondary_window: { used_percent: weekly, reset_at: 1791715200 },
	} }, config.thresholds, now);
}

test("dual Codex windows: text and bars agree in both modes without mutating API data", () => {
	const data = snapshot();
	const original = structuredClone(data);
	for (const [mode, session, weekly] of [["used", 32, 39], ["remaining", 68, 61]] as const) {
		const svg = renderUsageIcon(data, now, mode);
		assert.match(svg, new RegExp(`>${session}%<`));
		assert.match(svg, new RegExp(`>${weekly}%<`));
		assert.match(svg, new RegExp(`y="42" width="${Math.round(120 * session / 100)}" height="12" rx="6" fill="#34c759"`));
		assert.match(svg, new RegExp(`y="114" width="${Math.round(120 * weekly / 100)}" height="12" rx="6" fill="#34c759"`));
		assert.match(svg, />5H</);
		assert.match(svg, />W</);
	}
	assert.deepEqual(data, original);
});

test("dual-window colors follow the displayed percent in both modes", () => {
	for (const mode of ["used", "remaining"] as const) {
		for (const [used, color] of [[20, "#34c759"], [85, "#ffd60a"], [95, "#ff9f0a"]] as const) {
			const percent = mode === "used" ? used : 100 - used;
			const svg = renderUsageIcon(snapshot(used, used), now, mode);
			assert.match(svg, new RegExp(`>${percent}%<`));
			assert.match(svg, new RegExp(`y="42" width="${Math.round(120 * percent / 100)}" height="12" rx="6" fill="${color}"`));
		}
	}
});

test("single-window Codex session and weekly percentages follow the mode", () => {
	for (const [mode, session, weekly] of [["used", 32, 39], ["remaining", 68, 61]] as const) {
		assert.match(renderSingleWindowIcon(snapshot(), { ...options, displayMode: mode }), new RegExp(`>${session}<tspan`));
		const svg = renderSingleWindowIcon(snapshot(), { ...options, window: "weekly", displayMode: mode });
		assert.match(svg, new RegExp(`>${weekly}<tspan`));
		assert.match(svg, />7D</);
	}
});

test("single-window gauge sweep matches 20% remaining and 80% used", () => {
	const data = snapshot(80);
	const remaining = renderSingleWindowIcon(data, { ...options, displayMode: "remaining" });
	assert.match(remaining, />20<tspan/);
	assert.match(remaining, /A 46 46 0 0 1 26\.57 66\.80/);
	const used = renderSingleWindowIcon(data, { ...options, displayMode: "used" });
	assert.match(used, />80<tspan/);
	assert.match(used, /A 46 46 0 1 1 117\.43 66\.80/);
});

test("single-window number and gauge use the same mode-aware color", () => {
	for (const [used, remaining, color] of [[20, 80, "#34c759"], [85, 15, "#ffd60a"], [95, 5, "#ff9f0a"], [100, 0, "#ff453a"]] as const) {
		const svg = renderSingleWindowIcon(snapshot(used), { ...options, displayMode: "remaining" });
		assert.match(svg, new RegExp(`font-weight="800" fill="${color}">${remaining}<tspan`));
		if (remaining > 0) assert.match(svg, new RegExp(`stroke="${color}"`));
		else assert.equal([...svg.matchAll(/<path /g)].length, 1, "exhausted remaining quota has no filled gauge");
	}
});

test("zero remaining is red even though its dual-window bar is empty", () => {
	const svg = renderUsageIcon(snapshot(100, 100), now, "remaining");
	assert.match(svg, /fill="#ff453a">0%</);
	assert.doesNotMatch(svg, /height="12" rx="6" fill="#ff453a"/);
});

test("unknown usage never becomes 100% remaining; bad values never reach SVG geometry", () => {
	for (const value of [undefined, null, NaN, Infinity]) {
		const data = snapshot();
		data.session.usedPercent = value as number | null;
		const dual = renderUsageIcon(data, now, "remaining");
		assert.match(dual, /—/);
		assert.match(dual, />61%</);
		const single = renderSingleWindowIcon(data, { ...options, displayMode: "remaining" });
		assert.match(single, /No Data/);
		assert.doesNotMatch(dual + single, /NaN|Infinity|undefined/);
	}
});

test("out-of-range values clamp text and bar together", () => {
	for (const mode of ["used", "remaining"] as const) {
		const data = snapshot();
		data.session.usedPercent = -5;
		data.weekly.usedPercent = 105;
		const svg = renderUsageIcon(data, now, mode);
		assert.match(svg, />0%</);
		assert.match(svg, />100%</);
		assert.doesNotMatch(svg, /-5%|105%|-6|126/);
	}
});

test("Remaining rendering retains reset countdowns and stale markers", () => {
	const data = snapshot();
	data.status = "stale";
	data.stale = true;
	const single = renderSingleWindowIcon(data, { ...options, displayMode: "remaining", resetDisplay: "countdown" });
	assert.match(single, />68<tspan/);
	assert.match(single, /in /);
	assert.match(single, /<circle/);
	assert.match(renderUsageIcon(data, now, "remaining"), /<circle/);
});

test("Claude and Copilot ignore the Codex display preference in both renderers", () => {
	for (const provider of ["claude", "copilot"] as const) {
		const data = { ...snapshot(), provider };
		const dual = renderUsageIcon(data, now, "remaining");
		assert.match(dual, />32%</);
		assert.doesNotMatch(dual, />68%</);
		const single = renderSingleWindowIcon(data, { ...options, displayMode: "remaining" });
		assert.match(single, />32<tspan/);
		assert.doesNotMatch(single, />68<tspan/);
	}
});
