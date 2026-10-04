import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
	resolveUsageSettings,
	resolveSingleWindowSettings,
	initializeUsageSettings,
	updateDisplayModeSettings,
	sameResolvedSettings,
	DEFAULT_INTERVAL_SEC,
	MIN_INTERVAL_SEC,
	MAX_INTERVAL_SEC,
	DEFAULT_WARNING_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from "../src/settings/usage-settings.ts";
import { isUsageError } from "../src/utils/errors.ts";
import { isNetworkOrDevicePath, resolveCredentialsPath } from "../src/utils/paths.ts";

test("empty settings → all defaults", () => {
	const r = resolveUsageSettings();
	assert.equal(r.intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(r.thresholds.warning, DEFAULT_WARNING_THRESHOLD);
	assert.equal(r.thresholds.critical, DEFAULT_CRITICAL_THRESHOLD);
	assert.equal(r.customCredentialsPath, undefined);
});

test("interval is clamped to [MIN, MAX] and rounded", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 5 }).intervalSec, MIN_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 30 }).intervalSec, MIN_INTERVAL_SEC); // below floor
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 99999 }).intervalSec, MAX_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 122.7 }).intervalSec, 123);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 90 }).intervalSec, 90);
});

test("invalid interval → default", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: Number.NaN }).intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(
		resolveUsageSettings({ refreshIntervalSec: "abc" as unknown as number }).intervalSec,
		DEFAULT_INTERVAL_SEC,
	);
});

test("thresholds clamped to 0..100 and rounded", () => {
	const r = resolveUsageSettings({ warningThreshold: -10, criticalThreshold: 250 });
	assert.equal(r.thresholds.warning, 0);
	assert.equal(r.thresholds.critical, 100);
});

test("critical is forced to be >= warning", () => {
	const r = resolveUsageSettings({ warningThreshold: 80, criticalThreshold: 50 });
	assert.equal(r.thresholds.warning, 80);
	assert.equal(r.thresholds.critical, 80);
});

test("custom credentials path is trimmed; blank → undefined", () => {
	assert.equal(resolveUsageSettings({ customCredentialsPath: "  /tmp/creds.json  " }).customCredentialsPath, "/tmp/creds.json");
	assert.equal(resolveUsageSettings({ customCredentialsPath: "   " }).customCredentialsPath, undefined);
	assert.equal(resolveUsageSettings({ customCredentialsPath: "" }).customCredentialsPath, undefined);
});

test("credentials paths reject Windows network and device prefixes without exposing the path", () => {
	for (const value of ["\\\\server\\share\\creds", "\\\\?\\UNC\\server\\share\\creds", "\\\\.\\pipe\\creds"]) {
		assert.equal(isNetworkOrDevicePath(value), true);
		assert.throws(() => resolveCredentialsPath("/default", value), (err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /server|pipe|creds/i);
			return true;
		});
	}
	assert.equal(resolveCredentialsPath("/default", "~/creds"), path.join(os.homedir(), "creds"));
	assert.equal(isNetworkOrDevicePath("C:\\Users\\me\\creds"), false);
	assert.equal(isNetworkOrDevicePath("/tmp/creds"), false);
});

test("valid full settings pass through", () => {
	const r = resolveUsageSettings({
		refreshIntervalSec: 90,
		warningThreshold: 60,
		criticalThreshold: 85,
		customCredentialsPath: "/home/u/.claude/.credentials.json",
	});
	assert.equal(r.intervalSec, 90);
	assert.equal(r.thresholds.warning, 60);
	assert.equal(r.thresholds.critical, 85);
	assert.equal(r.customCredentialsPath, "/home/u/.claude/.credentials.json");
});

test("new Codex key defaults are persisted as Remaining 20/10", () => {
	const settings = initializeUsageSettings({}, "codex");
	assert.deepEqual(settings, { displayMode: "remaining", warningThreshold: 20, criticalThreshold: 10 });
	const saved = JSON.parse(JSON.stringify(settings));
	assert.equal(saved.displayMode, "remaining");
	assert.equal(initializeUsageSettings(saved, "codex"), saved);
	const resolved = resolveUsageSettings(saved, "codex");
	assert.equal(resolved.displayMode, "remaining");
	assert.deepEqual(resolved.thresholds, { warning: 80, critical: 90 });
});

