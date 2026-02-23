const vscode = acquireVsCodeApi();

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_COLUMN_WIDTH = 180;
const LEFT_MARGIN = 70;
const ROW_HEIGHT = 140;
const SYMBOL_PAD = 24;
const CARD_WIDTH = 190;
const CARD_HEIGHT = 96;
const CARD_HIDE_DELAY_MS = 150;
const STROKE_STYLES = {
  rail: { stroke: '#f8f8ff', width: 3 },
  wire: { stroke: '#d9deff', width: 2 },
  symbol: { stroke: '#65f2ff', width: 2, fill: 'none' }
};
const SYMBOL_LABEL_COLOR = '#e1e7ff';

let ladder = [];
let previewMode = 'edit'; // 'edit' | 'symbol'
let runtime = createRuntimeSnapshot();

window.addEventListener('message', event => {
  if (event.data?.type === 'model') {
    ladder = event.data.ladder || [];
    render();
  } else if (event.data?.type === 'runtime') {
    runtime = normalizeRuntimePayload(event.data.payload, runtime);
    // update in place to avoid scroll/hover thrash
    applyRuntimeHighlights();
  }
});

function render() {
  const container = document.getElementById('app');
  container.innerHTML = '';
  const viewportWidth = container.clientWidth || window.innerWidth || 1200;

  const toolbar = renderToolbar();
  container.appendChild(toolbar);
  container.appendChild(renderModeSwitch());

  if (!ladder.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No ladder rungs defined yet.';
    container.appendChild(empty);
    return;
  }

  if (previewMode === 'symbol') {
    container.appendChild(renderSymbolPreview(ladder, viewportWidth));
    return;
  }

  ladder.forEach((rung, index) => {
    rung.elements = rung.elements || [];
    rung.branches = rung.branches || [];
    normalizeBranches(rung);

    const rungCard = document.createElement('div');
    rungCard.className = 'rung';

    rungCard.appendChild(renderRungHeader(rung, index));
    rungCard.appendChild(renderLadderGrid(rung, viewportWidth));
    rungCard.appendChild(renderBranchesSection(rung));
    rungCard.appendChild(renderElementToolbar(rung));

    container.appendChild(rungCard);
  });
}

function renderToolbar() {
  const header = document.createElement('div');
  header.className = 'toolbar';

  const addButton = document.createElement('button');
  addButton.textContent = '+ Rung';
  addButton.onclick = () => {
    ladder.push({ id: `rung_${Date.now()}`, elements: [] });
    render();
  };

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  saveButton.onclick = () => {
    vscode.postMessage({ type: 'ladderChanged', rungs: ladder });
  };

  header.appendChild(addButton);
  header.appendChild(saveButton);
  return header;
}

function renderModeSwitch() {
  const wrapper = document.createElement('div');
  wrapper.className = 'mode-switch';

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit View';
  editBtn.className = previewMode === 'edit' ? 'active' : '';
  editBtn.onclick = () => {
    previewMode = 'edit';
    render();
  };

  const previewBtn = document.createElement('button');
  previewBtn.textContent = 'Symbol Preview';
  previewBtn.className = previewMode === 'symbol' ? 'active' : '';
  previewBtn.onclick = () => {
    previewMode = 'symbol';
    render();
  };

  wrapper.appendChild(editBtn);
  wrapper.appendChild(previewBtn);
  return wrapper;
}

function renderSymbolPreview(rungs, viewportWidth = 0) {
  const preview = document.createElement('div');
  preview.className = 'symbol-preview';

  rungs.forEach(rung => {
    rung.elements = rung.elements || [];
    rung.branches = rung.branches || [];
    normalizeBranches(rung);
    const highlights = runtime && runtime.running ? computeRungHighlights(rung) : undefined;
    preview.appendChild(renderRungPreview(rung, viewportWidth, highlights));
  });

  return preview;
}

