import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { UsageSnapshot } from "../src/providers/types.ts";
import { renderUsageIcon } from "../src/render/usage-icon.ts";
import { resolveUsageSettings, sameResolvedSettings } from "../src/settings/usage-settings.ts";
import { formatResetTime } from "../src/utils/time.ts";

const now = new Date("2026-10-17T10:00:00Z");
const snapshot: UsageSnapshot = {
	provider: "codex", session: { usedPercent: 32, resetAt: "2026-10-17T12:30:00Z" },
	weekly: { usedPercent: 39, resetAt: "2026-10-20T13:00:00Z" }, status: "ok", stale: false, updatedAt: now.toISOString(),
};

test("combined reset settings default to countdown, validate and preserve the provider/cache scope", () => {
	assert.equal(resolveUsageSettings({}, "codex").resetDisplay, "countdown");
	assert.equal(resolveUsageSettings({ resetDisplay: "invalid" }, "codex").resetDisplay, "countdown");
	for (const resetDisplay of ["none", "countdown", "datetime"]) {
		const saved = JSON.parse(JSON.stringify({ resetDisplay }));
		assert.equal(resolveUsageSettings(saved, "codex").resetDisplay, resetDisplay);
		assert.ok(sameResolvedSettings(resolveUsageSettings({}, "codex"), resolveUsageSettings(saved, "codex")));
	}
});

test("both quotas keep their percentages and full-width bars alongside readable compact resets", () => {
	for (const provider of ["codex", "claude"] as const) {
		for (const mode of ["used", "remaining"] as const) {
			const svg = renderUsageIcon({ ...snapshot, provider }, now, mode, "countdown");
			assert.match(svg, />5H</);
			assert.match(svg, />W</);
			assert.match(svg, mode === "remaining" ? />68%</ : />32%</);
			assert.match(svg, mode === "remaining" ? />61%</ : />39%</);
			assert.match(svg, /font-size="22"[^>]*>2h30m</);
			assert.match(svg, /font-size="22"[^>]*>3d3h</);
			assert.match(svg, /y="36" width="120" height="8"/);
			assert.match(svg, /y="108" width="120" height="8"/);
			assert.doesNotMatch(svg, /font-size="1[0-9]"|RESET|>in /);
		}
	}
});

test("absolute resets show a short local weekday and clock without a second date line", () => {
	const svg = renderUsageIcon(snapshot, now, "used", "datetime");
	assert.ok(svg.includes(`>${formatResetTime(snapshot.session.resetAt, "weekday")}<`));
	assert.ok(svg.includes(`>${formatResetTime(snapshot.weekly.resetAt, "weekday")}<`));
	assert.equal([...svg.matchAll(/<text /g)].length, 6, "two labels, percentages and reset values");
	assert.doesNotMatch(svg, /font-size="1[0-9]"/);
});

test("hidden and missing resets preserve the original layout; expired and stale values stay clear", () => {
	const hidden = renderUsageIcon(snapshot, now, "used", "none");
	assert.equal(hidden, renderUsageIcon(snapshot, now, "used"));
	assert.match(hidden, /y="42" width="120" height="12"/);
	assert.doesNotMatch(hidden, /2h30m|stroke-linejoin/);
	const data = { ...snapshot, stale: true, status: "stale" as const,
		session: { usedPercent: 32, resetAt: "invalid" }, weekly: { usedPercent: 39, resetAt: now.toISOString() } };
	const svg = renderUsageIcon(data, now, "remaining", "countdown");
	assert.match(svg, />68%</);
	assert.match(svg, />now</);
	assert.match(svg, /<circle cx="135"/);
	assert.doesNotMatch(svg, /NaN|Invalid Date|undefined/);
});

test("Copilot and error layouts are preserved", () => {
	const data = { ...snapshot, provider: "copilot" as const };
	assert.equal(renderUsageIcon(data, now, "used", "datetime"), renderUsageIcon(data, now, "used"));
	assert.match(renderUsageIcon({ ...snapshot, status: "auth_required" }, now, "used", "countdown"), /Login/);
});

test("combined inspectors offer one reset choice without page rotation settings", async () => {
	for (const provider of ["claude", "codex"]) {
		const html = await readFile(new URL(`../com.singerous.ai-limits.sdPlugin/ui/${provider}.html`, import.meta.url), "utf8");
		assert.ok(html.includes('setting="resetDisplay" default="countdown"'));
		assert.doesNotMatch(html, /keyContent|pageInterval|value="both"/);
	}
});
