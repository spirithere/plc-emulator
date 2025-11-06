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

      applyVisual(node, w);

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
    if (w.type === 'text') {
      props.appendChild(row('Text', input(w.text || '', v => { w.text = v; rerenderSel(w.id); })));
    }
    if (w.type === 'button') {
      const variants = ['momentary','toggle'];
      props.appendChild(row('Variant', dropdown(variants, w.variant || 'momentary', v => { w.variant = v; })));
    }
    if (w.type === 'lamp' || w.type === 'motor' || w.type === 'cylinder' || w.type === 'button' || w.type === 'switch') {
      props.appendChild(row('Preview On', checkbox(!!w.previewOn, v => { w.previewOn = v; rerenderSel(w.id); })));
    }
    if (w.type === 'lamp') {
      const st = w.style || {};
      props.appendChild(row('On Color', color(st.onColor || '#16ff8a', v => { w.style = { ...(w.style||{}), onColor: v }; rerenderSel(w.id); })));
      props.appendChild(row('Off Color', color(st.offColor || '#2b2b2b', v => { w.style = { ...(w.style||{}), offColor: v }; rerenderSel(w.id); })));
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

  // === Symbol rendering (SVG) ===
  function applyVisual(node, w) {
    node.innerHTML = '';
    node.classList.toggle('is-on', !!w.previewOn);
    if (w.type === 'text') {
      const t = document.createElement('div');
      t.className = 'w-text-inner';
      t.textContent = w.text || w.label || 'Text';
      node.appendChild(t);
      return;
    }
    if (w.type === 'lamp') {
      const on = !!w.previewOn;
      const onColor = (w.style?.onColor) || '#16ff8a';
      const offColor = (w.style?.offColor) || '#1f2937';
      node.style.setProperty('--lamp-on', onColor);
      node.style.setProperty('--lamp-off', offColor);
      node.appendChild(svgLamp());
      if (w.label) node.appendChild(labelEl(w.label));
      if (on) node.classList.add('is-on'); else node.classList.remove('is-on');
      return;
    }
    if (w.type === 'button') {
      const wrap = document.createElement('div');
      wrap.className = 'btn-skin';
      const lab = document.createElement('span'); lab.className = 'btn-label'; lab.textContent = w.label || 'Button';
      wrap.appendChild(lab);
      if (w.previewOn || (w.variant === 'toggle' && w.previewOn)) node.classList.add('is-on'); else node.classList.remove('is-on');
      node.appendChild(wrap);
      return;
    }
    if (w.type === 'switch') {
      const s = buildSwitchSkin(w.label || 'Switch');
      if (w.previewOn) node.classList.add('is-on'); else node.classList.remove('is-on');
      node.appendChild(s);
      return;
    }
    if (w.type === 'motor') {
      const on = !!w.previewOn;
      const color = (w.style?.color) || '#42baf9';
      node.style.setProperty('--motor-color', color);
      node.appendChild(svgMotor());
      if (w.label) node.appendChild(labelEl(w.label));
      if (on) node.classList.add('is-on'); else node.classList.remove('is-on');
      return;
    }
    if (w.type === 'cylinder') {
      const on = !!w.previewOn; // extended
      const color = (w.style?.color) || '#a78bfa';
      node.style.setProperty('--cyl-color', color);
      node.appendChild(svgCylinder());
      if (w.label) node.appendChild(labelEl(w.label));
      if (on) node.classList.add('is-on'); else node.classList.remove('is-on');
      return;
    }
    // default box
    const box = document.createElement('div');
    box.className = 'w-generic';
    box.textContent = w.label || w.type;
    node.appendChild(box);
  }

  function labelEl(text) {
    const l = document.createElement('div');
    l.className = 'widget-label';
    l.textContent = text;
    return l;
  }

  function svgLamp() {
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wrap.setAttribute('viewBox', '0 0 100 100');
    wrap.setAttribute('class', 'svg-lamp');
    const defs = document.createElementNS(wrap.namespaceURI, 'defs');
    const rg = document.createElementNS(wrap.namespaceURI, 'radialGradient');
    rg.setAttribute('id', 'lg');
    let stop1 = document.createElementNS(wrap.namespaceURI, 'stop'); stop1.setAttribute('offset','0%'); stop1.setAttribute('stop-color','white'); stop1.setAttribute('stop-opacity','0.95');
    let stop2 = document.createElementNS(wrap.namespaceURI, 'stop'); stop2.setAttribute('offset','60%'); stop2.setAttribute('stop-color','white'); stop2.setAttribute('stop-opacity','0.2');
    let stop3 = document.createElementNS(wrap.namespaceURI, 'stop'); stop3.setAttribute('offset','100%'); stop3.setAttribute('stop-color','black'); stop3.setAttribute('stop-opacity','0');
    rg.appendChild(stop1); rg.appendChild(stop2); rg.appendChild(stop3);
    defs.appendChild(rg); wrap.appendChild(defs);
    const glow = document.createElementNS(wrap.namespaceURI, 'circle'); glow.setAttribute('cx','50'); glow.setAttribute('cy','50'); glow.setAttribute('r','40'); glow.setAttribute('class','lamp-glow'); glow.setAttribute('fill','url(#lg)');
    const core = document.createElementNS(wrap.namespaceURI, 'circle'); core.setAttribute('cx','50'); core.setAttribute('cy','50'); core.setAttribute('r','26'); core.setAttribute('class','lamp-core');
    const rim = document.createElementNS(wrap.namespaceURI, 'circle'); rim.setAttribute('cx','50'); rim.setAttribute('cy','50'); rim.setAttribute('r','30'); rim.setAttribute('class','lamp-rim'); rim.setAttribute('fill','none');
    wrap.appendChild(glow); wrap.appendChild(rim); wrap.appendChild(core);
    return wrap;
  }

  function svgMotor() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-motor');
    const body = document.createElementNS(ns, 'rect'); body.setAttribute('x','18'); body.setAttribute('y','30'); body.setAttribute('width','50'); body.setAttribute('height','40'); body.setAttribute('rx','6'); body.setAttribute('class','motor-body');
    const shaft = document.createElementNS(ns, 'rect'); shaft.setAttribute('x','68'); shaft.setAttribute('y','46'); shaft.setAttribute('width','12'); shaft.setAttribute('height','8'); shaft.setAttribute('rx','2'); shaft.setAttribute('class','motor-shaft');
    const hub = document.createElementNS(ns, 'circle'); hub.setAttribute('cx','80'); hub.setAttribute('cy','50'); hub.setAttribute('r','6'); hub.setAttribute('class','motor-hub');
    const blades = document.createElementNS(ns, 'g'); blades.setAttribute('class','motor-blades');
    for (let i=0;i<3;i++) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d','M80 50 L94 46 Q98 50 94 54 Z');
      p.setAttribute('transform', `rotate(${i*120} 80 50)`);
      p.setAttribute('class','motor-blade');
      blades.appendChild(p);
    }
    svg.appendChild(body); svg.appendChild(shaft); svg.appendChild(hub); svg.appendChild(blades);
    return svg;
  }

  function svgCylinder() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('class','svg-cylinder');
    const rail = document.createElementNS(ns, 'rect'); rail.setAttribute('x','10'); rail.setAttribute('y','44'); rail.setAttribute('width','80'); rail.setAttribute('height','12'); rail.setAttribute('rx','6'); rail.setAttribute('class','cyl-rail');
    const rod = document.createElementNS(ns, 'rect'); rod.setAttribute('x','14'); rod.setAttribute('y','47'); rod.setAttribute('width','28'); rod.setAttribute('height','6'); rod.setAttribute('rx','3'); rod.setAttribute('class','cyl-rod');
    const head = document.createElementNS(ns, 'circle'); head.setAttribute('cx','22'); head.setAttribute('cy','50'); head.setAttribute('r','10'); head.setAttribute('class','cyl-head');
    svg.appendChild(rail); svg.appendChild(rod); svg.appendChild(head);
    return svg;
  }

  function buildSwitchSkin(text) {
    const root = document.createElement('div'); root.className = 'switch-skin';
    const track = document.createElement('div'); track.className = 'sw-track';
    const knob = document.createElement('div'); knob.className = 'sw-knob';
    const lbl = document.createElement('div'); lbl.className = 'sw-label'; lbl.textContent = text || '';
    track.appendChild(knob); root.appendChild(track); root.appendChild(lbl); return root;
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
    const w = { id: uid(type), type, x: 20, y: 20, width: 100, height: 36, label: type };
    if (type === 'lamp') { w.width = 24; w.height = 24; }
    if (type === 'text') { w.width = 120; w.height = 20; w.text = 'Text'; }
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