function renderRungPreview(rung, viewportWidth = 0, highlights) {
  const columns = getTotalColumns(rung);
  const resolvedViewport = Math.max((viewportWidth || 0) - LEFT_MARGIN * 2, 400);
  const columnWidth = resolvedViewport / Math.max(columns, 1);
  const leftRail = LEFT_MARGIN;
  const rightRail = leftRail + columnWidth * columns;
  const height = 100 + (rung.branches.length || 0) * 70;
  const width = rightRail + LEFT_MARGIN;
  const junctionX = index => leftRail + index * columnWidth;
  const rowY = rowIndex => 50 + rowIndex * 70;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.style.height = 'auto';
  svg.dataset.role = 'symbol-rung';
  svg.dataset.rung = rung.id || '';

  svg.appendChild(createSvgLine(leftRail, 20, leftRail, height - 20, 'rail'));
  svg.appendChild(createSvgLine(rightRail, 20, rightRail, height - 20, 'rail'));

  drawSeriesPreview(svg, rung.elements, rowY(0), 0, columns, junctionX, highlights?.main, rung.id, 0);

  (rung.branches || []).forEach((branch, branchIndex) => {
    const row = branchIndex + 1;
    const y = rowY(row);
    const connectorStart = createSvgLine(junctionX(branch.startColumn), rowY(0), junctionX(branch.startColumn), y, 'wire');
    connectorStart.dataset.role = 'branch-connector';
    connectorStart.dataset.rung = rung.id || '';
    connectorStart.dataset.row = String(row);
    connectorStart.dataset.side = 'start';
    const connectorEnd = createSvgLine(junctionX(branch.endColumn), rowY(0), junctionX(branch.endColumn), y, 'wire');
    connectorEnd.dataset.role = 'branch-connector';
    connectorEnd.dataset.rung = rung.id || '';
    connectorEnd.dataset.row = String(row);
    connectorEnd.dataset.side = 'end';
    if (highlights?.branches?.[branchIndex]?.connectors?.startActive) {
      connectorStart.classList.add('active');
    }
    if (highlights?.branches?.[branchIndex]?.connectors?.endActive) {
      connectorEnd.classList.add('active');
    }
    svg.appendChild(connectorStart);
    svg.appendChild(connectorEnd);
    drawSeriesPreview(
      svg,
      branch.elements || [],
      y,
      branch.startColumn,
      branch.endColumn,
      junctionX,
      highlights?.branches?.[branchIndex]?.series,
      rung.id,
      row
    );
  });

  return svg;
}

function renderRungHeader(rung, index) {
  const header = document.createElement('div');
  header.className = 'rung-header';

  const title = document.createElement('span');
  title.textContent = `Rung ${index + 1}`;

  const idInput = document.createElement('input');
  idInput.value = rung.id;
  idInput.placeholder = 'Rung identifier';
  idInput.oninput = event => {
    rung.id = event.target.value || `rung_${index}`;
  };

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.onclick = () => {
    ladder.splice(index, 1);
    render();
  };

  header.appendChild(title);
  header.appendChild(idInput);
  header.appendChild(deleteBtn);
  return header;
}

function renderLadderGrid(rung, viewportWidth = 0) {
  const columns = getTotalColumns(rung);
  const resolvedViewport = Math.max((viewportWidth || 0) - LEFT_MARGIN * 2, 400);
  const columnWidth = resolvedViewport / Math.max(columns, 1);
  const leftRail = LEFT_MARGIN;
  const rightRail = leftRail + columnWidth * columns;
  const height = ROW_HEIGHT * (rung.branches.length + 1) + 120;
  const width = rightRail + LEFT_MARGIN;

  const junctionX = index => leftRail + index * columnWidth;
  const rowY = rowIndex => 80 + rowIndex * ROW_HEIGHT;

  const canvas = document.createElement('div');
  canvas.className = 'ladder-grid';
  canvas.dataset.rung = rung.id || '';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  canvas.appendChild(svg);

  const layer = document.createElement('div');
  layer.className = 'element-layer';
  canvas.appendChild(layer);

  svg.appendChild(createSvgLine(leftRail, 40, leftRail, height - 40, 'rail'));
  svg.appendChild(createSvgLine(rightRail, 40, rightRail, height - 40, 'rail'));

  // compute runtime highlights if emulator is running
  const highlights = runtime && runtime.running ? computeRungHighlights(rung) : undefined;
  drawRow(svg, layer, rung, rung.elements, 0, 0, columns, rowY, junctionX, highlights?.main, rung.id);

  rung.branches.forEach((branch, branchIndex) => {
    const row = branchIndex + 1;
    const brHl = highlights?.branches?.[branchIndex];
    drawBranchConnectors(svg, branch, rowY(0), rowY(row), junctionX, brHl?.connectors, rung.id, row);
    drawRow(
      svg,
      layer,
      branch,
      branch.elements || [],
      row,
      branch.startColumn,
      branch.endColumn,
      rowY,
      junctionX,
      brHl?.series,
      rung.id
    );
  });

  return canvas;
}

