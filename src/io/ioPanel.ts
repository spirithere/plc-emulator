import * as vscode from 'vscode';
import { IOSimService } from './ioService';

export class IOPanelManager {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionUri: vscode.Uri, private readonly ioService: IOSimService) {
    this.ioService.onDidChangeState(() => this.postState());
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel('plcIoSimulator', 'PLC I/O Simulator', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(message => {
      if (message?.type === 'toggleInput') {
        this.ioService.setInputValue(message.id, Boolean(message.value));
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.postState();
  }

  private postState(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.postMessage({
      type: 'state',
      payload: this.ioService.getState()
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'io-sim', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'io-sim', 'styles.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}">
    <title>PLC I/O Simulator</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  let nonce = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}
