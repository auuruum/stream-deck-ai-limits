import { statusForPercent } from "../providers/status.ts";
import type { StatusThresholds, UsageSnapshot, UsageStatus, UsageWindow } from "../providers/types.ts";
import { DEFAULT_THRESHOLDS } from "../providers/types.ts";
import type { CombinedResetDisplay } from "../settings/usage-settings.ts";
import { formatCountdown, formatResetTime } from "../utils/time.ts";
import { convertThresholds, getDisplayPercent, type DisplayMode } from "../utils/usage-display.ts";
import { paletteForStatus, type Palette } from "./colors.ts";
import { SIZE, escapeXml, toDataUrl } from "./svg.ts";

export { toDataUrl };

/**
 * Render a usage snapshot to an SVG string.
 *
 * Two layouts:
 *  - **fallback** (full-key message) for `auth_required`, `rate_limited`, `error`, or when
 *    both windows lack data;
 *  - **bars** (5H + W with progress bars; Copilot: monthly premium bar + text countdown) for
 *    `ok`/`warning`/`critical`/`limited`/`stale`. A `stale` snapshot uses the bars layout with
 *    a small "STALE" marker.
 *
 * The renderer is provider-agnostic — it only reads the normalized {@link UsageSnapshot}.
 *
 * @param now Clock used for reset countdowns; defaults to `new Date()`.
 */
export function renderUsageIcon(snapshot: UsageSnapshot, now: Date = new Date(), displayMode: DisplayMode = "used", resetDisplay: CombinedResetDisplay = "none"): string {
	const status = snapshot.status;
	const label = providerLabel(snapshot.provider);

	if (status === "auth_required" || status === "rate_limited" || status === "error") {
		return renderMessage(status, messageLines(status, label));
	}

	// No usable numbers at all → treat as a generic message even if status looked ok.
	if (getDisplayPercent(snapshot.session.usedPercent, "used") === null &&
		getDisplayPercent(snapshot.weekly.usedPercent, "used") === null) {
		return renderMessage("error", [label, "No", "Data"]);
	}

	return renderBars(snapshot, now, snapshot.provider === "copilot" ? "used" : displayMode, resetDisplay);
}

/** Short display name shown on the key for each provider. */
function providerLabel(provider: UsageSnapshot["provider"]): string {
	switch (provider) {
		case "codex":
			return "Codex";
		case "copilot":
			return "Copilot";
		case "claude":
		default:
			return "Claude";
	}
}

