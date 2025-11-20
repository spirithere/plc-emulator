import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { VariableDeclaration } from '../types';

export class IOMappingPanelManager {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly contextUri: vscode.Uri,
    private readonly plcService: PLCopenService
  ) {
    this.plcService.onDidChangeModel(() => this.postVariables());
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postVariables();
      return;
    }

    this.panel = vscode.window.createWebviewPanel('plcIOMapping', 'PLC IO Mapping', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'saveMappings') {
        await this.plcService.updateVariableMappings(message.updates as Array<Pick<VariableDeclaration, 'name' | 'address' | 'opcUaNodeId'>>);
        vscode.window.showInformationMessage('IO mappings updated.');
      } else if (message?.type === 'requestVariables') {
        this.postVariables();
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.postVariables();
  }

  private postVariables(): void {
    if (!this.panel) return;
    const vars = this.plcService.getAllVariables();
    this.panel.webview.postMessage({ type: 'variables', variables: vars });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.contextUri, 'media', 'mapping', 'styles.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>IO Mapping</title>
</head>
<body>
  <header>
    <h2>IO Mapping</h2>
    <button id="save" class="primary">Save</button>
    <button id="refresh">Refresh</button>
  </header>
  <table id="mapping-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Scope</th>
        <th>Section</th>
        <th>Data Type</th>
        <th>Address</th>
        <th>OPC UA NodeId</th>
        <th>Retain</th>
        <th>Const</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();

    const tableBody = () => document.querySelector('#mapping-table tbody');

    function render(variables) {
      const tbody = tableBody();
      tbody.innerHTML = '';
      variables.forEach((v, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td>\${v.name}</td>
          <td>\${v.scope ?? ''}</td>
          <td>\${v.section ?? ''}</td>
          <td>\${v.dataType ?? ''}</td>
          <td><input data-idx="\${idx}" data-field="address" \${v.scope === 'local' ? 'disabled' : ''} value="\${v.address ?? ''}"></td>
          <td><input data-idx="\${idx}" data-field="opcUaNodeId" \${v.scope === 'local' ? 'disabled' : ''} value="\${v.opcUaNodeId ?? ''}"></td>
          <td>\${v.retain ? '●' : ''}</td>
          <td>\${v.constant ? '●' : ''}</td>
        \`;
        tbody.appendChild(tr);
      });
      window._vars = variables;
    }

    window.addEventListener('message', event => {
      const { type, variables } = event.data;
      if (type === 'variables') {
        render(variables ?? []);
      }
    });

    document.getElementById('save').addEventListener('click', () => {
      const vars = window._vars || [];
      const inputs = document.querySelectorAll('input[data-field]');
      inputs.forEach(input => {
        const idx = Number(input.getAttribute('data-idx'));
        const field = input.getAttribute('data-field');
        if (vars[idx] && field) {
          vars[idx][field] = input.value;
        }
      });
      const updates = vars
        .filter(v => v.scope !== 'local')
        .map(v => ({ name: v.name, address: v.address, opcUaNodeId: v.opcUaNodeId }));
      vscodeApi.postMessage({ type: 'saveMappings', updates });
    });

    document.getElementById('refresh').addEventListener('click', () => {
      vscodeApi.postMessage({ type: 'requestVariables' });
    });

    vscodeApi.postMessage({ type: 'requestVariables' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
