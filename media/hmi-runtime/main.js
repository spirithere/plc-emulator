(function () {
  const vscode = acquireVsCodeApi();
  const state = { hmi: null, inputs: [], outputs: [], variables: {} };
  const app = document.getElementById('app');
  const widgetNodes = new Map();
  let updateQueued = false;

  function send(type, payload) { vscode.postMessage({ type, ...payload }); }
  function currentPage() { return state.hmi?.pages?.[0]; }

  function widgetKey(widget, index) {
    return widget?.id || `idx-${index}`;
  }

  function rebuildScene() {
    widgetNodes.clear();
    app.innerHTML = '';

    if (!state.hmi) {
      app.innerHTML = '<div style="padding:16px;color:#888">No HMI loaded.</div>';
      return;
    }

    const page = currentPage();
    if (!page) { return; }

    page.widgets.forEach((widget, index) => {
      const node = createWidgetNode(widget);
      const key = widgetKey(widget, index);
      node.dataset.widgetId = key;
      widgetNodes.set(key, { widget, node });
      app.appendChild(node);
    });

    scheduleUpdate(true);
  }

  function createWidgetNode(widget) {
    const node = document.createElement('div');
    node.className = `widget w-${widget.type}`;
    node.style.left = (widget.x || 0) + 'px';
    node.style.top = (widget.y || 0) + 'px';
    node.style.width = (widget.width || 80) + 'px';
    node.style.height = (widget.height || 32) + 'px';

    const boolValue = isBooleanWidget(widget.type) ? readBoolean(widget) : undefined;
    const numericValue = readNumber(widget);

    let decorated = false;
    if (window.HmiSymbols && typeof window.HmiSymbols.decorate === 'function') {
      decorated = window.HmiSymbols.decorate(widget, node, {
        mode: 'runtime',
        on: boolValue,
        value: numericValue,
        label: widget.label
      });
    }

    if (!decorated) {
      if (widget.type === 'text') {
        node.textContent = widget.text || widget.label || 'Text';
      } else {
        node.textContent = widget.label || widget.type;
      }
    }

    attachInteractions(node, widget, numericValue);
    return node;
  }

  function attachInteractions(node, widget, numericValue) {
    if (widget.type === 'button') {
      const isToggle = (widget.variant || 'momentary') === 'toggle';
      const setPressed = pressed => node.classList.toggle('is-pressed', pressed);
      const ripple = (e) => {
        const r = document.createElement('span'); r.className = 'btn-ripple';
        const rect = node.getBoundingClientRect();
        r.style.left = (e.clientX - rect.left) + 'px';
        r.style.top = (e.clientY - rect.top) + 'px';
        node.appendChild(r);
        setTimeout(() => r.remove(), 450);
      };
      node.addEventListener('mousedown', () => { setPressed(true); if (!isToggle) write(widget, true); });
      node.addEventListener('mouseup', () => { setPressed(false); if (!isToggle) write(widget, false); });
      node.addEventListener('mouseleave', () => { setPressed(false); if (!isToggle) write(widget, false); });
      node.addEventListener('click', (e) => { ripple(e); if (isToggle) toggle(widget); });
    } else if (widget.type === 'switch') {
      node.addEventListener('click', () => toggle(widget));
    } else if (widget.type === 'slider') {
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.className = 'slider-control';
      const min = Number(widget.min ?? 0);
      const max = Number(widget.max ?? 100);
      rng.min = String(min);
      rng.max = String(max);
      rng.step = String(widget.step ?? 1);
      const val = clamp(numericValue ?? min, min, max);
      rng.value = String(val);
      const thumb = node.querySelector('.slider-thumb');
      const updateThumb = (value) => {
        if (!thumb) { return; }
        const pct = (clamp(value, min, max) - min) / (max - min || 1);
        thumb.style.left = `${pct * 100}%`;
      };
      updateThumb(val);
      rng.addEventListener('input', () => {
        const next = Number(rng.value);
        updateThumb(next);
        write(widget, next);
      });
      node.appendChild(rng);
    } else if (widget.type === 'numeric') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'numeric-control';
      if (numericValue !== undefined && numericValue !== null) { inp.value = String(numericValue); }
      const display = node.querySelector('.numeric-display');
      const updateDisplay = (val) => { if (display) display.textContent = formatNumericDisplay(widget, val); };
      updateDisplay(numericValue);
      inp.addEventListener('input', () => {
        const next = Number(inp.value);
        if (!Number.isNaN(next)) {
          updateDisplay(next);
          write(widget, next);
        }
      });
      node.appendChild(inp);
    }
  }

  function scheduleUpdate(immediate = false) {
    if (immediate) {
      updateWidgets();
      return;
    }
    if (updateQueued) { return; }
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      updateWidgets();
    });
  }

  function updateWidgets() {
    const page = currentPage();
    if (!page) { return; }
    page.widgets.forEach((widget, index) => {
      const key = widgetKey(widget, index);
      const entry = widgetNodes.get(key);
      if (!entry) { return; }
      applyWidgetState(entry.node, widget);
    });
  }

  function applyWidgetState(node, widget) {
    const boolValue = isBooleanWidget(widget.type) ? readBoolean(widget) : undefined;
    const numericValue = readNumber(widget);
    const ctx = {
      mode: 'runtime',
      on: boolValue,
      value: numericValue,
      label: widget.label
    };

    let handled = false;
    if (window.HmiSymbols && typeof window.HmiSymbols.update === 'function') {
      handled = window.HmiSymbols.update(widget, node, ctx);
    }

    if (!handled) {
      applyFallbackState(node, widget, boolValue, numericValue);
    }

    applyControlState(node, widget, numericValue, boolValue);
  }

  function applyFallbackState(node, widget, boolValue, numericValue) {
    if (widget.type === 'text') {
      const inner = node.querySelector('.w-text-inner');
      if (inner) {
        inner.textContent = widget.text || widget.label || 'Text';
      } else {
        node.textContent = widget.text || widget.label || 'Text';
      }
      return;
    }
    if (widget.type === 'button' || widget.type === 'switch' || widget.type === 'lamp') {
      node.classList.toggle('is-on', !!boolValue);
      return;
    }
    if (widget.type === 'numeric') {
      const display = node.querySelector('.numeric-display');
      if (display) { display.textContent = formatNumericDisplay(widget, numericValue); }
    }
    if (widget.type === 'slider') {
      updateSliderVisual(node, widget, numericValue);
    }
  }

  function applyControlState(node, widget, numericValue, boolValue) {
    if (widget.type === 'slider') {
      const rng = node.querySelector('.slider-control');
      if (rng && document.activeElement !== rng) {
        const min = Number(widget.min ?? 0);
        const max = Number(widget.max ?? 100);
        const val = clamp(numericValue ?? min, min, max);
        rng.value = String(val);
      }
      updateSliderVisual(node, widget, numericValue);
    } else if (widget.type === 'numeric') {
      const inp = node.querySelector('.numeric-control');
      if (inp && document.activeElement !== inp) {
        if (numericValue === undefined || numericValue === null || Number.isNaN(numericValue)) {
          inp.value = '';
        } else {
          inp.value = String(numericValue);
        }
      }
      const display = node.querySelector('.numeric-display');
      if (display) { display.textContent = formatNumericDisplay(widget, numericValue); }
    } else if (widget.type === 'button') {
      const isToggle = (widget.variant || 'momentary') === 'toggle';
      if (isToggle) { node.classList.toggle('is-on', !!boolValue); }
    } else if (widget.type === 'switch') {
      node.classList.toggle('is-on', !!boolValue);
    }
  }

  function updateSliderVisual(node, widget, numericValue) {
    const thumb = node.querySelector('.slider-thumb');
    if (!thumb) { return; }
    const min = Number(widget.min ?? 0);
    const max = Number(widget.max ?? 100);
    const val = clamp(numericValue ?? min, min, max);
    const pct = (val - min) / (max - min || 1);
    thumb.style.left = `${pct * 100}%`;
  }

  function readBoolean(widget) {
    const b = widget.binding; if (!b) return false;
    if (b.target === 'output') {
      const ch = state.outputs.find(o => o.id === b.symbol || o.label === b.symbol);
      return !!(ch?.value);
    }
    if (b.target === 'variable') {
      const v = state.variables[b.symbol];
      if (typeof v === 'number') return v !== 0; return !!v;
    }
    if (b.target === 'input') {
      const ch = state.inputs.find(o => o.id === b.symbol || o.label === b.symbol);
      return !!(ch?.value);
    }
    return false;
  }

  function readNumber(widget) {
    const b = widget.binding; if (!b) return undefined;
    if (b.target === 'variable') {
      const v = state.variables[b.symbol];
      if (typeof v === 'number') return v; return v ? 1 : 0;
    }
    if (b.target === 'output') {
      const ch = state.outputs.find(o => o.id === b.symbol || o.label === b.symbol);
      if (typeof ch?.value === 'number') return ch.value;
      return ch ? (ch.value ? 1 : 0) : undefined;
    }
    if (b.target === 'input') {
      const ch = state.inputs.find(o => o.id === b.symbol || o.label === b.symbol);
      if (typeof ch?.value === 'number') return ch.value;
      return ch ? (ch.value ? 1 : 0) : undefined;
    }
    return undefined;
  }

  function write(widget, value) {
    const b = widget.binding; if (!b) return;
    if (widget.type === 'button') {
      vscode.postMessage({ type: 'ioWrite', binding: b, value });
      return;
    }
    if (widget.type === 'switch') {
      vscode.postMessage({ type: 'ioWrite', binding: b, value: !readBoolean(widget) });
      return;
    }
    if (widget.type === 'slider' || widget.type === 'numeric') {
      vscode.postMessage({ type: 'ioWrite', binding: b, value });
      return;
    }
  }
  function toggle(widget) { write(widget, !readBoolean(widget)); }

  window.addEventListener('message', ev => {
    const msg = ev.data;
    switch (msg?.type) {
      case 'loaded':
        state.hmi = msg.hmi;
        rebuildScene();
        break;
      case 'ioState':
        state.inputs = msg.inputs || [];
        state.outputs = msg.outputs || [];
        scheduleUpdate();
        break;
      case 'runtimeState':
        state.variables = msg.variables || {};
        scheduleUpdate();
        break;
      default:
        break;
    }
  });

  send('requestLoad');

  function isBooleanWidget(type) {
    return ['button', 'switch', 'lamp', 'motor', 'fan', 'pump', 'cylinder', 'valve'].includes(type);
  }

  function clamp(value, min, max) {
    const v = Number.isFinite(value) ? value : min;
    return Math.max(min, Math.min(max, v));
  }

  function formatNumericDisplay(widget, value) {
    if (value === undefined || value === null || Number.isNaN(value)) { return widget.unit ? `-- ${widget.unit}` : '--'; }
    const prec = Math.max(0, Math.round(widget.precision ?? 0));
    const num = Number(value);
    const text = Number.isFinite(num) ? (prec > 0 ? num.toFixed(prec) : Math.round(num).toString()) : '--';
    return widget.unit ? `${text} ${widget.unit}` : text;
  }
})();