function drawRow(svg, layer, owner, elements, rowIndex, startColumn, endColumn, rowY, junctionX, seriesHighlights, rungId) {
  const y = rowY(rowIndex);
  svg.appendChild(createSvgLine(junctionX(startColumn), y, junctionX(endColumn), y, 'wire'));

  if (!elements.length) {
    return;
  }

  const columnWidth = Math.max(junctionX(startColumn + 1) - junctionX(startColumn), 1);
  const symbolPad = getSymbolPad(columnWidth);

  elements.forEach((element, elementIndex) => {
    const columnIndex = startColumn + elementIndex;
    const center = (junctionX(columnIndex) + junctionX(columnIndex + 1)) / 2;
    const left = center - symbolPad;
    const right = center + symbolPad;
    const ref = makeRef(rungId, rowIndex, elementIndex);
    const leftSeg = createSvgLine(junctionX(startColumn + elementIndex), y, left, y, 'wire');
    leftSeg.dataset.ref = ref;
    leftSeg.dataset.segment = 'left';
    const rightSeg = createSvgLine(right, y, junctionX(startColumn + elementIndex + 1), y, 'wire');
    rightSeg.dataset.ref = ref;
    rightSeg.dataset.segment = 'right';
    if (seriesHighlights?.leftActive?.[elementIndex]) {
      leftSeg.classList.add('active');
    }
    if (seriesHighlights?.rightActive?.[elementIndex]) {
      rightSeg.classList.add('active');
    }
    svg.appendChild(leftSeg);
    svg.appendChild(rightSeg);

    if (element?.type === 'coil') {
      const active = Boolean(seriesHighlights?.symbolActive?.[elementIndex]);
      drawCoilSymbol(svg, center, y, element, active, ref);
    } else if (element?.type === 'contact') {
      const active = Boolean(seriesHighlights?.symbolActive?.[elementIndex]);
      const closed = isContactClosed(element);
      drawContactSymbol(svg, center, y, element, active, ref, closed);
    } else {
      const active = Boolean(seriesHighlights?.symbolActive?.[elementIndex]);
      drawInstructionSymbol(svg, center, y, element, active, ref);
    }

    const card = createNodeCard(owner, elements, element, elementIndex);
    positionCard(card, center, y);
    const hoverTarget = createHoverTarget(center, y, columnWidth);
    bindCardHover(card, hoverTarget);
    layer.appendChild(hoverTarget);
    layer.appendChild(card);
  });
}

function drawBranchConnectors(svg, branch, baseY, branchY, junctionX, connectorHighlights, rungId, rowIndex) {
  const left = createSvgLine(junctionX(branch.startColumn), baseY, junctionX(branch.startColumn), branchY, 'wire');
  left.dataset.rung = rungId || '';
  left.dataset.row = String(rowIndex);
  left.dataset.role = 'branch-connector';
  left.dataset.side = 'start';
  const right = createSvgLine(junctionX(branch.endColumn), baseY, junctionX(branch.endColumn), branchY, 'wire');
  right.dataset.rung = rungId || '';
  right.dataset.row = String(rowIndex);
  right.dataset.role = 'branch-connector';
  right.dataset.side = 'end';
  if (connectorHighlights?.startActive) {
    left.classList.add('active');
  }
  if (connectorHighlights?.endActive) {
    right.classList.add('active');
  }
  svg.appendChild(left);
  svg.appendChild(right);
}

function renderBranchesSection(rung) {
  const section = document.createElement('div');
  section.className = 'branch-section';

  if (!(rung.branches && rung.branches.length)) {
    return section;
  }

  const totalColumns = getTotalColumns(rung);
  const options = getJunctionOptions(totalColumns);

  rung.branches.forEach((branch, index) => {
    const row = document.createElement('div');
    row.className = 'branch-config';

    const title = document.createElement('span');
    title.textContent = `Branch ${index + 1}`;
    row.appendChild(title);

    const startSelect = document.createElement('select');
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (Number(opt.value) === (branch.startColumn ?? 0)) {
        option.selected = true;
      }
      startSelect.appendChild(option);
    });
    startSelect.onchange = event => {
      branch.startColumn = Number.parseInt(event.target.value, 10);
      if ((branch.endColumn ?? branch.startColumn + 1) <= branch.startColumn) {
        branch.endColumn = branch.startColumn + 1;
      }
      render();
    };
    row.appendChild(startSelect);

    const endSelect = document.createElement('select');
    options.forEach(opt => {
      const numeric = Number.parseInt(opt.value, 10);
      if (numeric <= (branch.startColumn ?? 0)) {
        return;
      }
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (numeric === (branch.endColumn ?? branch.startColumn + 1)) {
        option.selected = true;
      }
      endSelect.appendChild(option);
    });
    endSelect.onchange = event => {
      branch.endColumn = Number.parseInt(event.target.value, 10);
      render();
    };
    row.appendChild(endSelect);

    const addNodeBtn = document.createElement('button');
    addNodeBtn.textContent = '+ Element';
    addNodeBtn.onclick = () => {
      branch.elements = branch.elements || [];
      branch.elements.push(createDefaultElement(branch.id));
      branch.endColumn = Math.max(branch.endColumn ?? branch.startColumn + 1, branch.startColumn + branch.elements.length);
      render();
    };
    row.appendChild(addNodeBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.onclick = () => {
      rung.branches.splice(index, 1);
      render();
    };
    row.appendChild(deleteBtn);

    section.appendChild(row);
  });

  return section;
}


