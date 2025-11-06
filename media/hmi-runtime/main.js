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

      if (w.type === 'button') {
        node.textContent = w.label || 'Button';
        node.addEventListener('mousedown', () => write(w, true));
        node.addEventListener('mouseup', () => write(w, false));
        node.addEventListener('mouseleave', () => write(w, false));
        node.addEventListener('click', () => { if ((w.variant || 'momentary') === 'toggle') toggle(w); });
      } else if (w.type === 'switch') {
        node.textContent = w.label || 'Switch';
        node.addEventListener('click', () => toggle(w));
      } else if (w.type === 'lamp') {
        const lit = readBoolean(w);
        node.style.background = lit ? (w.style?.onColor || '#00ff88') : (w.style?.offColor || '#333');
      } else if (w.type === 'text') {
        node.textContent = w.text || w.label || 'Text';
      } else if (w.type === 'slider') {
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.min = String(w.min ?? 0);
        rng.max = String(w.max ?? 100);
        rng.step = String(w.step ?? 1);
        rng.value = String(readNumber(w) ?? w.min ?? 0);
        rng.addEventListener('input', () => write(w, Number(rng.value)));
        node.appendChild(rng);
      } else if (w.type === 'numeric') {
        const inp = document.createElement('input');
        inp.type = 'number';
        const val = readNumber(w);
        if (val !== undefined && val !== null) inp.value = String(val);
        inp.addEventListener('change', () => write(w, Number(inp.value)));
        node.appendChild(inp);
      } else if (w.type === 'motor') {
        const on = readBoolean(w);
        node.textContent = on ? (w.label || 'Motor ON') : (w.label || 'Motor OFF');
        node.style.background = on ? '#0a3' : '#333';
      } else if (w.type === 'cylinder') {
        const ext = readBoolean(w);
        node.textContent = ext ? (w.label || 'Extended') : (w.label || 'Retracted');
        node.style.background = ext ? '#036' : '#333';
      } else {
        node.textContent = w.label || w.type;
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
    return undefined;
  }

  function write(widget, value) {
    const b = widget.binding; if (!b) return;
    if (widget.type === 'button') {
      if ((widget.variant || 'momentary') === 'momentary') {
        vscode.postMessage({ type: 'ioWrite', binding: b, value });
      }
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
})();
