(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const defaultLabels = new Map([
    ['button', 'BUTTON'],
    ['switch', 'SWITCH'],
    ['lamp', 'LAMP'],
    ['motor', 'MOTOR'],
    ['fan', 'FAN'],
    ['pump', 'PUMP'],
    ['cylinder', 'CYL'],
    ['valve', 'VALVE'],
    ['gauge', 'GAUGE'],
    ['tank', 'TANK'],
    ['numeric', 'VALUE'],
    ['slider', 'SLIDER'],
    ['text', 'TEXT']
  ]);

  function decorate(widget, node, ctx = {}) {
    if (!widget || !node) { return false; }
    node.innerHTML = '';
    node.classList.remove('is-on', 'is-alert', 'is-flow');

    const mode = ctx.mode || 'runtime';
    const label = ctx.label !== undefined ? ctx.label : (widget.label || defaultLabel(widget.type));
    const isOn = Boolean(ctx.on ?? widget.previewOn ?? false);
    const value = ctx.value ?? widget.previewValue ?? 0;
    const style = widget.style || {};

    switch (widget.type) {
      case 'lamp':
        return renderLamp(node, { label, isOn, style });
      case 'motor':
        return renderMotor(node, { label, isOn, style });
      case 'fan':
        return renderFan(node, { label, isOn, style });
      case 'pump':
        return renderPump(node, { label, isOn, style });
      case 'cylinder':
        return renderCylinder(node, { label, isOn, style });
      case 'valve':
        return renderValve(node, { label, isOn, style, orientation: widget.orientation || 'horizontal' });
      case 'button':
        return renderButton(node, { label, isOn, variant: widget.variant || 'momentary' });
      case 'switch':
        return renderSwitch(node, { label, isOn });
      case 'gauge':
        return renderGauge(node, {
          label,
          value,
          min: widget.min ?? 0,
          max: widget.max ?? 100,
          unit: widget.unit,
          precision: widget.precision ?? 0,
          style
        });
      case 'tank':
        return renderTank(node, {
          label,
          value,
          min: widget.min ?? 0,
          max: widget.max ?? 100,
          unit: widget.unit,
          style
        });
      case 'numeric':
        return renderNumeric(node, {
          label,
          value,
          precision: widget.precision ?? 0,
          unit: widget.unit
        });
      case 'slider':
        return renderSlider(node, {
          value,
          min: widget.min ?? 0,
          max: widget.max ?? 100
        });
      case 'text':
        return renderText(node, { text: widget.text || label });
      default:
        return false;
    }
  }

  function defaultLabel(type) {
    if (defaultLabels.has(type)) { return defaultLabels.get(type); }
    if (!type) { return ''; }
    return type.toUpperCase();
  }

  function clamp(v, min, max) {
    if (Number.isNaN(v)) { return min; }
    return Math.max(min, Math.min(max, v));
  }

  function uniqueId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function labelElement(text) {
    if (!text) { return null; }
    const el = document.createElement('div');
    el.className = 'widget-label';
    el.textContent = text;
    return el;
  }

  function renderLamp(node, { label, isOn, style }) {
    node.classList.toggle('is-on', isOn);
    if (style.onColor) { node.style.setProperty('--lamp-on', style.onColor); }
    if (style.offColor) { node.style.setProperty('--lamp-off', style.offColor); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-lamp');
    const defs = document.createElementNS(SVG_NS, 'defs');
    const glowId = uniqueId('lampGlow');
    const radial = document.createElementNS(SVG_NS, 'radialGradient');
    radial.setAttribute('id', glowId);
    const stop1 = document.createElementNS(SVG_NS, 'stop'); stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', 'white'); stop1.setAttribute('stop-opacity', '0.95');
    const stop2 = document.createElementNS(SVG_NS, 'stop'); stop2.setAttribute('offset', '60%'); stop2.setAttribute('stop-color', 'white'); stop2.setAttribute('stop-opacity', '0.2');
    const stop3 = document.createElementNS(SVG_NS, 'stop'); stop3.setAttribute('offset', '100%'); stop3.setAttribute('stop-color', 'black'); stop3.setAttribute('stop-opacity', '0');
    radial.appendChild(stop1); radial.appendChild(stop2); radial.appendChild(stop3);
    defs.appendChild(radial); svg.appendChild(defs);
    const glow = document.createElementNS(SVG_NS, 'circle'); glow.setAttribute('cx', '50'); glow.setAttribute('cy', '50'); glow.setAttribute('r', '40'); glow.setAttribute('class', 'lamp-glow'); glow.setAttribute('fill', `url(#${glowId})`);
    const rim = document.createElementNS(SVG_NS, 'circle'); rim.setAttribute('cx', '50'); rim.setAttribute('cy', '50'); rim.setAttribute('r', '30'); rim.setAttribute('class', 'lamp-rim'); rim.setAttribute('fill', 'none');
    const core = document.createElementNS(SVG_NS, 'circle'); core.setAttribute('cx', '50'); core.setAttribute('cy', '50'); core.setAttribute('r', '26'); core.setAttribute('class', 'lamp-core');
    svg.appendChild(glow); svg.appendChild(rim); svg.appendChild(core);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderMotor(node, { label, isOn, style }) {
    node.classList.toggle('is-on', isOn);
    if (style.color) { node.style.setProperty('--motor-color', style.color); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-motor');
    const body = document.createElementNS(SVG_NS, 'rect'); body.setAttribute('x', '18'); body.setAttribute('y', '30'); body.setAttribute('width', '50'); body.setAttribute('height', '40'); body.setAttribute('rx', '6'); body.setAttribute('class', 'motor-body');
    const shaft = document.createElementNS(SVG_NS, 'rect'); shaft.setAttribute('x', '68'); shaft.setAttribute('y', '46'); shaft.setAttribute('width', '12'); shaft.setAttribute('height', '8'); shaft.setAttribute('rx', '2'); shaft.setAttribute('class', 'motor-shaft');
    const hub = document.createElementNS(SVG_NS, 'circle'); hub.setAttribute('cx', '80'); hub.setAttribute('cy', '50'); hub.setAttribute('r', '6'); hub.setAttribute('class', 'motor-hub');
    const blades = document.createElementNS(SVG_NS, 'g'); blades.setAttribute('class', 'motor-blades');
    for (let i = 0; i < 3; i += 1) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', 'M80 50 L94 46 Q98 50 94 54 Z');
      p.setAttribute('transform', `rotate(${i * 120} 80 50)`);
      p.setAttribute('class', 'motor-blade');
      blades.appendChild(p);
    }
    svg.appendChild(body); svg.appendChild(shaft); svg.appendChild(hub); svg.appendChild(blades);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderFan(node, { label, isOn, style }) {
    node.classList.toggle('is-on', isOn);
    if (style.color) { node.style.setProperty('--fan-color', style.color); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-fan');
    const body = document.createElementNS(SVG_NS, 'circle'); body.setAttribute('cx', '50'); body.setAttribute('cy', '50'); body.setAttribute('r', '44'); body.setAttribute('class', 'fan-body');
    const guard = document.createElementNS(SVG_NS, 'circle'); guard.setAttribute('cx', '50'); guard.setAttribute('cy', '50'); guard.setAttribute('r', '42'); guard.setAttribute('class', 'fan-guard');
    const hub = document.createElementNS(SVG_NS, 'circle'); hub.setAttribute('cx', '50'); hub.setAttribute('cy', '50'); hub.setAttribute('r', '8'); hub.setAttribute('class', 'fan-hub');
    const blades = document.createElementNS(SVG_NS, 'g'); blades.setAttribute('class', 'fan-blades');
    for (let i = 0; i < 4; i += 1) {
      const blade = document.createElementNS(SVG_NS, 'path');
      blade.setAttribute('d', 'M50 50 C80 40 80 60 50 70 Z');
      blade.setAttribute('transform', `rotate(${i * 90} 50 50)`);
      blade.setAttribute('class', 'fan-blade');
      blades.appendChild(blade);
    }
    svg.appendChild(body); svg.appendChild(guard); svg.appendChild(blades); svg.appendChild(hub);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderPump(node, { label, isOn, style }) {
    node.classList.toggle('is-on', isOn);
    node.classList.toggle('is-flow', isOn);
    if (style.color) { node.style.setProperty('--pump-color', style.color); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-pump');
    const body = document.createElementNS(SVG_NS, 'circle'); body.setAttribute('cx', '50'); body.setAttribute('cy', '50'); body.setAttribute('r', '30'); body.setAttribute('class', 'pump-body');
    const impeller = document.createElementNS(SVG_NS, 'g'); impeller.setAttribute('class', 'pump-impeller');
    for (let i = 0; i < 5; i += 1) {
      const blade = document.createElementNS(SVG_NS, 'path');
      blade.setAttribute('d', 'M50 50 L70 46 Q74 50 70 54 Z');
      blade.setAttribute('transform', `rotate(${i * 72} 50 50)`);
      impeller.appendChild(blade);
    }
    const arrow = document.createElementNS(SVG_NS, 'path');
    arrow.setAttribute('d', 'M18 50 C30 30 70 30 82 50 C70 70 30 70 18 50');
    arrow.setAttribute('class', 'pump-arrow');
    svg.appendChild(body); svg.appendChild(impeller); svg.appendChild(arrow);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderCylinder(node, { label, isOn, style }) {
    node.classList.toggle('is-on', isOn);
    if (style.color) { node.style.setProperty('--cyl-color', style.color); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-cylinder');
    const rail = document.createElementNS(SVG_NS, 'rect'); rail.setAttribute('x', '10'); rail.setAttribute('y', '44'); rail.setAttribute('width', '80'); rail.setAttribute('height', '12'); rail.setAttribute('rx', '6'); rail.setAttribute('class', 'cyl-rail');
    const rod = document.createElementNS(SVG_NS, 'rect'); rod.setAttribute('x', '14'); rod.setAttribute('y', '47'); rod.setAttribute('width', '28'); rod.setAttribute('height', '6'); rod.setAttribute('rx', '3'); rod.setAttribute('class', 'cyl-rod');
    const head = document.createElementNS(SVG_NS, 'circle'); head.setAttribute('cx', '22'); head.setAttribute('cy', '50'); head.setAttribute('r', '10'); head.setAttribute('class', 'cyl-head');
    svg.appendChild(rail); svg.appendChild(rod); svg.appendChild(head);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderValve(node, { label, isOn, style, orientation }) {
    node.classList.toggle('is-on', isOn);
    if (style && style.color) { node.style.setProperty('--valve-color', style.color); }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'svg-valve');
    const body = document.createElementNS(SVG_NS, 'rect'); body.setAttribute('x', '20'); body.setAttribute('y', '40'); body.setAttribute('width', '60'); body.setAttribute('height', '20'); body.setAttribute('rx', '8'); body.setAttribute('class', 'valve-body');
    const gate = document.createElementNS(SVG_NS, 'polygon'); gate.setAttribute('points', '50,20 68,50 50,80 32,50'); gate.setAttribute('class', 'valve-gate');
    if (orientation === 'vertical') {
      body.setAttribute('transform', 'rotate(90 50 50)');
      gate.setAttribute('transform', 'rotate(90 50 50)');
    }
    const flow = document.createElementNS(SVG_NS, 'path'); flow.setAttribute('d', 'M15 50 L85 50'); flow.setAttribute('class', 'valve-flow');
    svg.appendChild(flow); svg.appendChild(body); svg.appendChild(gate);
    node.appendChild(svg);
    const lbl = labelElement(label);
    if (lbl) { node.appendChild(lbl); }
    return true;
  }

  function renderButton(node, { label, isOn, variant }) {
    node.classList.toggle('is-on', Boolean(isOn));
    const skin = document.createElement('div');
    skin.className = 'btn-skin';
    const lbl = document.createElement('span');
    lbl.className = 'btn-label';
    lbl.textContent = label || (variant === 'toggle' ? 'TOGGLE' : 'PUSH');
    skin.appendChild(lbl);
    node.appendChild(skin);
    return true;
  }

  function renderSwitch(node, { label, isOn }) {
    node.classList.toggle('is-on', Boolean(isOn));
    const root = document.createElement('div'); root.className = 'switch-skin';
    const track = document.createElement('div'); track.className = 'sw-track';
    const knob = document.createElement('div'); knob.className = 'sw-knob';
    track.appendChild(knob);
    const lbl = document.createElement('div'); lbl.className = 'sw-label'; lbl.textContent = label || 'SWITCH';
    root.appendChild(track); root.appendChild(lbl);
    node.appendChild(root);
    return true;
  }

  function renderGauge(node, { label, value, min, max, unit, precision, style }) {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max !== safeMin ? max : safeMin + 100;
    const clamped = clamp(value, safeMin, safeMax);
    const sweep = 270;
    const startAngle = -135;
    const t = (clamped - safeMin) / (safeMax - safeMin);
    const angle = startAngle + sweep * t;
    if (style.arcColor) { node.style.setProperty('--gauge-arc', style.arcColor); }
    if (style.activeColor) { node.style.setProperty('--gauge-active', style.activeColor); }
    if (style.needleColor) { node.style.setProperty('--gauge-needle', style.needleColor); }

    const wrap = document.createElement('div'); wrap.className = 'gauge-skin';
    const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'gauge-svg');

    const bgArc = document.createElementNS(SVG_NS, 'path'); bgArc.setAttribute('d', describeArc(50, 60, 38, startAngle, startAngle + sweep)); bgArc.setAttribute('class', 'gauge-arc');
    const fgArc = document.createElementNS(SVG_NS, 'path'); fgArc.setAttribute('d', describeArc(50, 60, 38, startAngle, angle)); fgArc.setAttribute('class', 'gauge-arc gauge-arc-active');

    const ticks = document.createElementNS(SVG_NS, 'g');
    ticks.setAttribute('class', 'gauge-ticks');
    const steps = 6;
    for (let i = 0; i <= steps; i += 1) {
      const a = startAngle + (sweep / steps) * i;
      const inner = polarToCartesian(50, 60, 28, a);
      const outer = polarToCartesian(50, 60, 34, a);
      const tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', inner.x.toFixed(2));
      tick.setAttribute('y1', inner.y.toFixed(2));
      tick.setAttribute('x2', outer.x.toFixed(2));
      tick.setAttribute('y2', outer.y.toFixed(2));
      tick.setAttribute('class', 'gauge-tick');
      ticks.appendChild(tick);
    }

    const needle = document.createElementNS(SVG_NS, 'polygon');
    needle.setAttribute('points', '50,60 46,66 50,20 54,66');
    needle.setAttribute('class', 'gauge-needle');
    needle.style.transform = `rotate(${angle}deg)`;

    const cap = document.createElementNS(SVG_NS, 'circle'); cap.setAttribute('cx', '50'); cap.setAttribute('cy', '60'); cap.setAttribute('r', '6'); cap.setAttribute('class', 'gauge-cap');

    svg.appendChild(bgArc); svg.appendChild(fgArc); svg.appendChild(ticks); svg.appendChild(needle); svg.appendChild(cap);
    wrap.appendChild(svg);

    const val = document.createElement('div'); val.className = 'gauge-value';
    const fmt = precision > 0 ? clamped.toFixed(precision) : Math.round(clamped).toString();
    val.textContent = unit ? `${fmt} ${unit}` : fmt;
    wrap.appendChild(val);

    if (label) {
      const lbl = labelElement(label);
      if (lbl) { wrap.appendChild(lbl); }
    }

    node.appendChild(wrap);
    return true;
  }

  function renderTank(node, { label, value, min, max, unit, style }) {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max !== safeMin ? max : safeMin + 100;
    const clamped = clamp(value, safeMin, safeMax);
    const pct = (clamped - safeMin) / (safeMax - safeMin);
    if (style.fillColor) { node.style.setProperty('--tank-fill', style.fillColor); }

    const wrap = document.createElement('div'); wrap.className = 'tank-skin';
    const body = document.createElement('div'); body.className = 'tank-body';
    const fill = document.createElement('div'); fill.className = 'tank-fill'; fill.style.height = `${Math.round(pct * 100)}%`;
    const lines = document.createElement('div'); lines.className = 'tank-level-lines';
    body.appendChild(fill);
    body.appendChild(lines);
    wrap.appendChild(body);

    const valueLabel = document.createElement('div'); valueLabel.className = 'tank-value';
    const fmt = Math.round(clamped * 10) / 10;
    valueLabel.textContent = unit ? `${fmt} ${unit}` : `${fmt}`;
    wrap.appendChild(valueLabel);

    if (label) {
      const lbl = labelElement(label);
      if (lbl) { wrap.appendChild(lbl); }
    }

    node.appendChild(wrap);
    return true;
  }

  function renderNumeric(node, { label, value, precision, unit }) {
    const display = document.createElement('div'); display.className = 'numeric-display';
    const fmt = Number.isFinite(value) ? (precision > 0 ? Number(value).toFixed(precision) : Math.round(Number(value)).toString()) : '--';
    display.textContent = unit ? `${fmt} ${unit}` : fmt;
    node.appendChild(display);
    if (label) {
      const lbl = labelElement(label);
      if (lbl) { node.appendChild(lbl); }
    }
    return true;
  }

  function renderSlider(node, { value, min, max }) {
    const wrap = document.createElement('div'); wrap.className = 'slider-skin';
    const track = document.createElement('div'); track.className = 'slider-track';
    const thumb = document.createElement('div'); thumb.className = 'slider-thumb';
    wrap.appendChild(track);
    wrap.appendChild(thumb);
    const pct = (clamp(value, min, max) - min) / (max - min || 1);
    thumb.style.left = `${pct * 100}%`;
    node.appendChild(wrap);
    return true;
  }

  function renderText(node, { text }) {
    const div = document.createElement('div');
    div.className = 'w-text-inner';
    div.textContent = text;
    node.appendChild(div);
    return true;
  }

  function describeArc(x, y, radius, startAngle, endAngle) {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  }

  function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  }

  window.HmiSymbols = { decorate };
})();