function createNodeCard(owner, collection, element, elementIndex) {
  const card = document.createElement('div');
  card.className = `node-card ${element.type}`;
  const editable = element.type === 'contact' || element.type === 'coil';

  const label = document.createElement('input');
  label.type = 'text';
  label.value = element.label || '';
  label.placeholder = element.type === 'coil' ? 'Coil name' : element.type === 'contact' ? 'Contact name' : 'Instruction';
  if (editable) {
    label.oninput = event => {
      element.label = event.target.value;
    };
  } else {
    label.readOnly = true;
    card.classList.add('readonly');
  }
  card.appendChild(label);

  if (!editable) {
    const note = document.createElement('div');
    note.className = 'instruction-note';
    note.textContent = `Read-only ${element.instructionKind || 'instruction'} node`;
    card.appendChild(note);
    return card;
  }

  const controls = document.createElement('div');
  controls.className = 'element-controls';

  // Address selector (X/M/Y)
  const addrSelector = document.createElement('select');
  addrSelector.title = 'Address (X/M/Y)';
  const addrOptions = ['X','M','Y'];
  const currentAddr = element.addrType || inferAddrType(element.label) || 'X';
  addrOptions.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    if (currentAddr === v) opt.selected = true;
    addrSelector.appendChild(opt);
  });
  addrSelector.onchange = e => {
    element.addrType = e.target.value;
    // heuristic: if Y selected and symbol is contact, switch to coil for convenience
    if (element.addrType === 'Y' && element.type === 'contact') {
      element.type = 'coil';
    }
    render();
  };
  controls.appendChild(addrSelector);

  const typeSelector = document.createElement('select');
  typeSelector.title = 'Symbol (contact/coil)';
  ['contact', 'coil'].forEach(optionValue => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    if (element.type === optionValue) {
      option.selected = true;
    }
    typeSelector.appendChild(option);
  });
  typeSelector.onchange = event => {
    element.type = event.target.value;
    if (element.type !== 'contact') {
      delete element.variant;
    } else if (!element.variant) {
      element.variant = 'no';
    }
    render();
  };
  controls.appendChild(typeSelector);

  if (element.type === 'contact') {
    const variantSelector = document.createElement('select');
    [
      { value: 'no', label: 'NO' },
      { value: 'nc', label: 'NC' }
    ].forEach(optionData => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      if ((element.variant ?? 'no') === optionData.value) {
        option.selected = true;
      }
      variantSelector.appendChild(option);
    });
    variantSelector.onchange = event => {
      element.variant = event.target.value;
      render();
    };
    controls.appendChild(variantSelector);
  }

  const stateToggle = document.createElement('label');
  stateToggle.className = 'state-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(element.state);
  checkbox.onchange = event => {
    element.state = event.target.checked;
    render();
  };
  stateToggle.appendChild(checkbox);
  stateToggle.appendChild(document.createTextNode('Active'));
  controls.appendChild(stateToggle);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '×';
  deleteBtn.onclick = () => {
    collection.splice(elementIndex, 1);
    render();
  };
  controls.appendChild(deleteBtn);

  card.appendChild(controls);
  return card;
}

function positionCard(card, centerX, centerY) {
  card.style.left = `${centerX - CARD_WIDTH / 2}px`;
  card.style.top = `${centerY - CARD_HEIGHT / 2}px`;
}

function createHoverTarget(centerX, centerY, columnWidth) {
  const hover = document.createElement('div');
  hover.className = 'symbol-hover-target';
  const width = Math.max(columnWidth, 42);
  hover.style.width = `${width}px`;
  hover.style.height = '110px';
  hover.style.left = `${centerX - width / 2}px`;
  hover.style.top = `${centerY - 55}px`;
  return hover;
}

function bindCardHover(card, hoverTarget) {
  let hideTimer;
  const show = () => {
    window.clearTimeout(hideTimer);
    card.classList.add('visible');
  };
  const hide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      card.classList.remove('visible');
    }, CARD_HIDE_DELAY_MS);
  };

  hoverTarget.addEventListener('mouseenter', show);
  hoverTarget.addEventListener('mouseleave', hide);
  card.addEventListener('mouseenter', show);
  card.addEventListener('mouseleave', hide);
  card.addEventListener('focusin', show);
  card.addEventListener('focusout', event => {
    if (!card.contains(event.relatedTarget)) {
      hide();
    }
  });
}

function getSymbolPad(columnWidth) {
  const half = columnWidth / 2;
  return Math.max(2, Math.min(SYMBOL_PAD, half - 6));
}

function renderElementToolbar(rung) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rung-actions';

  const addElementBtn = document.createElement('button');
  addElementBtn.textContent = '+ Element';
  addElementBtn.onclick = () => {
    rung.elements.push(createDefaultElement(rung.id));
    render();
  };

  const addBranchBtn = document.createElement('button');
  addBranchBtn.textContent = '+ Parallel Branch';
  addBranchBtn.onclick = () => {
    rung.branches = rung.branches || [];
    rung.branches.push({
      id: `${rung.id}_branch_${Date.now()}`,
      elements: [],
      startColumn: 0,
      endColumn: Math.max(1, rung.elements.length)
    });
    render();
  };

  wrapper.appendChild(addElementBtn);
  wrapper.appendChild(addBranchBtn);
  return wrapper;
}

