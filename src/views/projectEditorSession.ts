import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { ProjectMetadata, StructuredTextBlock } from '../types';

export class ProjectEditorSession {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly webview: vscode.Webview,
    private readonly contextUri: vscode.Uri,
    private readonly plcService: PLCopenService
  ) {
    this.webview.html = getProjectEditorHtml(this.webview, this.contextUri);
    this.disposables.push(
      this.plcService.onDidChangeModel(() => this.postData()),
      this.webview.onDidReceiveMessage(async message => {
        try {
          switch (message?.type) {
            case 'requestData':
              this.postData();
              break;
            case 'saveMetadata':
              await this.plcService.updateMetadata(message.metadata as Partial<ProjectMetadata>);
              void vscode.window.showInformationMessage('Project metadata saved.');
              break;
            case 'updatePou':
              await this.plcService.upsertPou(message.pou as StructuredTextBlock);
              break;
            case 'createPou':
              await this.plcService.upsertPou(message.pou as StructuredTextBlock, { allowCreate: true });
              break;
            case 'deletePou':
              await this.plcService.deletePou(message.name as string);
              break;
            case 'openPou':
              await vscode.commands.executeCommand('plcEmu.openStructuredTextBlock', message.name);
              break;
            case 'saveConfig':
              await this.plcService.updateConfigurations(message.configurations);
              break;
            default:
              break;
          }
        } catch (error) {
          void vscode.window.showErrorMessage((error as Error).message);
        }
      })
    );
    this.postData();
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }

  private postData(): void {
    const model = this.plcService.getModel();
    this.webview.postMessage({
      type: 'data',
      metadata: model.metadata ?? {},
      pous: model.pous,
      configurations: model.configurations ?? []
    });
  }
}

export function getProjectEditorHtml(webview: vscode.Webview, contextUri: vscode.Uri): string {
  const nonce = getNonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(contextUri, 'media', 'project', 'styles.css'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>PLC Project Editor</title>
</head>
<body>
  <div id="loading">Loading...</div>
  <section class="card">
    <header><h2>Project Metadata</h2><button id="saveMeta" class="primary">Save</button></header>
    <div class="grid">
      <label>Company<input id="companyName"></label>
      <label>Product<input id="productName"></label>
      <label>Product Version<input id="productVersion"></label>
      <label>Project Name<input id="projectName"></label>
      <label>Organization<input id="organization"></label>
    </div>
  </section>

  <section class="card">
    <header>
      <h2>POUs</h2>
      <div class="actions">
        <input id="newPouName" placeholder="Name" />
        <select id="newPouType">
          <option value="program">PROGRAM</option>
          <option value="functionBlock">FUNCTION_BLOCK</option>
          <option value="function">FUNCTION</option>
        </select>
        <button id="createPou" class="primary">Add</button>
      </div>
    </header>
    <table>
      <thead>
        <tr><th>Name</th><th>Type</th><th>Language</th><th>Actions</th></tr>
      </thead>
      <tbody id="pouTable"></tbody>
    </table>
  </section>

  <section class="card">
    <header>
      <h2>Configurations (JSON)</h2>
      <button id="saveConfig" class="primary">Save</button>
    </header>
    <textarea id="configJson" rows="14"></textarea>
  </section>

  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    let state = { metadata: {}, pous: [], configurations: [] };
    const $ = (id) => document.getElementById(id);

    function render() {
      document.getElementById('loading').style.display = 'none';
      $('companyName').value = state.metadata.companyName || '';
      $('productName').value = state.metadata.productName || '';
      $('productVersion').value = state.metadata.productVersion || '';
      $('projectName').value = state.metadata.projectName || '';
      $('organization').value = state.metadata.organization || '';
      $('configJson').value = JSON.stringify(state.configurations || [], null, 2);

      const tbody = $('pouTable');
      tbody.innerHTML = '';
      const names = new Set();
      state.pous.forEach(pou => {
        if (names.has(pou.name)) { return; }
        names.add(pou.name);
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td>\${pou.name}</td>
          <td>
            <select data-name="\${pou.name}" class="pou-type">
              <option value="program" \${(pou.pouType||'program')==='program'?'selected':''}>PROGRAM</option>
              <option value="functionBlock" \${(pou.pouType||'program')==='functionBlock'?'selected':''}>FUNCTION_BLOCK</option>
              <option value="function" \${(pou.pouType||'program')==='function'?'selected':''}>FUNCTION</option>
            </select>
          </td>
          <td>\${pou.language || 'ST'}</td>
          <td>
            <button data-action="open" data-name="\${pou.name}">Open</button>
            <button data-action="delete" data-name="\${pou.name}" class="danger">Delete</button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    window.addEventListener('message', event => {
      if (event.data?.type === 'data') {
        state = event.data;
        render();
      }
    });

    $('saveMeta').onclick = () => {
      vscodeApi.postMessage({
        type: 'saveMetadata',
        metadata: {
          companyName: $('companyName').value,
          productName: $('productName').value,
          productVersion: $('productVersion').value,
          projectName: $('projectName').value,
          organization: $('organization').value
        }
      });
    };

    $('createPou').onclick = () => {
      const name = $('newPouName').value.trim();
      if (!name) {
        alert('Name is required.');
        return;
      }
      if (state.pous.some(p => p.name === name)) {
        alert('Name already exists.');
        return;
      }
      const pouType = $('newPouType').value;
      vscodeApi.postMessage({
        type: 'createPou',
        pou: {
          name,
          pouType,
          language: 'ST',
          body: \`PROGRAM \${name}\\nEND_PROGRAM\`
        }
      });
      $('newPouName').value = '';
    };

    $('pouTable').addEventListener('change', e => {
      if (e.target.classList.contains('pou-type')) {
        const name = e.target.getAttribute('data-name');
        const pou = state.pous.find(p => p.name === name);
        if (!pou) return;
        pou.pouType = e.target.value;
        vscodeApi.postMessage({ type: 'updatePou', pou });
      }
    });

    $('pouTable').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const name = btn.getAttribute('data-name');
      if (action === 'open') {
        vscodeApi.postMessage({ type: 'openPou', name });
      } else if (action === 'delete') {
        vscodeApi.postMessage({ type: 'deletePou', name });
      }
    });

    $('saveConfig').onclick = () => {
      try {
        const configs = JSON.parse($('configJson').value || '[]');
        vscodeApi.postMessage({ type: 'saveConfig', configurations: configs });
      } catch (err) {
        alert('Invalid JSON: ' + err);
      }
    };

    vscodeApi.postMessage({ type: 'requestData' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
