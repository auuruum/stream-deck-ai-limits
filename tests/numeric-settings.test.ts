import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../com.singerous.ai-limits.sdPlugin/ui/numeric-settings.js", import.meta.url), "utf8");

function inspector(initial: Record<string, unknown> = {}) {
	const settings = { ...initial };
	const callbacks = new Map<string, (value: unknown) => void>();
	const writes: { setting: string; value: number }[] = [];
	function field(setting: string, min: number, max: number, fallback: number) {
		const error = { textContent: "" };
		const attributes = new Map<string, string>();
		const handlers = new Map<string, (event?: unknown) => void>();
		return {
			dataset: { numberSetting: setting, default: String(fallback) }, min: String(min), max: String(max), value: "",
			get valueAsNumber() { return this.value.trim() === "" ? NaN : Number(this.value); },
			closest: () => ({ querySelector: () => error }),
			setCustomValidity: () => {},
			setAttribute: (name: string, value: string) => attributes.set(name, value),
			removeAttribute: (name: string) => attributes.delete(name),
			addEventListener: (name: string, handler: (event?: unknown) => void) => handlers.set(name, handler),
			trigger: (name: string, event?: unknown) => handlers.get(name)?.(event), error, attributes,
		};
	}
	const inputs = {
		refresh: field("refreshIntervalSec", 60, 600, 120),
		warning: field("warningThreshold", 0, 100, 70),
		critical: field("criticalThreshold", 0, 100, 90),
	};
	vm.runInNewContext(source, {
		document: { querySelectorAll: () => Object.values(inputs) },
		SDPIComponents: { useSettings: (setting: string, callback: (value: unknown) => void) => {
			callbacks.set(setting, callback);
			return [async () => settings[setting], async (value: number) => {
				settings[setting] = value;
				writes.push({ setting, value });
			}];
		} },
	});
	return { inputs, settings, callbacks, writes };
}

test("numeric inspector displays saved values and saves real numbers without losing other settings", async () => {
	const pi = inspector({ refreshIntervalSec: 135, warningThreshold: 23, criticalThreshold: 7, displayMode: "remaining", window: "weekly" });
	await Promise.resolve();
	assert.equal(pi.inputs.refresh.value, "135");
	assert.equal(pi.inputs.warning.value, "23");
	assert.equal(pi.inputs.critical.value, "7");
	pi.inputs.warning.value = "22";
	pi.inputs.warning.trigger("change");
	assert.equal(pi.settings.warningThreshold, 22);
	assert.equal(typeof pi.settings.warningThreshold, "number");
	assert.equal(pi.settings.displayMode, "remaining");
	assert.equal(pi.settings.window, "weekly");
	assert.equal(pi.settings.criticalThreshold, 7);
});

test("invalid input remains visible with an error and never replaces a saved threshold", async () => {
	const pi = inspector({ warningThreshold: 20 });
	await Promise.resolve();
	for (const value of ["", "-5", "105", "19.5", "NaN"]) {
		pi.inputs.warning.value = value;
		pi.inputs.warning.trigger("change");
		assert.equal(pi.settings.warningThreshold, 20);
		assert.equal(pi.inputs.warning.attributes.get("aria-invalid"), "true");
		assert.match(pi.inputs.warning.error.textContent, /0 to 100/);
	}
	assert.equal(pi.writes.length, 0);
	pi.inputs.warning.value = "0";
	pi.inputs.warning.trigger("change");
	assert.equal(pi.settings.warningThreshold, 0);
	assert.equal(pi.inputs.warning.error.textContent, "");
});

test("Enter saves, Escape restores the saved value, and incoming mode changes update numbers", async () => {
	const pi = inspector({ warningThreshold: 20, criticalThreshold: 10 });
	await Promise.resolve();
	pi.inputs.warning.value = "25";
	pi.inputs.warning.trigger("keydown", { key: "Enter", preventDefault() {} });
	assert.equal(pi.settings.warningThreshold, 25);
	pi.inputs.warning.value = "8";
	pi.inputs.warning.trigger("keydown", { key: "Escape", preventDefault() {} });
	await Promise.resolve();
	assert.equal(pi.inputs.warning.value, "25");
	pi.settings.warningThreshold = 75;
	pi.callbacks.get("warningThreshold")?.(75);
	assert.equal(pi.inputs.warning.value, "75");
});

test("mode defaults only affect missing values and opening the inspector does not persist them", async () => {
	const pi = inspector({ criticalThreshold: 9 });
	await Promise.resolve();
	pi.inputs.warning.dataset.default = "20";
	pi.inputs.warning.trigger("defaultchange");
	pi.inputs.critical.dataset.default = "10";
	pi.inputs.critical.trigger("defaultchange");
	await Promise.resolve();
	assert.equal(pi.inputs.warning.value, "20");
	assert.equal(pi.inputs.critical.value, "9");
	assert.equal(pi.writes.length, 0);
});