function drawSeriesPreview(svg, elements, y, startColumn, endColumn, junctionX, seriesHighlights, rungId, rowIndex = 0) {
  svg.appendChild(createSvgLine(junctionX(startColumn), y, junctionX(endColumn), y, 'wire'));
  if (!elements.length) {
    return;
  }

  const columnWidth = Math.max(junctionX(startColumn + 1) - junctionX(startColumn), 1);
  const symbolPad = getSymbolPad(columnWidth);

  elements.forEach((element, index) => {
    const columnIndex = startColumn + index;
    const center = (junctionX(columnIndex) + junctionX(columnIndex + 1)) / 2;
    const ref = rungId == null ? undefined : makeRef(rungId, rowIndex, index);
    const leftSeg = createSvgLine(junctionX(columnIndex), y, center - symbolPad, y, 'wire');
    if (ref) {
      leftSeg.dataset.ref = ref;
      leftSeg.dataset.segment = 'left';
    }
    if (seriesHighlights?.leftActive?.[index]) {
      leftSeg.classList.add('active');
    }
    svg.appendChild(leftSeg);

    const centerSeg = createSvgLine(center - symbolPad, y, center + symbolPad, y, 'wire');
    if (ref) {
      centerSeg.dataset.ref = ref;
      centerSeg.dataset.segment = 'symbol';
    }
    if (seriesHighlights?.symbolActive?.[index]) {
      centerSeg.classList.add('active');
    }
    svg.appendChild(centerSeg);

    const rightSeg = createSvgLine(center + symbolPad, y, junctionX(columnIndex + 1), y, 'wire');
    if (ref) {
      rightSeg.dataset.ref = ref;
      rightSeg.dataset.segment = 'right';
    }
    if (seriesHighlights?.rightActive?.[index]) {
      rightSeg.classList.add('active');
    }
    svg.appendChild(rightSeg);

    if (element?.type === 'coil') {
      const energized = Boolean(seriesHighlights?.symbolActive?.[index]);
      drawCoilSymbol(svg, center, y, element, energized, ref);
    } else if (element?.type === 'contact') {
      const conducting = Boolean(seriesHighlights?.symbolActive?.[index]);
      const closed = isContactClosed(element);
      drawContactSymbol(svg, center, y, element, conducting, ref, closed);
    } else {
      const conducting = Boolean(seriesHighlights?.symbolActive?.[index]);
      drawInstructionSymbol(svg, center, y, element, conducting, ref);
    }
  });
}

function drawContactSymbol(svg, x, y, element, active = false, ref, closedState) {
  const half = 13;
  const left = createSvgLine(x - half, y - 20, x - half, y + 20, 'symbol');
  left.classList.add('contact');
  if (ref != null) {
    left.dataset.ref = ref;
  }
  left.dataset.role = 'contact-vert';
  const right = createSvgLine(x + half, y - 20, x + half, y + 20, 'symbol');
  right.classList.add('contact');
  if (ref != null) {
    right.dataset.ref = ref;
  }
  right.dataset.role = 'contact-vert';
  if (active) {
    left.classList.add('active');
    right.classList.add('active');
  }
  applyContactState(left, closedState);
  applyContactState(right, closedState);
  svg.appendChild(left);
  svg.appendChild(right);
  if ((element?.variant ?? 'no') === 'nc') {
    const diag = createSvgLine(x - half, y - 20, x + half, y + 20, 'symbol');
    diag.classList.add('contact');
    if (ref != null) {
      diag.dataset.ref = ref;
    }
    diag.dataset.role = 'contact-diag';
    if (active) {
      diag.classList.add('active');
    }
    applyContactState(diag, closedState);
    svg.appendChild(diag);
  }
  // bridge line to show closed state distinctly
  const bridge = createSvgLine(x - half, y, x + half, y, 'symbol');
  bridge.classList.add('contact-bridge');
  if (ref != null) {
    bridge.dataset.ref = ref;
  }
  bridge.dataset.role = 'contact-bridge';
  applyContactState(bridge, closedState);
  svg.appendChild(bridge);
  drawLabel(svg, element, x, y + 28);
}

function applyContactState(node, closedState) {
  if (!node || typeof closedState !== 'boolean') {
    return;
  }
  const isClosed = !!closedState;
  node.classList.toggle('closed', isClosed);
  node.classList.toggle('open', !isClosed);
}

