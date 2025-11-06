(function () {
  const vscode = acquireVsCodeApi();
  const state = { hmi: null, inputs: [], outputs: [], variables: {} };
  const app = document.getElementById('app');

  function send(type, payload) { vscode.postMessage({ type, ...payload }); }
  function currentPage() { return state.hmi?.pages?.[0]; }

  function render() {
    app.innerHTML = '';
    if (!state.hmi) {
      app.innerHTML = '<div style="padding:16px;color:#888">No HMI loaded.</div>';
      return;
    }
    const page = currentPage();
    if (!page) return;
    for (const w of page.widgets) {
      const node = document.createElement('div');
      node.className = `widget w-${w.type}`;
      node.style.left = (w.x || 0) + 'px';
      node.style.top = (w.y || 0) + 'px';
      node.style.width = (w.width || 80) + 'px';
      node.style.height = (w.height || 32) + 'px';

      const boolValue = isBooleanWidget(w.type) ? readBoolean(w) : undefined;
      const numericValue = readNumber(w);

      let decorated = false;
      if (window.HmiSymbols && typeof window.HmiSymbols.decorate === 'function') {
        decorated = window.HmiSymbols.decorate(w, node, {
          mode: 'runtime',
          on: boolValue,
          value: numericValue,
          label: w.label
        });
      }

      if (!decorated) {
        if (w.type === 'text') {
          node.textContent = w.text || w.label || 'Text';
        } else {
          node.textContent = w.label || w.type;
        }
      }

      if (w.type === 'button') {
        const isToggle = (w.variant || 'momentary') === 'toggle';
        const setPressed = pressed => node.classList.toggle('is-pressed', pressed);
        const ripple = (e) => {
          const r = document.createElement('span'); r.className = 'btn-ripple';
          const rect = node.getBoundingClientRect();
          r.style.left = (e.clientX - rect.left) + 'px';
          r.style.top = (e.clientY - rect.top) + 'px';
          node.appendChild(r);
          setTimeout(() => r.remove(), 450);
        };
        node.addEventListener('mousedown', () => { setPressed(true); if (!isToggle) write(w, true); });
        node.addEventListener('mouseup', () => { setPressed(false); if (!isToggle) write(w, false); });
        node.addEventListener('mouseleave', () => { setPressed(false); if (!isToggle) write(w, false); });
        node.addEventListener('click', (e) => { ripple(e); if (isToggle) toggle(w); });
        if (isToggle) { node.classList.toggle('is-on', !!boolValue); }
      } else if (w.type === 'switch') {
        node.classList.toggle('is-on', !!boolValue);
        node.addEventListener('click', () => toggle(w));
      } else if (w.type === 'slider') {
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.className = 'slider-control';
        const min = Number(w.min ?? 0);
        const max = Number(w.max ?? 100);
        rng.min = String(min);
        rng.max = String(max);
        rng.step = String(w.step ?? 1);
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
          write(w, next);
        });
        node.appendChild(rng);
      } else if (w.type === 'numeric') {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'numeric-control';
        if (numericValue !== undefined && numericValue !== null) { inp.value = String(numericValue); }
        const display = node.querySelector('.numeric-display');
        const updateDisplay = (val) => { if (display) display.textContent = formatNumericDisplay(w, val); };
        updateDisplay(numericValue);
        inp.addEventListener('input', () => {
          const next = Number(inp.value);
          if (!Number.isNaN(next)) {
            updateDisplay(next);
            write(w, next);
          }
        });
        node.appendChild(inp);
      }

      app.appendChild(node);
    }
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
        state.hmi = msg.hmi; render(); break;
      case 'ioState':
        state.inputs = msg.inputs || []; state.outputs = msg.outputs || []; render(); break;
      case 'runtimeState':
        state.variables = msg.variables || {}; render(); break;
      default: break;
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
