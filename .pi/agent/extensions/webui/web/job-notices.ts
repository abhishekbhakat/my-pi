import { compactJobSummary } from "../../jobs/format.ts";

// Inserted inside renderEntry so the export renderer still handles Markdown and escaping.
export const JOB_NOTICE_RENDER_JS = `
        if (entry.type === 'custom_message' && entry.customType === 'pi_job_exit') {
          const raw = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
          const summary = typeof entry.details?.summary === 'string' ? entry.details.summary : (${compactJobSummary.toString()})(raw);
          const full = typeof entry.details?.fullContent === 'string' ? entry.details.fullContent : raw;
          const hidden = entry.display === false;
          return '<details class="hook-message webui-job-notice' + (hidden ? ' hook-message-hidden' : '') + '" id="' + entryDomId + '">' +
            '<summary title="' + escapeHtml(summary) + '">[job] ' + escapeHtml(summary) + '</summary>' +
            tsHtml + '<div class="markdown-content">' + safeMarkedParse(full) + '</div></details>';
        }
`;

export const JOB_NOTICE_KEYS_JS = String.raw`
  function setupJobNoticeKeys() {
    document.addEventListener('keydown', function (event) {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || event.key.toLowerCase() !== 'o') return;
      var notices = Array.from(document.querySelectorAll('details.webui-job-notice'));
      if (!notices.length) return;
      event.preventDefault();
      if (event.repeat) return;
      var expand = notices.some(function (notice) { return !notice.open; });
      notices.forEach(function (notice) { notice.open = expand; });
    });
  }
`;