function drawCoilSymbol(svg, x, y, element, active = false, ref) {
  const radius = 18;
  const leftPath = document.createElementNS(SVG_NS, 'path');
  leftPath.setAttribute('d', `M ${x - radius} ${y - 20} C ${x - radius / 2} ${y - 20}, ${x - radius / 2} ${y + 20}, ${x - radius} ${y + 20}`);
  leftPath.setAttribute('class', 'symbol coil');
  if (ref != null) {
    leftPath.dataset.ref = ref;
  }
  leftPath.dataset.role = 'coil';
  applyStrokeStyle(leftPath, 'symbol');

  const rightPath = document.createElementNS(SVG_NS, 'path');
  rightPath.setAttribute('d', `M ${x + radius} ${y - 20} C ${x + radius / 2} ${y - 20}, ${x + radius / 2} ${y + 20}, ${x + radius} ${y + 20}`);
  rightPath.setAttribute('class', 'symbol coil');
  if (ref != null) {
    rightPath.dataset.ref = ref;
  }
  rightPath.dataset.role = 'coil';
  applyStrokeStyle(rightPath, 'symbol');

   if (active) {
     leftPath.classList.add('energized');
     rightPath.classList.add('energized');
   }
  svg.appendChild(leftPath);
  svg.appendChild(rightPath);
  drawLabel(svg, element, x, y + 28);
}

function drawInstructionSymbol(svg, x, y, element, active = false, ref) {
  const width = 44;
  const height = 32;
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', `${x - width / 2}`);
  rect.setAttribute('y', `${y - height / 2}`);
  rect.setAttribute('width', `${width}`);
  rect.setAttribute('height', `${height}`);
  rect.setAttribute('rx', '4');
  rect.setAttribute('class', 'symbol instruction');
  if (ref != null) {
    rect.dataset.ref = ref;
  }
  rect.dataset.role = 'instruction';
  applyStrokeStyle(rect, 'symbol');
  if (active) {
    rect.classList.add('active');
  }
  svg.appendChild(rect);

  const kind = document.createElementNS(SVG_NS, 'text');
  kind.setAttribute('x', `${x}`);
  kind.setAttribute('y', `${y + 4}`);
  kind.setAttribute('text-anchor', 'middle');
  kind.setAttribute('class', 'symbol-label instruction-kind');
  kind.textContent = (element?.instructionKind || 'INS').toUpperCase().slice(0, 6);
  svg.appendChild(kind);

  drawLabel(svg, element, x, y + 30);
}

function drawLabel(svg, element, x, y) {
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', x);
  label.setAttribute('y', y);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('class', 'symbol-label');
  label.setAttribute('fill', SYMBOL_LABEL_COLOR);
  label.textContent = element?.label || element?.id;
  svg.appendChild(label);
}

function createSvgLine(x1, y1, x2, y2, className) {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('class', className);
  applyStrokeStyle(line, className);
  return line;
}

function applyStrokeStyle(node, styleKey) {
  const style = STROKE_STYLES[styleKey];
  if (!style) {
    return;
  }
  node.setAttribute('stroke', style.stroke);
  node.setAttribute('stroke-width', String(style.width));
  if (style.fill) {
    node.setAttribute('fill', style.fill);
  }
}

function normalizeBranches(rung) {
  rung.branches.forEach(branch => {
    branch.startColumn = Number.isFinite(branch.startColumn) ? branch.startColumn : 0;
    const minLength = Math.max(branch.elements?.length || 1, 1);
    branch.endColumn = Number.isFinite(branch.endColumn) ? branch.endColumn : branch.startColumn + minLength;
    if (branch.endColumn <= branch.startColumn) {
      branch.endColumn = branch.startColumn + minLength;
    }
  });
}

function getTotalColumns(rung) {
  const branchMax = Math.max(
    0,
    ...(rung.branches || []).map(branch => Math.max(branch.endColumn ?? (branch.startColumn ?? 0) + 1, branch.startColumn ?? 0))
  );
  return Math.max(rung.elements.length, branchMax, 1);
}

function getJunctionOptions(totalColumns) {
  const options = [];
  for (let i = 0; i <= totalColumns; i += 1) {
    if (i === 0) {
      options.push({ value: '0', label: 'Left rail' });
    } else if (i === totalColumns) {
      options.push({ value: String(i), label: 'Right rail' });
    } else {
      options.push({ value: String(i), label: `After column ${i}` });
    }
  }
  return options;
}

function createDefaultElement(scopeId) {
  return {
    id: `${scopeId}_el_${Date.now()}`,
    label: 'Element',
    type: 'contact',
    variant: 'no',
    state: false,
    addrType: 'X'
  };
}

function inferAddrType(label) {
  if (!label || typeof label !== 'string') return undefined;
  const c = label.trim().toUpperCase()[0];
  if (c === 'X' || c === 'M' || c === 'Y') return c;
  return undefined;
}

function createRuntimeSnapshot() {
  return {
    running: false,
    variables: {},
    io: {
      inputs: Object.create(null),
      outputs: Object.create(null)
    }
  };
}