test("legacy and invalid Codex modes safely keep Used and existing thresholds", () => {
	for (const displayMode of [undefined, "bad", null as unknown as string]) {
		const settings = { refreshIntervalSec: 120, displayMode, warningThreshold: 75, criticalThreshold: 95 };
		assert.equal(initializeUsageSettings(settings, "codex"), settings);
		const resolved = resolveUsageSettings(settings, "codex");
		assert.equal(resolved.displayMode, "used");
		assert.deepEqual(resolved.thresholds, { warning: 75, critical: 95 });
	}
	assert.deepEqual(resolveUsageSettings({}, "codex").thresholds, { warning: 70, critical: 90 });
});

test("Codex mode-specific threshold defaults and invalid thresholds", () => {
	assert.deepEqual(resolveUsageSettings({ displayMode: "used" }, "codex").thresholds, { warning: 80, critical: 90 });
	assert.deepEqual(resolveUsageSettings({ displayMode: "remaining", warningThreshold: NaN }, "codex").thresholds,
		{ warning: 80, critical: 90 });
	assert.deepEqual(resolveUsageSettings({ displayMode: "remaining", warningThreshold: 20, criticalThreshold: 30 }, "codex").thresholds,
		{ warning: 80, critical: 80 });
});

test("mode switching complements custom thresholds without changing provider/cache config", () => {
	const used = { displayMode: "used", warningThreshold: 75, criticalThreshold: 95, customCredentialsPath: "/test/auth" };
	const remaining = updateDisplayModeSettings(used, { ...used, displayMode: "remaining" }, "codex");
	assert.equal(remaining.warningThreshold, 25);
	assert.equal(remaining.criticalThreshold, 5);
	assert.equal(remaining.customCredentialsPath, "/test/auth");
	assert.ok(sameResolvedSettings(resolveUsageSettings(used, "codex"), resolveUsageSettings(remaining, "codex")));
	assert.deepEqual(updateDisplayModeSettings(remaining, { ...remaining, displayMode: "used" }, "codex"), used);
	assert.deepEqual(used, { displayMode: "used", warningThreshold: 75, criticalThreshold: 95, customCredentialsPath: "/test/auth" });
});

test("explicit thresholds sent with a mode switch are preserved", () => {
	const used = { displayMode: "used", warningThreshold: 80, criticalThreshold: 90 };
	const next = { displayMode: "remaining", warningThreshold: 25, criticalThreshold: 5 };
	assert.equal(updateDisplayModeSettings(used, next, "codex"), next);
});

test("new single-window keys remember Remaining for Codex and keep other providers Used", () => {
	const fresh = initializeUsageSettings({}, "claude");
	assert.equal(fresh.displayMode, "remaining");
	assert.equal(resolveUsageSettings(fresh).displayMode, "used");
	const codex = updateDisplayModeSettings(fresh, { ...fresh, provider: "codex" });
	assert.equal(resolveUsageSettings(codex).displayMode, "remaining");
	assert.deepEqual([codex.warningThreshold, codex.criticalThreshold], [30, 10]);
	for (const provider of ["claude", "copilot"]) {
		const other = updateDisplayModeSettings(codex, { ...codex, provider });
		assert.equal(resolveUsageSettings(other).displayMode, "used");
		assert.deepEqual(resolveUsageSettings(other).thresholds, { warning: 70, critical: 90 });
		const back = updateDisplayModeSettings(other, { ...other, provider: "codex" });
		assert.equal(resolveUsageSettings(back).displayMode, "remaining");
		assert.deepEqual([back.warningThreshold, back.criticalThreshold], [30, 10]);
	}
});

test("single-window: copilot always resolves to the session window", () => {
	const r = resolveSingleWindowSettings({ provider: "copilot", window: "weekly" });
	assert.equal(r.provider, "copilot");
	assert.equal(r.window, "session");
});

test("single-window: copilot is accepted from the provider picker", () => {
	const r = resolveSingleWindowSettings({ provider: "copilot" });
	assert.equal(r.provider, "copilot");
	assert.equal(r.window, "session");
});

test("single-window: copilot ignores a fable window too", () => {
	const r = resolveSingleWindowSettings({ provider: "copilot", window: "fable" });
	assert.equal(r.window, "session");
});

test("single-window: fable window is accepted for Claude", () => {
	const r = resolveSingleWindowSettings({ provider: "claude", window: "fable" });
	assert.equal(r.window, "fable");
});

test("single-window: fable window falls back to weekly for Codex", () => {
	const r = resolveSingleWindowSettings({ provider: "codex", window: "fable" });
	assert.equal(r.provider, "codex");
	assert.equal(r.window, "weekly");
});
