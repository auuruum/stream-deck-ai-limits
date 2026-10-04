// SDPI controls persist per-action settings; this script only explains their display semantics.
(() => {
	const client = SDPIComponents.streamDeckClient;
	const modeSelect = document.querySelector('[setting="displayMode"]');
	const providerSelect = document.querySelector('[setting="provider"]');
	const warningInput = document.querySelector('[data-number-setting="warningThreshold"]');
	const criticalInput = document.querySelector('[data-number-setting="criticalThreshold"]');
	let settings = {};

	function render(next) {
		settings = next;
		const provider = document.body.dataset.provider || settings.provider || "claude";
		const codex = provider === "codex";
		const remaining = codex && settings.displayMode === "remaining";
		for (const id of ["display-mode-item", "display-mode-help-item"]) {
			const item = document.getElementById(id);
			if (item) item.style.display = codex ? "" : "none";
		}
		document.getElementById("display-mode-help").textContent = remaining
			? "Remaining quota. Colors change at or below the thresholds. Switching modes converts thresholds to preserve warning levels."
			: "Used quota. Colors change at or above the thresholds. Switching modes converts thresholds to preserve warning levels.";
		const warningDefault = remaining ? "20" : codex && settings.displayMode === "used" ? "80" : "70";
		const criticalDefault = remaining ? "10" : "90";
		for (const [input, value] of [[warningInput, warningDefault], [criticalInput, criticalDefault]]) {
			if (input.dataset.default !== value) {
				input.dataset.default = value;
				input.dispatchEvent(new Event("defaultchange"));
			}
		}
	}

	client.didReceiveSettings.subscribe((event) => render(event.payload.settings));
	client.getSettings().then((payload) => render(payload.settings));
	// PI edits can precede the plugin's settings reply. Update help immediately as well.
	modeSelect.addEventListener("valuechange", () => render({ ...settings, displayMode: modeSelect.value }));
	providerSelect?.addEventListener("valuechange", () => render({ ...settings, provider: providerSelect.value }));
})();
