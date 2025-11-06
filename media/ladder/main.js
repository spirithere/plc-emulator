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

window.addEventListener('message', event => {
  if (event.data?.type === 'model') {
    ladder = event.data.ladder || [];
    render();
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
    preview.appendChild(renderRungPreview(rung, viewportWidth));
  });

  return preview;
}

function renderRungPreview(rung, viewportWidth = 0) {
  const columns = getTotalColumns(rung);
  const resolvedViewport = Math.max((viewportWidth || 0) - LEFT_MARGIN * 2, 400);
  const columnWidth = Math.min(MAX_COLUMN_WIDTH, resolvedViewport / Math.max(columns, 1));
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

  svg.appendChild(createSvgLine(leftRail, 20, leftRail, height - 20, 'rail'));
  svg.appendChild(createSvgLine(rightRail, 20, rightRail, height - 20, 'rail'));

  drawSeriesPreview(svg, rung.elements, rowY(0), 0, columns, junctionX);

  (rung.branches || []).forEach((branch, branchIndex) => {
    const row = branchIndex + 1;
    const y = rowY(row);
    svg.appendChild(createSvgLine(junctionX(branch.startColumn), rowY(0), junctionX(branch.startColumn), y, 'wire'));
    svg.appendChild(createSvgLine(junctionX(branch.endColumn), rowY(0), junctionX(branch.endColumn), y, 'wire'));
    drawSeriesPreview(svg, branch.elements || [], y, branch.startColumn, branch.endColumn, junctionX);
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
  const columnWidth = Math.min(MAX_COLUMN_WIDTH, resolvedViewport / Math.max(columns, 1));
  const leftRail = LEFT_MARGIN;
  const rightRail = leftRail + columnWidth * columns;
  const height = ROW_HEIGHT * (rung.branches.length + 1) + 120;
  const width = rightRail + LEFT_MARGIN;

  const junctionX = index => leftRail + index * columnWidth;
  const rowY = rowIndex => 80 + rowIndex * ROW_HEIGHT;

  const canvas = document.createElement('div');
  canvas.className = 'ladder-grid';
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

  drawRow(svg, layer, rung, rung.elements, 0, 0, columns, rowY, junctionX);

  rung.branches.forEach((branch, branchIndex) => {
    const row = branchIndex + 1;
    drawBranchConnectors(svg, branch, rowY(0), rowY(row), junctionX);
    drawRow(
      svg,
      layer,
      branch,
      branch.elements || [],
      row,
      branch.startColumn,
      branch.endColumn,
      rowY,
      junctionX
    );
  });

  return canvas;
}

function drawRow(svg, layer, owner, elements, rowIndex, startColumn, endColumn, rowY, junctionX) {
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
    svg.appendChild(createSvgLine(junctionX(startColumn + elementIndex), y, left, y, 'wire'));
    svg.appendChild(createSvgLine(right, y, junctionX(startColumn + elementIndex + 1), y, 'wire'));

    if (element?.type === 'coil') {
      drawCoilSymbol(svg, center, y, element);
    } else {
      drawContactSymbol(svg, center, y, element);
    }

    const card = createNodeCard(owner, elements, element, elementIndex);
    positionCard(card, center, y);
    const hoverTarget = createHoverTarget(center, y, columnWidth);
    bindCardHover(card, hoverTarget);
    layer.appendChild(hoverTarget);
    layer.appendChild(card);
  });
}

function drawBranchConnectors(svg, branch, baseY, branchY, junctionX) {
  svg.appendChild(createSvgLine(junctionX(branch.startColumn), baseY, junctionX(branch.startColumn), branchY, 'wire'));
  svg.appendChild(createSvgLine(junctionX(branch.endColumn), baseY, junctionX(branch.endColumn), branchY, 'wire'));
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

  const label = document.createElement('input');
  label.type = 'text';
  label.value = element.label || '';
  label.placeholder = element.type === 'coil' ? 'Coil name' : 'Contact name';
  label.oninput = event => {
    element.label = event.target.value;
  };
  card.appendChild(label);

  const controls = document.createElement('div');
  controls.className = 'element-controls';

  const typeSelector = document.createElement('select');
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

function drawSeriesPreview(svg, elements, y, startColumn, endColumn, junctionX) {
  svg.appendChild(createSvgLine(junctionX(startColumn), y, junctionX(endColumn), y, 'wire'));
  if (!elements.length) {
    return;
  }

  const columnWidth = Math.max(junctionX(startColumn + 1) - junctionX(startColumn), 1);
  const symbolPad = getSymbolPad(columnWidth);

  elements.forEach((element, index) => {
    const columnIndex = startColumn + index;
    const center = (junctionX(columnIndex) + junctionX(columnIndex + 1)) / 2;
    svg.appendChild(createSvgLine(center - symbolPad, y, center + symbolPad, y, 'wire'));
    if (element?.type === 'coil') {
      drawCoilSymbol(svg, center, y, element);
    } else {
      drawContactSymbol(svg, center, y, element);
    }
  });
}

function drawContactSymbol(svg, x, y, element) {
  const half = 13;
  svg.appendChild(createSvgLine(x - half, y - 20, x - half, y + 20, 'symbol'));
  svg.appendChild(createSvgLine(x + half, y - 20, x + half, y + 20, 'symbol'));
  if ((element?.variant ?? 'no') === 'nc') {
    svg.appendChild(createSvgLine(x - half, y - 20, x + half, y + 20, 'symbol'));
  }
  drawLabel(svg, element, x, y + 28);
}

function drawCoilSymbol(svg, x, y, element) {
  const radius = 18;
  const leftPath = document.createElementNS(SVG_NS, 'path');
  leftPath.setAttribute('d', `M ${x - radius} ${y - 20} C ${x - radius / 2} ${y - 20}, ${x - radius / 2} ${y + 20}, ${x - radius} ${y + 20}`);
  leftPath.setAttribute('class', 'symbol');
  applyStrokeStyle(leftPath, 'symbol');

  const rightPath = document.createElementNS(SVG_NS, 'path');
  rightPath.setAttribute('d', `M ${x + radius} ${y - 20} C ${x + radius / 2} ${y - 20}, ${x + radius / 2} ${y + 20}, ${x + radius} ${y + 20}`);
  rightPath.setAttribute('class', 'symbol');
  applyStrokeStyle(rightPath, 'symbol');

  svg.appendChild(leftPath);
  svg.appendChild(rightPath);
  drawLabel(svg, element, x, y + 28);
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
    state: false
  };
}

render();
