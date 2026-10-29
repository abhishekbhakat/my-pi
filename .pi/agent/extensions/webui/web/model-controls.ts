// Loaded after the shell so its prompt form exists when DOMContentLoaded fires.
export const MODEL_CONTROLS_JS = String.raw`
(function () {
  'use strict';
  function bootModelControls() {
    var form = document.getElementById('webui-prompt-form');
    var input = document.getElementById('webui-prompt-input');
    if (!form || !input) return;
    var panel = document.createElement('div');
    panel.className = 'webui-model-controls';
    panel.innerHTML = '<label>Model <select id="webui-model" aria-label="Model"></select></label>' +
      '<label>Thinking effort <select id="webui-thinking" aria-label="Thinking effort"></select></label>' +
      '<span id="webui-settings-error" role="status" aria-live="polite"></span>';
    input.insertAdjacentElement('afterend', panel);
    var style = document.createElement('style');
    style.textContent = '.webui-model-controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:8px 0; }' +
      '.webui-model-controls label { display:flex; gap:6px; align-items:center; min-width:0; max-width:100%; }' +
      '.webui-model-controls select { min-width:0; max-width:100%; padding:5px; font:inherit; color:var(--text); background:var(--container-bg); border:1px solid var(--dim); border-radius:4px; }' +
      '#webui-settings-error { color:var(--warning); }';
    document.head.appendChild(style);
    var modelSelect = document.getElementById('webui-model');
    var thinkingSelect = document.getElementById('webui-thinking');
    var error = document.getElementById('webui-settings-error');
    var liveParams = new URLSearchParams(location.search);
    var endpoint = '/__webui/api/settings?id=' + encodeURIComponent(liveParams.get('id') || '') + (liveParams.get('pid') ? '&pid=' + encodeURIComponent(liveParams.get('pid')) : '');
    var busy = false;
    var settings = null;
    var refreshPending = false;
    function key(model) { return JSON.stringify([model.provider, model.id]); }
    function option(select, value, label) {
      var item = document.createElement('option');
      item.value = value;
      item.textContent = label;
      select.appendChild(item);
    }
    function render(data) {
      settings = data;
      modelSelect.replaceChildren();
      var currentKey = data.model ? key(data.model) : '';
      var currentEnabled = data.models.some(function (model) { return key(model) === currentKey; });
      if (!currentEnabled) {
        option(modelSelect, '', data.models.length ? 'Select enabled model' : 'No enabled models available');
        modelSelect.options[0].disabled = true;
      }
      data.models.forEach(function (model) {
        option(modelSelect, key(model), model.name + ' (' + model.provider + ')');
      });
      modelSelect.value = currentEnabled ? currentKey : '';
      thinkingSelect.replaceChildren();
      var selected = data.models.find(function (model) { return key(model) === modelSelect.value; });
      (selected ? selected.thinkingLevels : []).forEach(function (level) { option(thinkingSelect, level, level); });
      thinkingSelect.value = data.thinkingLevel;
      thinkingSelect.disabled = busy || thinkingSelect.options.length < 2;
      modelSelect.disabled = busy || !data.models.length;
    }
    async function load(body) {
      if (busy) { refreshPending = true; return; }
      busy = true;
      modelSelect.disabled = thinkingSelect.disabled = true;
      if (body || !settings) error.textContent = '';
      try {
        var response = await fetch(endpoint, body ? {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
        } : undefined);
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Settings request failed');
        settings = data;
      } catch (failure) {
        error.textContent = failure.message;
        if (body) refreshPending = true;
      } finally {
        busy = false;
        if (settings) render(settings);
        if (refreshPending) { refreshPending = false; void load(); }
      }
    }
    modelSelect.addEventListener('change', function () {
      var model = JSON.parse(modelSelect.value);
      void load({ provider: model[0], modelId: model[1] });
    });
    thinkingSelect.addEventListener('change', function () { void load({ thinkingLevel: thinkingSelect.value }); });
    window.addEventListener('webui-settings-changed', function () { void load(); });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!event.repeat) form.requestSubmit();
    });
    void load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootModelControls, { once: true });
  else bootModelControls();
})();
`;
