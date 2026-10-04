import test from "node:test";
import assert from "node:assert/strict";
import type { DidReceiveSettingsEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { UsageActionBase } from "../src/actions/usage-action-base.ts";
import { normalizeCodexUsage } from "../src/providers/codex/codex-normalizer.ts";
import type { Provider, UsageProvider } from "../src/providers/types.ts";
import type { ResolvedUsageSettings, UsageActionSettings } from "../src/settings/usage-settings.ts";

class TestCodexAction extends UsageActionBase {
	protected readonly providerId: UsageProvider = "codex";
	providerCount = 0;
	protected override createProvider(config: ResolvedUsageSettings): Provider {
		this.providerCount++;
		return { getUsage: async () => normalizeCodexUsage({ rate_limit: {
			primary_window: { used_percent: 32 }, secondary_window: { used_percent: 39 },
		} }, config.thresholds) };
	}
}

function key(id: string, initial: UsageActionSettings = {}) {
	return {
		id,
		settings: structuredClone(initial),
		writes: 0,
		svg: "",
		isKey: () => true,
		async setSettings(settings: UsageActionSettings) {
			// Stream Deck stores JSON, and later supplies a fresh payload on a profile/action reload.
			this.settings = JSON.parse(JSON.stringify(settings));
			this.writes++;
		},
		async setImage(image: string) {
			this.svg = Buffer.from(image.split(",")[1], "base64").toString("utf8");
		},
	};
}

function appear(action: ReturnType<typeof key>) {
	return { action, payload: { settings: action.settings } } as unknown as WillAppearEvent<UsageActionSettings>;
}

function update(action: ReturnType<typeof key>, settings: UsageActionSettings) {
	action.settings = structuredClone(settings);
	return { action, payload: { settings: action.settings } } as unknown as DidReceiveSettingsEvent<UsageActionSettings>;
}

function disappear(action: ReturnType<typeof key>) {
	return { action, payload: { settings: action.settings } } as unknown as WillDisappearEvent<UsageActionSettings>;
}

test("new action saves Remaining before drawing and survives a restart/profile reload", async () => {
	const first = new TestCodexAction();
	const button = key("new");
	try {
		await first.onWillAppear(appear(button));
		assert.equal(button.writes, 1);
		assert.equal(button.settings.displayMode, "remaining");
		assert.deepEqual([button.settings.warningThreshold, button.settings.criticalThreshold], [20, 10]);
		assert.match(button.svg, />68%</);
		assert.match(button.svg, />61%</);
	} finally {
		first.onWillDisappear(disappear(button));
	}
	const restarted = new TestCodexAction();
	try {
		await restarted.onWillAppear(appear(button));
		assert.equal(button.writes, 1, "saved settings are not overwritten on restart");
		assert.match(button.svg, />68%</);
		restarted.onWillDisappear(disappear(button));
		await restarted.onWillAppear(appear(button));
		assert.match(button.svg, />61%</);
		assert.equal(button.settings.displayMode, "remaining");
	} finally {
		restarted.onWillDisappear(disappear(button));
	}
});

test("legacy action switches live, preserves custom thresholds and reuses its provider", async () => {
	const action = new TestCodexAction();
	const button = key("legacy", { warningThreshold: 75, criticalThreshold: 95 });
	try {
		await action.onWillAppear(appear(button));
		assert.equal(button.writes, 0);
		assert.match(button.svg, />32%</);
		await action.onDidReceiveSettings(update(button, { ...button.settings, displayMode: "remaining" }));
		assert.deepEqual([button.settings.warningThreshold, button.settings.criticalThreshold], [25, 5]);
		assert.match(button.svg, />68%</);
		await action.onDidReceiveSettings(update(button, { ...button.settings, displayMode: "used" }));
		assert.deepEqual([button.settings.warningThreshold, button.settings.criticalThreshold], [75, 95]);
		assert.match(button.svg, />32%</);
		assert.equal(action.providerCount, 1, "display changes preserve the existing provider and cache");
	} finally {
		action.onWillDisappear(disappear(button));
	}
});

test("multiple keys keep independent display preferences", async () => {
	const action = new TestCodexAction();
	const remaining = key("remaining");
	const used = key("used", { displayMode: "used", warningThreshold: 80, criticalThreshold: 90 });
	try {
		await action.onWillAppear(appear(remaining));
		await action.onWillAppear(appear(used));
		assert.match(remaining.svg, />68%</);
		assert.match(used.svg, />32%</);
		assert.equal(remaining.settings.displayMode, "remaining");
		assert.equal(used.settings.displayMode, "used");
	} finally {
		action.onWillDisappear(disappear(remaining));
		action.onWillDisappear(disappear(used));
	}
});
