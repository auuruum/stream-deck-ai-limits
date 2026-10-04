// SDPI controls persist per-action settings; this script only explains their display semantics.
(() => {
	const client = SDPIComponents.streamDeckClient;
	const modeSelect = document.querySelector('[setting="displayMode"]');
	const providerSelect = document.querySelector('[setting="provider"]');
	const warningRange = document.querySelector('[setting="warningThreshold"]');
	const criticalRange = document.querySelector('[setting="criticalThreshold"]');
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
			? "Shows quota remaining. Lower percentages mean you are closer to the limit; colors change at or below the thresholds. Switching modes converts thresholds to keep the same warning levels."
			: "Shows quota used. Higher percentages mean you are closer to the limit; colors change at or above the thresholds. Switching modes converts thresholds to keep the same warning levels.";
		warningRange.setAttribute("default", remaining ? "20" : codex && settings.displayMode === "used" ? "80" : "70");
		criticalRange.setAttribute("default", remaining ? "10" : "90");
	}

	client.didReceiveSettings.subscribe((event) => render(event.payload.settings));
	client.getSettings().then((payload) => render(payload.settings));
	// PI edits can precede the plugin's settings reply. Update help immediately as well.
	modeSelect.addEventListener("valuechange", () => render({ ...settings, displayMode: modeSelect.value }));
	providerSelect?.addEventListener("valuechange", () => render({ ...settings, provider: providerSelect.value }));
})();
