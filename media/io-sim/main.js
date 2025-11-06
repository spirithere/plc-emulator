const vscode = acquireVsCodeApi();
let state = { inputs: [], outputs: [] };

window.addEventListener('message', event => {
  if (event.data?.type === 'state') {
    state = event.data.payload;
    render();
  }
});

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
    label.innerHTML = `<strong>${channel.id}</strong> ${channel.label}`;
    card.appendChild(label);

    const toggle = document.createElement('button');
    toggle.textContent = channel.value ? 'ON' : 'OFF';
    if (isInput) {
      toggle.onclick = () => {
        vscode.postMessage({
          type: 'toggleInput',
          id: channel.id,
          value: !channel.value
        });
      };
    } else {
      toggle.disabled = true;
    }
    card.appendChild(toggle);

    wrapper.appendChild(card);
  });

  return wrapper;
}

render();
