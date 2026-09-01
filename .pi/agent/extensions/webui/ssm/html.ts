/** SSM catalog page. Theme vars from webui core (same as /live export-html). */
import { generateThemeCss } from "../core/theme";
import { SSM_PAGE_CSS } from "./page-css";
import { SSM_PAGE_JS } from "./page-js";

export function renderSsmPage(themeName?: string): string {
	const name = themeName || "dark";
	let css = "";
	let error = "";
	try {
		css = generateThemeCss(name);
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	}

	const banner = error
		? `<div class="theme-banner">Theme '${escapeHtml(name)}' failed: ${escapeHtml(error)}</div>`
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="pi-theme" content="${escapeHtml(name)}">
<title>Pi SSM · ${escapeHtml(name)}</title>
<style>
:root {
      ${css}
      --body-bg: var(--exportPageBg);
      --container-bg: var(--exportCardBg);
      --info-bg: var(--exportInfoBg);
}
${SSM_PAGE_CSS}
</style>
</head>
<body data-theme="${escapeHtml(name)}">
${banner}
<header class="top">
  <div>
    <h1>Session manager</h1>
    <p class="sub">Cross-folder catalog · theme <strong>${escapeHtml(name)}</strong></p>
  </div>
  <div class="top-actions">
    <label class="chk"><input type="checkbox" id="show-archived"> archived</label>
    <input type="search" id="q" placeholder="Search name, path, id, preview…" autocomplete="off">
    <button type="button" id="refresh">refresh</button>
  </div>
</header>

<section class="stats" id="stats">Loading…</section>

<main class="layout">
  <aside class="folders" id="folders"></aside>
  <section class="sessions" id="sessions"></section>
  <section class="detail" id="detail">
    <p class="empty">Select a session.</p>
  </section>
</main>

<script>${SSM_PAGE_JS}</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
