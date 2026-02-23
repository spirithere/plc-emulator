const vscode = acquireVsCodeApi();
let state = { inputs: [], outputs: [] };
let lastKey = '';
let scheduled = false;

window.addEventListener('message', event => {
  if (event.data?.type !== 'state') return;
  const next = event.data.payload;
  const key = JSON.stringify(next);
  if (key === lastKey) return; // ignore identical snapshots
  state = next;
  lastKey = key;
  scheduleRender();
});

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
}

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  root.appendChild(section('Inputs', state.inputs, true));
  root.appendChild(section('Outputs', state.outputs, false));
}

function section(title, channels, isInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'section';

  const heading = document.createElement('h2');
  heading.textContent = `${title} (${channels.length})`;
  wrapper.appendChild(heading);

  if (channels.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No channels defined yet.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  channels.forEach(channel => {
    const card = document.createElement('div');
    card.className = `channel ${channel.value ? 'active' : ''}`;

    const label = document.createElement('div');
    label.className = 'label';
    const secondary = channel.label && channel.label !== channel.id ? ` ${channel.label}` : '';
    const address = channel.address ? ` <span class="address">${channel.address}</span>` : '';
    label.innerHTML = `<strong>${channel.id}</strong>${secondary}${address}`;
    card.appendChild(label);

    const toggle = document.createElement('button');
    toggle.textContent = channel.value ? 'ON' : 'OFF';
    if (isInput) {
      toggle.dataset.id = channel.id;
      toggle.dataset.role = 'input-toggle';
    } else {
      toggle.disabled = true;
    }
    card.appendChild(toggle);

    wrapper.appendChild(card);
  });

  return wrapper;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-role="input-toggle"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const ch = state.inputs.find(c => c.id === id);
  if (!ch) return;
  vscode.postMessage({ type: 'toggleInput', id, value: !ch.value });
});

render();