function renderBars(snapshot: UsageSnapshot, now: Date, displayMode: DisplayMode, resetDisplay: CombinedResetDisplay): string {
	const thresholds = convertThresholds(snapshot.thresholds ?? DEFAULT_THRESHOLDS, "used", displayMode);
	const sessionPercent = getDisplayPercent(snapshot.session.usedPercent, displayMode);
	const weeklyPercent = getDisplayPercent(snapshot.weekly.usedPercent, displayMode);
	const stale = snapshot.status === "stale";

	// Stale data still shows real numbers with normal per-bar colors (the values are the
	// last-known-good ones) — only a tiny corner dot hints that a refresh is pending. This keeps
	// transient rate-limit windows from turning the whole key an alarming grey. We use the normal
	// (non-stale) palette for text/background so it reads as live data.
	const palette = paletteForStatus("ok");
	const sessionAccent = accentForPercent(sessionPercent, thresholds, displayMode);
	const weeklyAccent = accentForPercent(weeklyPercent, thresholds, displayMode);

	const staleDot = stale
		? `<circle cx="${SIZE - 9}" cy="9" r="3" fill="${palette.textMuted}"><title>data is stale (refresh pending)</title></circle>`
		: "";

	if (snapshot.provider === "copilot") {
		return renderCopilotBars(providerLabel(snapshot.provider), snapshot.session, palette, sessionAccent, staleDot, now);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  ${barRow(8, "5H", sessionPercent, palette.text, palette.track, sessionAccent, 22, displayMode === "remaining" ? sessionAccent : palette.text, resetText(snapshot.session, resetDisplay, now))}
  <line x1="12" y1="72" x2="${SIZE - 12}" y2="72" stroke="${palette.track}" stroke-width="1"/>
  ${barRow(80, "W", weeklyPercent, palette.text, palette.track, weeklyAccent, 22, displayMode === "remaining" ? weeklyAccent : palette.text, resetText(snapshot.weekly, resetDisplay, now))}
  ${staleDot}
</svg>`;
}

/** Short enough for a full-size line: omit explanatory words, use a real clock icon. */
function resetText(window: UsageWindow, display: CombinedResetDisplay, now: Date): string | null {
	if (display === "datetime") return formatResetTime(window.resetAt, "weekday");
	if (display === "countdown") return formatCountdown(window.resetAt, now)?.replace(/ (\d)/g, "$1") ?? null;
	return null;
}

/**
 * Copilot layout: a monthly premium-usage bar on top, and a text-only countdown to the next
 * quota reset below the divider (Copilot has no weekly window to draw).
 */
function renderCopilotBars(
	label: string,
	window: UsageWindow,
	palette: Palette,
	accent: string,
	staleDot: string,
	now: Date,
): string {
	const countdown = formatCountdown(window.resetAt, now);
	const resetText =
		countdown === null ? "—" : countdown === "now" ? "Resets now" : `${countdown} left`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  ${barRow(8, label, getDisplayPercent(window.usedPercent, "used"), palette.text, palette.track, accent, 16)}
  <line x1="12" y1="72" x2="${SIZE - 12}" y2="72" stroke="${palette.track}" stroke-width="1"/>
  <text x="${SIZE / 2}" y="112" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="${palette.text}">${escapeXml(resetText)}</text>
  ${staleDot}
</svg>`;
}

/** Accent color for one bar, derived from its own percentage and the configured thresholds. */
function accentForPercent(percent: number | null, thresholds: StatusThresholds, displayMode: DisplayMode): string {
	if (percent === null) {
		return paletteForStatus("ok").accent;
	}
	return paletteForStatus(statusForPercent(Math.round(percent), thresholds, displayMode)).accent;
}

function barRow(
	top: number,
	label: string,
	percent: number | null,
	textColor: string,
	trackColor: string,
	accentColor: string,
	valueFontSize = 22,
	valueColor = textColor,
	reset: string | null = null,
): string {
	const hasValue = percent !== null;
	const clamped = hasValue ? Math.round(percent) : 0;
	const valueText = hasValue ? `${clamped}%` : "—";
	const barWidth = Math.round((120 * clamped) / 100);
	const barTop = top + (reset ? 28 : 34);
	const barHeight = reset ? 8 : 12;

	return `
  <text x="12" y="${top + (reset ? 18 : 22)}" font-family="Helvetica, Arial, sans-serif" font-size="${reset ? 20 : 22}" font-weight="700" fill="${textColor}">${escapeXml(label)}</text>
  <text x="${SIZE - 12}" y="${top + (reset ? 18 : 22)}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="${reset ? 24 : valueFontSize}" font-weight="700" fill="${hasValue ? valueColor : textColor}">${escapeXml(valueText)}</text>
  <rect x="12" y="${barTop}" width="120" height="${barHeight}" rx="${barHeight / 2}" fill="${trackColor}"/>
  ${barWidth > 0 ? `<rect x="12" y="${barTop}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="${accentColor}"/>` : ""}
  ${reset ? `<g fill="none" stroke="${textColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="20" cy="${top + 49}" r="7"/><path d="M20 ${top + 45}v4l3 2"/></g>
  <text x="132" y="${top + 56}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="${textColor}">${escapeXml(reset)}</text>` : ""}`;
}

function renderMessage(status: UsageStatus, lines: string[]): string {
	const palette = paletteForStatus(status);
	const startY = SIZE / 2 - ((lines.length - 1) * 26) / 2;
	const text = lines
		.map(
			(line, i) =>
				`<text x="${SIZE / 2}" y="${startY + i * 26 + 8}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="${palette.text}">${escapeXml(line)}</text>`,
		)
		.join("\n  ");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  <rect x="6" y="6" width="${SIZE - 12}" height="${SIZE - 12}" rx="12" fill="none" stroke="${palette.accent}" stroke-width="4"/>
  ${text}
</svg>`;
}

function messageLines(status: UsageStatus, label: string): string[] {
	switch (status) {
		case "auth_required":
			return [label, "Login", "Required"];
		case "rate_limited":
			return [label, "Rate", "Limited"];
		case "error":
		default:
			return [label, "Error"];
	}
}
