// Use the same SDPI settings store as the selects/textfields, but persist numbers as numbers.
(() => {
	for (const input of document.querySelectorAll("[data-number-setting]")) {
		const error = input.closest(".number-setting").querySelector(".number-setting-error");
		const clearError = () => {
			input.setCustomValidity("");
			input.removeAttribute("aria-invalid");
			error.textContent = "";
		};
		const render = (value) => {
			input.value = String(typeof value === "number" && Number.isFinite(value)
				? value : Number(input.dataset.default));
			clearError();
		};
		const [getValue, saveValue] = SDPIComponents.useSettings(input.dataset.numberSetting, render, 0);
		getValue().then(render);
		input.addEventListener("defaultchange", () => getValue().then(render));
		input.addEventListener("input", clearError);

		function commit() {
			const value = input.valueAsNumber;
			const min = Number(input.min);
			const max = Number(input.max);
			if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
				const message = `Enter a whole number from ${min} to ${max}.`;
				input.setCustomValidity(message);
				input.setAttribute("aria-invalid", "true");
				error.textContent = message;
				return;
			}
			clearError();
			void saveValue(value);
		}

		input.addEventListener("change", commit);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commit();
			} else if (event.key === "Escape") {
				event.preventDefault();
				getValue().then(render);
			}
		});
	}
})();
