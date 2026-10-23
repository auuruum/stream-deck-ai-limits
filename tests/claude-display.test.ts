import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeClaudeUsage } from "../src/providers/claude/claude-normalizer.ts";
import { renderUsageIcon } from "../src/render/usage-icon.ts";
import { renderSingleWindowIcon } from "../src/render/single-window-icon.ts";
import { initializeUsageSettings, resolveUsageSettings, sameResolvedSettings, updateDisplayModeSettings } from "../src/settings/usage-settings.ts";

const now = new Date("2026-10-22T10:00:00Z");
const options = { window: "session", resetDisplay: "none", dateFormat: "weekday", providerAccent: "none", now } as const;

test("legacy Claude settings, including hidden Codex preferences, keep Used and their thresholds", () => {
	for (const settings of [{}, { displayMode: "remaining", warningThreshold: 70, criticalThreshold: 90 }, initializeUsageSettings({}, "claude")]) {
		const config = resolveUsageSettings(settings, "claude");
		assert.equal(config.displayMode, "used");
		assert.deepEqual(config.thresholds, { warning: 70, critical: 90 });
	}
	assert.equal(resolveUsageSettings({ claudeDisplayMode: "invalid" }, "claude").displayMode, "used");
});

test("Claude mode changes complement thresholds and keep the Codex preference independent", () => {
	const used = { displayMode: "remaining", claudeDisplayMode: "used", warningThreshold: 70, criticalThreshold: 90 };
	const remaining = updateDisplayModeSettings(used, { ...used, claudeDisplayMode: "remaining" }, "claude");
	assert.deepEqual([remaining.warningThreshold, remaining.criticalThreshold], [30, 10]);
	assert.equal(remaining.displayMode, "remaining");
	assert.ok(sameResolvedSettings(resolveUsageSettings(used, "claude"), resolveUsageSettings(remaining, "claude")));
	assert.deepEqual(updateDisplayModeSettings(remaining, { ...remaining, claudeDisplayMode: "used" }, "claude"), used);
	const explicit = { ...used, claudeDisplayMode: "remaining", warningThreshold: 25, criticalThreshold: 5 };
	assert.equal(updateDisplayModeSettings(used, explicit, "claude"), explicit);
	const codex = updateDisplayModeSettings(remaining, { ...remaining, provider: "codex" });
	assert.equal(resolveUsageSettings(codex).displayMode, "remaining");
	const claude = updateDisplayModeSettings(codex, { ...codex, provider: "claude" });
	assert.equal(resolveUsageSettings(claude).displayMode, "remaining");
	const copilot = updateDisplayModeSettings(claude, { ...claude, provider: "copilot" });
	assert.equal(resolveUsageSettings(copilot).displayMode, "used");
	assert.deepEqual(resolveUsageSettings(copilot).thresholds, resolveUsageSettings(remaining, "claude").thresholds);
});

test("Claude text, full-width bars and gauges agree with each mode and retain reset info", () => {
	const data = normalizeClaudeUsage({
		five_hour: { utilization: 99, resets_at: "2026-10-22T13:00:00Z" },
		seven_day: { utilization: 37, resets_at: "2026-10-27T15:00:00Z" },
		limits: [{ kind: "weekly_scoped", scope: { model: { id: "fable" } }, percent: 80, resets_at: "2026-10-28T10:00:00Z" }],
	});
	const original = structuredClone(data);
	for (const [mode, session, weekly] of [["used", 99, 37], ["remaining", 1, 63]] as const) {
		const svg = renderUsageIcon(data, now, mode, "countdown");
		assert.match(svg, new RegExp(`>${session}%<`));
		assert.match(svg, new RegExp(`>${weekly}%<`));
		assert.match(svg, new RegExp(`y="36" width="${Math.round(120 * session / 100)}" height="8"`));
		assert.match(svg, new RegExp(`y="108" width="${Math.round(120 * weekly / 100)}" height="8"`));
		assert.match(svg, />3h0m</);
		assert.match(svg, />5d5h</);
		assert.match(renderSingleWindowIcon(data, { ...options, displayMode: mode }), new RegExp(`>${session}<tspan`));
		assert.match(renderSingleWindowIcon(data, { ...options, window: "weekly", displayMode: mode }), new RegExp(`>${weekly}<tspan`));
	}
	assert.match(renderSingleWindowIcon(data, { ...options, window: "fable", displayMode: "remaining" }), />20<tspan/);
	assert.deepEqual(data, original);
});