function normalizeRuntimePayload(payload, previous = createRuntimeSnapshot()) {
  if (!payload) {
    return previous;
  }
  const snapshot = createRuntimeSnapshot();
  snapshot.running = Boolean(payload.running);
  snapshot.variables = payload.variables || previous.variables || {};
  if (payload.io) {
    snapshot.io.inputs = channelsToLookup(payload.io.inputs);
    snapshot.io.outputs = channelsToLookup(payload.io.outputs);
  } else {
    snapshot.io.inputs = previous.io?.inputs || Object.create(null);
    snapshot.io.outputs = previous.io?.outputs || Object.create(null);
  }
  return snapshot;
}

function channelsToLookup(channels) {
  const table = Object.create(null);
  if (!Array.isArray(channels)) {
    return table;
  }
  channels.forEach(channel => {
    const value = Boolean(channel?.value);
    gatherChannelKeys(channel).forEach(key => {
      if (key) {
        table[key] = value;
      }
    });
  });
  return table;
}

function gatherChannelKeys(channel) {
  const keys = new Set();
  const id = normalizeChannelKey(channel?.id);
  if (id) {
    keys.add(id);
    keys.add(id.toUpperCase());
  }
  const label = normalizeChannelKey(channel?.label);
  if (label) {
    keys.add(label);
    keys.add(label.toUpperCase());
  }
  return Array.from(keys);
}

function normalizeChannelKey(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const key = String(value).trim();
  return key || undefined;
}

render();

// -------- Runtime Highlight Computation --------

function computeRungHighlights(rung) {
  const cols = rung.elements.length;
  const startPower = Array(cols + 1).fill(false);
  startPower[0] = true;

  // group branches by start column, keeping original order
  const byStart = new Map();
  (rung.branches || []).forEach((br, idx) => {
    const list = byStart.get(br.startColumn) || [];
    list.push({ br, idx });
    byStart.set(br.startColumn, list);
  });

  const mainLeft = Array(cols).fill(false);
  const mainRight = Array(cols).fill(false);
  const mainSymbol = Array(cols).fill(false);

  const branchInfo = (rung.branches || []).map(() => ({
    series: undefined,
    connectors: { startActive: false, endActive: false }
  }));

  for (let i = 0; i < cols; i += 1) {
    const incoming = !!startPower[i];

    const starters = byStart.get(i) || [];
    for (const { br, idx } of starters) {
      const detail = executeSeriesDetailed(br.elements || [], incoming);
      branchInfo[idx].series = detail;
      branchInfo[idx].connectors = { startActive: incoming, endActive: detail.finalPower };
      const endIdx = Math.min(Math.max(br.endColumn ?? i + 1, i + 1), cols);
      startPower[endIdx] = startPower[endIdx] || detail.finalPower;
    }

    // step the main element
    const el = rung.elements[i];
    const detail = executeSeriesDetailed([el], incoming);
    mainLeft[i] = detail.leftActive[0];
    mainRight[i] = detail.rightActive[0];
    mainSymbol[i] = detail.symbolActive[0];
    startPower[i + 1] = startPower[i + 1] || detail.finalPower;
  }

  return {
    main: { leftActive: mainLeft, rightActive: mainRight, symbolActive: mainSymbol },
    branches: branchInfo
  };
}

function executeSeriesDetailed(elements, initialPower) {
  const N = elements.length;
  const leftActive = Array(N).fill(false);
  const rightActive = Array(N).fill(false);
  const symbolActive = Array(N).fill(false);

  let power = !!initialPower;
  for (let i = 0; i < N; i += 1) {
    const el = elements[i];
    leftActive[i] = power;
    if (el?.type === 'contact') {
      const closed = isContactClosed(el);
      const next = power && closed;
      symbolActive[i] = next; // center segment carries power only if closed
      rightActive[i] = next;
      power = next;
    } else if (el?.type === 'coil') {
      symbolActive[i] = power; // energized
      rightActive[i] = power; // pass-through
      // power unchanged past a coil
    } else {
      // Instruction/unknown elements are treated as pass-through in preview.
      symbolActive[i] = power;
      rightActive[i] = power;
    }
  }

  return { leftActive, rightActive, symbolActive, finalPower: power };
}

function isContactClosed(element) {
  const raw = resolveSignal(element?.label, element?.state ?? true);
  const variant = element?.variant ?? 'no';
  return variant === 'nc' ? !raw : !!raw;
}

function resolveSignal(label, fallback) {
  const ioValue = lookupIoValue(label);
  if (typeof ioValue === 'boolean') {
    return ioValue;
  }
  if (label && Object.prototype.hasOwnProperty.call(runtime.variables || {}, label)) {
    const v = runtime.variables[label];
    return typeof v === 'number' ? v !== 0 : !!v;
  }
  return !!fallback;
}

