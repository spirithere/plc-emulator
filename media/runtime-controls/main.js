const vscode = acquireVsCodeApi();
let state = {
  running: false,
  profile: { title: 'IEC 61131-3 Base', vendor: 'IEC' },
  scanTime: 100,
  variables: {},
  inputs: [],
  outputs: []
};

window.addEventListener('message', event => {
  if (event.data?.type === 'state') {
    state = event.data.payload;
    render();
  }
});

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';

  root.appendChild(renderControls());
  root.appendChild(renderStats());
  root.appendChild(renderVariables());
}

function renderControls() {
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = `
    <header>
      <h2>Runtime Controls</h2>
      <span class="badge">${state.running ? 'Running' : 'Stopped'}</span>
    </header>
  `;

  const actions = document.createElement('div');
  actions.className = 'actions';

  const runBtn = document.createElement('button');
  runBtn.textContent = 'Run';
  runBtn.disabled = state.running;
  runBtn.onclick = () => vscode.postMessage({ type: 'run' });

  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop';
  stopBtn.disabled = !state.running;
  stopBtn.onclick = () => vscode.postMessage({ type: 'stop' });

  const ladderBtn = document.createElement('button');
  ladderBtn.textContent = 'Open Ladder';
  ladderBtn.onclick = () => vscode.postMessage({ type: 'openLadder' });

  const ioBtn = document.createElement('button');
  ioBtn.textContent = 'Open I/O';
  ioBtn.onclick = () => vscode.postMessage({ type: 'openIO' });

  const profileBtn = document.createElement('button');
  profileBtn.textContent = 'Switch Profile';
  profileBtn.onclick = () => vscode.postMessage({ type: 'switchProfile' });

  [runBtn, stopBtn, ladderBtn, ioBtn, profileBtn].forEach(btn => actions.appendChild(btn));
  section.appendChild(actions);
  return section;
}

function renderStats() {
  const section = document.createElement('section');
  section.className = 'panel stats';

  const profile = document.createElement('div');
  profile.innerHTML = `<strong>Profile:</strong> ${state.profile?.title || 'Unknown'} (${state.profile?.vendor || ''})`;

  const scan = document.createElement('div');
  scan.innerHTML = `<strong>Scan Time:</strong> ${state.scanTime} ms`;

  const ioSummary = document.createElement('div');
  ioSummary.innerHTML = `<strong>I/O:</strong> ${state.inputs.length} inputs • ${state.outputs.length} outputs`;

  section.appendChild(profile);
  section.appendChild(scan);
  section.appendChild(ioSummary);

  return section;
}

function renderVariables() {
  const section = document.createElement('section');
  section.className = 'panel';
  section.innerHTML = '<header><h2>Variables</h2></header>';

  const list = document.createElement('div');
  list.className = 'variable-list';

  const entries = Object.entries(state.variables || {});
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No runtime state yet. Run the emulator to populate values.';
    list.appendChild(empty);
  } else {
    entries.forEach(([name, value]) => {
      const row = document.createElement('div');
      row.className = 'variable-row';
      row.innerHTML = `<span>${name}</span><span>${value}</span>`;
      list.appendChild(row);
    });
  }

  section.appendChild(list);
  return section;
}

render();