test("Claude exhausted and unknown quota never become healthy Remaining values", () => {
	const data = normalizeClaudeUsage({ five_hour: { utilization: 100 }, seven_day: { utilization: 37 } });
	assert.match(renderUsageIcon(data, now, "remaining"), /fill="#ff453a">0%</);
	for (const value of [null, NaN, undefined]) {
		data.session.usedPercent = value as number | null;
		const svg = renderUsageIcon(data, now, "remaining");
		assert.match(svg, /—/);
		assert.match(svg, />63%</);
		assert.doesNotMatch(svg, /100%|NaN|undefined/);
		assert.match(renderSingleWindowIcon(data, { ...options, displayMode: "remaining" }), /No Data/);
	}
});

test("mode inspector handles Claude without a Codex control and shows the right provider setting", async () => {
	const source = await readFile(new URL("../com.singerous.ai-limits.sdPlugin/ui/display-mode.js", import.meta.url), "utf8");
	for (const fixedClaude of [true, false]) {
		const handlers = new Map<string, () => void>();
		const select = (name: string, value: string) => ({ value, addEventListener: (event: string, fn: () => void) => handlers.set(name + event, fn) });
		const claude = select("claude", "used");
		const codex = select("codex", "remaining");
		const provider = select("provider", "claude");
		const items = new Map(["display-mode-item", "claude-display-mode-item", "display-mode-help-item"].map(id => [id, { style: { display: "" } }]));
		const help = { textContent: "" };
		const warning = { dataset: { default: "70" }, dispatchEvent() {} };
		const critical = { dataset: { default: "90" }, dispatchEvent() {} };
		let receive: (event: { payload: { settings: object } }) => void = () => {};
		vm.runInNewContext(source, {
			document: {
				body: { dataset: fixedClaude ? { provider: "claude" } : {} },
				querySelector: (query: string) => query.includes('"claudeDisplayMode"') ? claude : query.includes('"displayMode"') ? fixedClaude ? null : codex : query.includes('"provider"') ? fixedClaude ? null : provider : query.includes("warningThreshold") ? warning : critical,
				getElementById: (id: string) => id === "display-mode-help" ? help : items.get(id),
			},
			Event: class {},
			SDPIComponents: { streamDeckClient: {
				didReceiveSettings: { subscribe: (fn: typeof receive) => { receive = fn; } },
				getSettings: async () => ({ settings: { displayMode: "remaining" } }),
			} },
		});
		await Promise.resolve();
		assert.match(help.textContent, /Used quota/);
		claude.value = "remaining";
		handlers.get("claudevaluechange")!();
		assert.match(help.textContent, /Remaining quota/);
		assert.equal(warning.dataset.default, "20");
		receive({ payload: { settings: { claudeDisplayMode: "remaining", warningThreshold: 30, criticalThreshold: 10 } } });
		assert.equal(items.get("claude-display-mode-item")!.style.display, "");
		if (!fixedClaude) {
			provider.value = "copilot";
			handlers.get("providervaluechange")!();
			assert.equal(items.get("claude-display-mode-item")!.style.display, "none");
			assert.equal(items.get("display-mode-item")!.style.display, "none");
			provider.value = "codex";
			handlers.get("providervaluechange")!();
			assert.equal(items.get("display-mode-item")!.style.display, "");
			assert.equal(items.get("claude-display-mode-item")!.style.display, "none");
		}
	}
});
