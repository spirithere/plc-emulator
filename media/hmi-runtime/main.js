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
        const skin = document.createElement('div'); skin.className = 'btn-skin';
        const label = document.createElement('span'); label.className = 'btn-label'; label.textContent = w.label || 'Button';
        skin.appendChild(label); node.appendChild(skin);
        const isToggle = (w.variant || 'momentary') === 'toggle';
        const setPressed = (p) => { if (p) node.classList.add('is-pressed'); else node.classList.remove('is-pressed'); };
        const ripple = (e) => {
          const r = document.createElement('span'); r.className = 'btn-ripple';
          const rect = node.getBoundingClientRect();
          const x = (e.clientX - rect.left); const y = (e.clientY - rect.top);
          r.style.left = x + 'px'; r.style.top = y + 'px'; node.appendChild(r);
          setTimeout(() => r.remove(), 450);
        };
        node.addEventListener('mousedown', (e) => { setPressed(true); if (!isToggle) write(w, true); });
        node.addEventListener('mouseup', () => { setPressed(false); if (!isToggle) write(w, false); });
        node.addEventListener('mouseleave', () => { setPressed(false); if (!isToggle) write(w, false); });
        node.addEventListener('click', (e) => { ripple(e); if (isToggle) toggle(w); });
        // show toggled state if bound value is true
        if (isToggle && readBoolean(w)) node.classList.add('is-on'); else node.classList.remove('is-on');
      } else if (w.type === 'switch') {
        const skin = buildSwitchSkin(w.label || 'Switch'); node.appendChild(skin);
        if (readBoolean(w)) node.classList.add('is-on'); else node.classList.remove('is-on');
        node.addEventListener('click', () => toggle(w));
      } else if (w.type === 'lamp') {
        const lit = readBoolean(w);
        node.style.setProperty('--lamp-on', (w.style?.onColor || '#16ff8a'));
        node.style.setProperty('--lamp-off', (w.style?.offColor || '#1f2937'));
        if (lit) node.classList.add('is-on'); else node.classList.remove('is-on');
        node.appendChild(svgLamp());
        if (w.label) node.appendChild(labelEl(w.label));
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
        node.style.setProperty('--motor-color', (w.style?.color || '#42baf9'));
        if (on) node.classList.add('is-on'); else node.classList.remove('is-on');
        node.appendChild(svgMotor());
        if (w.label) node.appendChild(labelEl(w.label));
      } else if (w.type === 'cylinder') {
        const ext = readBoolean(w);
        node.style.setProperty('--cyl-color', (w.style?.color || '#a78bfa'));
        if (ext) node.classList.add('is-on'); else node.classList.remove('is-on');
        node.appendChild(svgCylinder());
        if (w.label) node.appendChild(labelEl(w.label));
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
  
  // SVG symbol helpers (duplicated minimal from designer)
  function labelEl(text) {
    const l = document.createElement('div'); l.className = 'widget-label'; l.textContent = text; return l;
  }
  function svgLamp() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('class','svg-lamp');
    const defs = document.createElementNS(ns, 'defs');
    const rg = document.createElementNS(ns, 'radialGradient'); rg.setAttribute('id','lg');
    let s1 = document.createElementNS(ns, 'stop'); s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','white'); s1.setAttribute('stop-opacity','0.95');
    let s2 = document.createElementNS(ns, 'stop'); s2.setAttribute('offset','60%'); s2.setAttribute('stop-color','white'); s2.setAttribute('stop-opacity','0.2');
    let s3 = document.createElementNS(ns, 'stop'); s3.setAttribute('offset','100%'); s3.setAttribute('stop-color','black'); s3.setAttribute('stop-opacity','0');
    rg.appendChild(s1); rg.appendChild(s2); rg.appendChild(s3); defs.appendChild(rg); svg.appendChild(defs);
    const glow = document.createElementNS(ns, 'circle'); glow.setAttribute('cx','50'); glow.setAttribute('cy','50'); glow.setAttribute('r','40'); glow.setAttribute('class','lamp-glow'); glow.setAttribute('fill','url(#lg)');
    const core = document.createElementNS(ns, 'circle'); core.setAttribute('cx','50'); core.setAttribute('cy','50'); core.setAttribute('r','26'); core.setAttribute('class','lamp-core');
    const rim = document.createElementNS(ns, 'circle'); rim.setAttribute('cx','50'); rim.setAttribute('cy','50'); rim.setAttribute('r','30'); rim.setAttribute('class','lamp-rim'); rim.setAttribute('fill','none');
    svg.appendChild(glow); svg.appendChild(rim); svg.appendChild(core);
    return svg;
  }
  function svgMotor() {
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('class','svg-motor');
    const body = document.createElementNS(ns, 'rect'); body.setAttribute('x','18'); body.setAttribute('y','30'); body.setAttribute('width','50'); body.setAttribute('height','40'); body.setAttribute('rx','6'); body.setAttribute('class','motor-body');
    const shaft = document.createElementNS(ns, 'rect'); shaft.setAttribute('x','68'); shaft.setAttribute('y','46'); shaft.setAttribute('width','12'); shaft.setAttribute('height','8'); shaft.setAttribute('rx','2'); shaft.setAttribute('class','motor-shaft');
    const hub = document.createElementNS(ns, 'circle'); hub.setAttribute('cx','80'); hub.setAttribute('cy','50'); hub.setAttribute('r','6'); hub.setAttribute('class','motor-hub');
    const blades = document.createElementNS(ns, 'g'); blades.setAttribute('class','motor-blades');
    for (let i=0;i<3;i++){ const p=document.createElementNS(ns,'path'); p.setAttribute('d','M80 50 L94 46 Q98 50 94 54 Z'); p.setAttribute('transform',`rotate(${i*120} 80 50)`); p.setAttribute('class','motor-blade'); blades.appendChild(p);}    
    svg.appendChild(body); svg.appendChild(shaft); svg.appendChild(hub); svg.appendChild(blades); return svg;
  }
  function svgCylinder(){
    const ns='http://www.w3.org/2000/svg'; const svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('class','svg-cylinder');
    const rail=document.createElementNS(ns,'rect'); rail.setAttribute('x','10'); rail.setAttribute('y','44'); rail.setAttribute('width','80'); rail.setAttribute('height','12'); rail.setAttribute('rx','6'); rail.setAttribute('class','cyl-rail');
    const rod=document.createElementNS(ns,'rect'); rod.setAttribute('x','14'); rod.setAttribute('y','47'); rod.setAttribute('width','28'); rod.setAttribute('height','6'); rod.setAttribute('rx','3'); rod.setAttribute('class','cyl-rod');
    const head=document.createElementNS(ns,'circle'); head.setAttribute('cx','22'); head.setAttribute('cy','50'); head.setAttribute('r','10'); head.setAttribute('class','cyl-head');
    svg.appendChild(rail); svg.appendChild(rod); svg.appendChild(head); return svg;
  }
  function buildSwitchSkin(text) {
    const root = document.createElement('div'); root.className = 'switch-skin';
    const track = document.createElement('div'); track.className = 'sw-track';
    const knob = document.createElement('div'); knob.className = 'sw-knob';
    const lbl = document.createElement('div'); lbl.className = 'sw-label'; lbl.textContent = text || '';
    track.appendChild(knob); root.appendChild(track); root.appendChild(lbl); return root;
  }
})();
