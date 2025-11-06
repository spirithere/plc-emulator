(function () {
  const vscode = acquireVsCodeApi();
  const state = {
    hmi: null,
    selected: new Set(),
    io: { inputs: [], outputs: [] },
    variables: []
  };

  const el = sel => document.querySelector(sel);
  const canvas = el('#canvas');

  function send(type, payload) {
    vscode.postMessage({ type, ...payload });
  }

  function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}`; }
  function displayLabel(type) { return type ? type.charAt(0).toUpperCase() + type.slice(1) : ''; }

  function currentPage() { return state.hmi?.pages?.[0]; }

  function grid() { return state.hmi?.canvas?.grid || 10; }

  function snap(v) { const g = grid(); return Math.round(v / g) * g; }

  function render() {
    renderCanvas();
    renderProps();
  }

  function renderCanvas() {
    if (!state.hmi) { canvas.innerHTML = '<div style="padding:16px;color:#888">No HMI loaded.</div>'; return; }
    const { width, height } = state.hmi.canvas;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.innerHTML = '';
    const page = currentPage();
    if (!page) return;
    for (const w of page.widgets) {
      const node = document.createElement('div');
      const isSel = state.selected.has(w.id);
      node.className = `widget w-${w.type}${isSel ? ' selected' : ''}`;
      node.style.left = (w.x || 0) + 'px';
      node.style.top = (w.y || 0) + 'px';
      node.style.width = (w.width || 80) + 'px';
      node.style.height = (w.height || 32) + 'px';
      node.dataset.id = w.id;

      decorateWidget(node, w);

      enableDrag(node, w);
      attachResize(node, w);
      // keep mousedown only to stop bubbling for background-clear
      node.addEventListener('mousedown', ev => { ev.stopPropagation(); });
      // click to (de)select, safer with drag
      node.addEventListener('click', ev => { select(w.id, ev.shiftKey); ev.stopPropagation(); });
      canvas.appendChild(node);
    }
  }

  function renderProps() {
    const props = el('#props-content') || el('#props');
    if (!state.hmi) { if (props) props.innerHTML = ''; return; }
    const page = currentPage();
    const selectedIds = Array.from(state.selected);
    if (selectedIds.length !== 1) { props.innerHTML = '<div style="opacity:.6">ウィジェットを1つ選択してください</div>'; return; }
    const w = page?.widgets?.find(x => x.id === selectedIds[0]);
    if (!w) { props.innerHTML = '<div style="opacity:.6">選択されていません</div>'; return; }
    props.innerHTML = '';
    props.appendChild(row('ID', readOnly(w.id)));
    props.appendChild(row('Type', readOnly(w.type)));
    props.appendChild(row('Label', input(w.label || '', v => { w.label = v; rerenderSel(w.id); }))); 
    props.appendChild(row('X', number(w.x || 0, v => { w.x = v; rerenderSel(w.id); }))); 
    props.appendChild(row('Y', number(w.y || 0, v => { w.y = v; rerenderSel(w.id); }))); 
    props.appendChild(row('Width', number(w.width || 80, v => { w.width = v; rerenderSel(w.id); }))); 
    props.appendChild(row('Height', number(w.height || 32, v => { w.height = v; rerenderSel(w.id); })));
    switch (w.type) {
      case 'text': {
        props.appendChild(row('Text', input(w.text || '', v => { w.text = v; rerenderSel(w.id); })));
        break;
      }
      case 'button': {
        const variants = ['momentary', 'toggle'];
        props.appendChild(row('Variant', dropdown(variants, w.variant || 'momentary', v => { w.variant = v; rerenderSel(w.id); })));
        props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
        break;
      }
      case 'switch': {
        props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
        break;
      }
      case 'lamp': {
        props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
        const st = w.style || {};
        props.appendChild(row('On Color', color(st.onColor || '#16ff8a', v => { w.style = { ...(w.style || {}), onColor: v }; rerenderSel(w.id); })));
        props.appendChild(row('Off Color', color(st.offColor || '#1f2937', v => { w.style = { ...(w.style || {}), offColor: v }; rerenderSel(w.id); })));
        break;
      }
      case 'motor':
      case 'fan':
      case 'pump':
      case 'cylinder': {
        props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
        const st = w.style || {};
        props.appendChild(row('Accent Color', color(st.color || getDefaultAccent(w.type), v => { w.style = { ...(w.style || {}), color: v }; rerenderSel(w.id); })));
        break;
      }
      case 'valve': {
        props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
        const st = w.style || {};
        props.appendChild(row('Accent Color', color(st.color || '#facc15', v => { w.style = { ...(w.style || {}), color: v }; rerenderSel(w.id); })));
        const orient = ['horizontal', 'vertical'];
        props.appendChild(row('Orientation', dropdown(orient, w.orientation || 'horizontal', v => { w.orientation = v; rerenderSel(w.id); })));
        break;
      }
      case 'gauge': {
        props.appendChild(row('Min', number(w.min ?? 0, v => { w.min = v; rerenderSel(w.id); })));
        props.appendChild(row('Max', number(w.max ?? 100, v => { w.max = v; rerenderSel(w.id); })));
        props.appendChild(row('Precision', number(w.precision ?? 0, v => { w.precision = Math.max(0, Math.round(v)); rerenderSel(w.id); })));
        props.appendChild(row('Unit', input(w.unit || '', v => { w.unit = v; rerenderSel(w.id); })));
        props.appendChild(row('Preview Value', number(w.previewValue ?? getPreviewValue(w), v => { w.previewValue = v; rerenderSel(w.id); })));
        const st = w.style || {};
        props.appendChild(row('Arc Color', color(st.arcColor || '#334155', v => { w.style = { ...(w.style || {}), arcColor: v }; rerenderSel(w.id); })));
        props.appendChild(row('Active Color', color(st.activeColor || '#38bdf8', v => { w.style = { ...(w.style || {}), activeColor: v }; rerenderSel(w.id); })));
        props.appendChild(row('Needle Color', color(st.needleColor || '#f87171', v => { w.style = { ...(w.style || {}), needleColor: v }; rerenderSel(w.id); })));
        break;
      }
      case 'tank': {
        props.appendChild(row('Min', number(w.min ?? 0, v => { w.min = v; rerenderSel(w.id); })));
        props.appendChild(row('Max', number(w.max ?? 100, v => { w.max = v; rerenderSel(w.id); })));
        props.appendChild(row('Unit', input(w.unit || '', v => { w.unit = v; rerenderSel(w.id); })));
        props.appendChild(row('Preview Value', number(w.previewValue ?? getPreviewValue(w), v => { w.previewValue = v; rerenderSel(w.id); })));
        const st = w.style || {};
        props.appendChild(row('Fill Color', color(st.fillColor || '#22d3ee', v => { w.style = { ...(w.style || {}), fillColor: v }; rerenderSel(w.id); })));
        break;
      }
      case 'slider': {
        props.appendChild(row('Min', number(w.min ?? 0, v => { w.min = v; rerenderSel(w.id); })));
        props.appendChild(row('Max', number(w.max ?? 100, v => { w.max = v; rerenderSel(w.id); })));
        props.appendChild(row('Step', number(w.step ?? 1, v => { w.step = v; rerenderSel(w.id); })));
        props.appendChild(row('Preview Value', number(w.previewValue ?? getPreviewValue(w), v => { w.previewValue = v; rerenderSel(w.id); })));
        break;
      }
      case 'numeric': {
        props.appendChild(row('Precision', number(w.precision ?? 0, v => { w.precision = Math.max(0, Math.round(v)); rerenderSel(w.id); })));
        props.appendChild(row('Unit', input(w.unit || '', v => { w.unit = v; rerenderSel(w.id); })));
        props.appendChild(row('Preview Value', number(w.previewValue ?? getPreviewValue(w), v => { w.previewValue = v; rerenderSel(w.id); })));
        break;
      }
      default:
        break;
    }
    // binding with rules and suggestions
    const b = w.binding || { target: defaultTargetFor(w.type), symbol: '' };
    const allowedTargets = allowedTargetsFor(w.type);
    props.appendChild(row('Bind Target', dropdown(allowedTargets, b.target, v => { b.target = v; w.binding = b; renderProps(); })));
    let symbols = [];
    if (b.target === 'input') symbols = state.io.inputs;
    else if (b.target === 'output') symbols = (state.io.outputs || []).filter(ch => /^Y/i.test(ch.id) || /^Y/i.test(ch.label));
    else if (b.target === 'variable') symbols = state.variables || [];
    const listId = 'bindSymbolsList';
    const symInput = input(b.symbol || '', v => { b.symbol = v; w.binding = b; });
    symInput.setAttribute('list', listId);
    const dl = document.createElement('datalist');
    dl.id = listId;
    for (const ch of symbols) {
      const o = document.createElement('option');
      if (typeof ch === 'string') { o.value = ch; o.label = ch; }
      else { o.value = ch.id; o.label = ch.label; }
      dl.appendChild(o);
    }
    props.appendChild(row('Bind Symbol', wrap([symInput, dl])));
    const warn = validateBinding(w, b);
    if (warn) {
      const wv = document.createElement('div');
      wv.style.color = '#f2c037';
      wv.style.fontSize = '11px';
      wv.textContent = warn;
      props.appendChild(wv);
    }

    // delete button
    const del = document.createElement('button');
    del.textContent = 'Delete widget';
    del.addEventListener('click', () => deleteWidget(w.id));
    props.appendChild(del);
  }

  function row(label, control) {
    const div = document.createElement('div');
    div.className = 'prop-row';
    const l = document.createElement('label');
    l.textContent = label;
    div.appendChild(l);
    div.appendChild(control);
    return div;
  }
  function input(val, on) {
    const i = document.createElement('input');
    i.value = val;
    i.addEventListener('input', () => on(i.value));
    return i;
  }
  function number(val, on) {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(val);
    i.addEventListener('input', () => on(Number(i.value)));
    return i;
  }
  function checkbox(val, on) {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = !!val;
    i.addEventListener('change', () => on(i.checked));
    return i;
  }
  function color(val, on) {
    const i = document.createElement('input');
    i.type = 'color';
    try { i.value = toHexColor(val || '#16ff8a'); } catch { i.value = '#16ff8a'; }
    i.addEventListener('input', () => on(i.value));
    return i;
  }
  function dropdown(options, val, on) {
    const s = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o; s.appendChild(opt);
    }
    s.value = val;
    s.addEventListener('change', () => on(s.value));
    return s;
  }
  function readOnly(text) {
    const i = document.createElement('input');
    i.value = text;
    i.readOnly = true;
    return i;
  }

  // === Symbol rendering ===
  function decorateWidget(node, widget) {
    const factory = window.HmiSymbols;
    const context = {
      mode: 'designer',
      on: isBooleanWidget(widget.type) ? Boolean(widget.previewOn) : undefined,
      value: getPreviewValue(widget),
      label: widget.label
    };
    if (factory && typeof factory.decorate === 'function') {
      const handled = factory.decorate(widget, node, context);
      if (handled) { return; }
    }

    node.innerHTML = '';
    if (widget.type === 'text') {
      const t = document.createElement('div');
      t.className = 'w-text-inner';
      t.textContent = widget.text || widget.label || 'Text';
      node.appendChild(t);
      return;
    }
    const box = document.createElement('div');
    box.className = 'w-generic';
    box.textContent = widget.label || widget.type;
    node.appendChild(box);
  }

  function isBooleanWidget(type) {
    return ['button', 'switch', 'lamp', 'motor', 'fan', 'pump', 'cylinder', 'valve'].includes(type);
  }

  function getPreviewValue(widget) {
    if (widget.previewValue !== undefined && widget.previewValue !== null && widget.previewValue !== '') {
      const num = Number(widget.previewValue);
      if (!Number.isNaN(num)) { return num; }
    }
    switch (widget.type) {
      case 'gauge':
      case 'tank': {
        const min = Number.isFinite(widget.min) ? Number(widget.min) : 0;
        const max = Number.isFinite(widget.max) ? Number(widget.max) : min + 100;
        return min + (max - min) / 2;
      }
      case 'slider':
        return Number.isFinite(widget.min) ? Number(widget.min) : 0;
      case 'numeric':
        return 0;
      default:
        return undefined;
    }
  }

  function getDefaultAccent(type) {
    switch (type) {
      case 'motor':
        return '#42baf9';
      case 'fan':
        return '#60a5fa';
      case 'pump':
        return '#38bdf8';
      case 'cylinder':
        return '#a78bfa';
      default:
        return '#38bdf8';
    }
  }

  function toHexColor(v) {
    if (!v) return '#000000';
    if (/^#([0-9a-f]{3})$/i.test(v)) {
      return '#' + v.slice(1).split('').map(ch => ch+ch).join('');
    }
    if (/^#([0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
    // best-effort parse rgb()
    const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(v);
    if (m) {
      const r = Number(m[1]).toString(16).padStart(2,'0');
      const g = Number(m[2]).toString(16).padStart(2,'0');
      const b = Number(m[3]).toString(16).padStart(2,'0');
      return `#${r}${g}${b}`;
    }
    return '#000000';
  }

  function enableDrag(node, w) {
    let start = null;
    node.addEventListener('mousedown', (e) => {
      start = { x: e.clientX, y: e.clientY, origX: w.x || 0, origY: w.y || 0 };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      if (!start) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      w.x = snap(start.origX + dx);
      w.y = snap(start.origY + dy);
      node.style.left = w.x + 'px';
      node.style.top = w.y + 'px';
    }
    function onUp() {
      start = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      renderProps();
    }
  }

  function rerenderSel(id) {
    renderCanvas();
    select(id);
  }

  function select(id, additive) {
    if (!additive) state.selected.clear();
    if (id) {
      if (additive && state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
    }
    renderCanvas();
    renderProps();
  }

  function addWidget(type) {
    if (!state.hmi) return;
    const page = currentPage();
    const w = { id: uid(type), type, x: 20, y: 20, width: 110, height: 40, label: displayLabel(type) };
    switch (type) {
      case 'lamp':
        w.width = 48; w.height = 48; w.style = { onColor: '#16ff8a', offColor: '#1f2937' };
        break;
      case 'button':
        w.width = 150; w.height = 54; w.variant = 'momentary'; w.label = 'START';
        break;
      case 'switch':
        w.width = 130; w.height = 62; w.label = 'SWITCH';
        break;
      case 'motor':
      case 'fan':
      case 'pump':
        w.width = 96; w.height = 96; w.style = { color: getDefaultAccent(type) };
        break;
      case 'cylinder':
        w.width = 140; w.height = 60; w.style = { color: '#a78bfa' };
        break;
      case 'valve':
        w.width = 96; w.height = 96; w.orientation = 'horizontal'; w.style = { color: '#facc15' };
        break;
      case 'gauge':
        w.width = 200; w.height = 200; w.min = 0; w.max = 100; w.precision = 0; w.unit = ''; w.previewValue = 45; w.style = { arcColor: '#334155', activeColor: '#38bdf8', needleColor: '#f87171' };
        break;
      case 'tank':
        w.width = 140; w.height = 200; w.min = 0; w.max = 100; w.unit = ''; w.previewValue = 60; w.style = { fillColor: '#22d3ee' };
        break;
      case 'slider':
        w.width = 200; w.height = 56; w.min = 0; w.max = 100; w.step = 1; w.previewValue = 0;
        break;
      case 'numeric':
        w.width = 160; w.height = 60; w.precision = 0; w.unit = ''; w.previewValue = 0;
        break;
      case 'text':
        w.width = 180; w.height = 26; w.text = 'Text';
        break;
      default:
        break;
    }
    page.widgets.push(w);
    render();
    select(w.id);
  }

  function deleteWidget(id) {
    const page = currentPage();
    const idx = page.widgets.findIndex(x => x.id === id);
    if (idx >= 0) { page.widgets.splice(idx, 1); }
    state.selected.clear();
    render();
  }

  // toolbar buttons
  el('#btnLoad').addEventListener('click', () => send('requestLoad'));
  el('#btnSave').addEventListener('click', () => send('requestSave', { hmi: state.hmi }));
  document.querySelectorAll('[data-widget]').forEach(b => b.addEventListener('click', () => addWidget(b.dataset.widget)));
  canvas.addEventListener('mousedown', () => select(null));

  // handle messages
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg?.type) {
      case 'loaded':
        state.hmi = msg.hmi;
        render();
        break;
      case 'saved':
        // noop
        break;
      case 'ioList':
        state.io = { inputs: msg.inputs || [], outputs: msg.outputs || [] };
        if (state.selected.size) renderProps();
        break;
      case 'variableList':
        state.variables = msg.variables || [];
        if (state.selected.size) renderProps();
        break;
      default:
        break;
    }
  });

  // initial
  send('requestLoad');
  send('requestIoList');
  send('requestVariableList');

  // helpers: validation and UI bits
  function allowedTargetsFor(type) {
    switch (type) {
      case 'button':
      case 'switch':
        return ['input','variable'];
      case 'lamp':
      case 'motor':
      case 'cylinder':
      case 'fan':
      case 'pump':
      case 'valve':
        return ['output','variable'];
      case 'gauge':
      case 'tank':
        return ['output','variable'];
      case 'slider':
      case 'numeric':
        return ['variable'];
      default:
        return ['input','output','variable'];
    }
  }
  function defaultTargetFor(type) { return allowedTargetsFor(type)[0]; }
  function validateBinding(widget, b) {
    if (!b?.symbol) return '未バインド: symbol を指定してください';
    const allowed = allowedTargetsFor(widget.type);
    if (!allowed.includes(b.target)) return `不正なターゲット: ${b.target} は ${widget.type} では使用できません`;
    return '';
  }
  function wrap(nodes) {
    const span = document.createElement('span');
    nodes.forEach(n => span.appendChild(n));
    return span;
  }

  // group drag move & resizing
  function enableDrag(node, w) {
    let start = null;
    node.addEventListener('mousedown', (e) => {
      const ids = Array.from(state.selected.size ? state.selected : new Set([w.id]));
      start = {
        x: e.clientX,
        y: e.clientY,
        positions: ids.map(id => {
          const it = currentPage().widgets.find(x => x.id === id);
          return { id, x: it.x || 0, y: it.y || 0 };
        })
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      if (!start) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      for (const p of start.positions) {
        const it = currentPage().widgets.find(x => x.id === p.id);
        it.x = snap(p.x + dx); it.y = snap(p.y + dy);
        const dom = canvas.querySelector(`[data-id="${it.id}"]`);
        if (dom) { dom.style.left = it.x + 'px'; dom.style.top = it.y + 'px'; }
      }
    }
    function onUp() {
      start = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      renderProps();
    }
  }

  function attachResize(node, w) {
    const h = document.createElement('div'); h.className = 'resize-handle'; node.appendChild(h);
    let start = null;
    h.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, width: w.width || 80, height: w.height || 32 };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      if (!start) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      w.width = Math.max(4, snap(start.width + dx));
      w.height = Math.max(4, snap(start.height + dy));
      node.style.width = w.width + 'px'; node.style.height = w.height + 'px';
    }
    function onUp() { start = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); renderProps(); }
  }
})();