function lookupIoValue(label) {
  if (!label) {
    return undefined;
  }
  const key = String(label).trim();
  if (!key) {
    return undefined;
  }
  const candidates = runtime.io || {};
  const inputs = candidates.inputs || {};
  const outputs = candidates.outputs || {};
  if (Object.prototype.hasOwnProperty.call(inputs, key)) {
    return inputs[key];
  }
  if (Object.prototype.hasOwnProperty.call(outputs, key)) {
    return outputs[key];
  }
  const upper = key.toUpperCase();
  if (upper !== key) {
    if (Object.prototype.hasOwnProperty.call(inputs, upper)) {
      return inputs[upper];
    }
    if (Object.prototype.hasOwnProperty.call(outputs, upper)) {
      return outputs[upper];
    }
  }
  return undefined;
}

// Toggle only classes based on runtime to avoid full re-render
function applyRuntimeHighlights() {
  if (!ladder || !ladder.length) {
    return;
  }
  const container = document.getElementById('app');
  if (!container) {
    return;
  }

  if (previewMode === 'symbol') {
    const previewRoot = container.querySelector('.symbol-preview');
    if (!previewRoot) {
      return;
    }
    ladder.forEach(rung => {
      const svg = previewRoot.querySelector(`svg[data-role="symbol-rung"][data-rung="${esc(rung.id)}"]`);
      applyHighlightsToRung(svg, rung);
    });
    return;
  }

  if (previewMode !== 'edit') {
    return;
  }

  ladder.forEach(rung => {
    const canvas = container.querySelector(`.ladder-grid[data-rung="${esc(rung.id)}"]`);
    applyHighlightsToRung(canvas, rung);
  });
}

function applyHighlightsToRung(root, rung) {
  if (!root) {
    return;
  }
  const highlights = runtime && runtime.running ? computeRungHighlights(rung) : undefined;
  updateSeriesHighlights(root, rung, 0, rung.elements, highlights?.main);
  (rung.branches || []).forEach((br, bIndex) => {
    const row = bIndex + 1;
    const brHl = highlights?.branches?.[bIndex];
    updateSeriesHighlights(root, rung, row, br.elements || [], brHl?.series);
    const startConn = root.querySelector(
      `[data-role="branch-connector"][data-rung="${esc(rung.id)}"][data-row="${row}"][data-side="start"]`
    );
    const endConn = root.querySelector(
      `[data-role="branch-connector"][data-rung="${esc(rung.id)}"][data-row="${row}"][data-side="end"]`
    );
    toggleActive(startConn, !!brHl?.connectors?.startActive);
    toggleActive(endConn, !!brHl?.connectors?.endActive);
  });
}

function updateSeriesHighlights(canvas, rung, rowIndex, elements, seriesHighlights) {
  for (let i = 0; i < elements.length; i += 1) {
    const ref = makeRef(rung.id, rowIndex, i);
    const left = canvas.querySelector(`[data-ref="${esc(ref)}"][data-segment="left"]`);
    const right = canvas.querySelector(`[data-ref="${esc(ref)}"][data-segment="right"]`);
    const center = canvas.querySelector(`[data-ref="${esc(ref)}"][data-segment="symbol"]`);
    toggleActive(left, !!seriesHighlights?.leftActive?.[i]);
    toggleActive(right, !!seriesHighlights?.rightActive?.[i]);
    toggleActive(center, !!seriesHighlights?.symbolActive?.[i]);

    const el = elements[i];
    if (el?.type === 'contact') {
      const verts = canvas.querySelectorAll(`[data-ref="${esc(ref)}"][data-role="contact-vert"]`);
      const conducting = !!seriesHighlights?.symbolActive?.[i];
      verts.forEach(node => toggleActive(node, conducting));
      const bridge = canvas.querySelector(`[data-ref="${esc(ref)}"][data-role="contact-bridge"]`);
      const closed = isContactClosed(el);
      if (bridge) {
        applyContactState(bridge, closed);
      }
      verts.forEach(node => applyContactState(node, closed));
      const diag = canvas.querySelectorAll(`[data-ref="${esc(ref)}"][data-role="contact-diag"]`);
      diag.forEach(node => applyContactState(node, closed));
    } else if (el?.type === 'coil') {
      const coils = canvas.querySelectorAll(`[data-ref="${esc(ref)}"][data-role="coil"]`);
      const energized = !!seriesHighlights?.symbolActive?.[i];
      coils.forEach(node => node.classList.toggle('energized', energized));
    }
  }
}

function toggleActive(node, isActive) {
  if (!node) return;
  if (isActive) {
    node.classList.add('active');
  } else {
    node.classList.remove('active');
  }
}

function makeRef(rungId, rowIndex, elementIndex) {
  return `${rungId}|${rowIndex}|${elementIndex}`;
}

function esc(value) {
  if (window.CSS && CSS.escape) {
    return CSS.escape(String(value));
  }
  return String(value).replace(/[^\w-]/g, '\\$&');
}
