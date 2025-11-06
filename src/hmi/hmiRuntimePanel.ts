import * as vscode from 'vscode';
import { HmiService } from './hmiService';
import { HmiBinding } from './types';
import { IOSimService } from '../io/ioService';
import { EmulatorController } from '../runtime/emulator';

export class HmiRuntimePanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private latestVariables: Record<string, number | boolean> = {};

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly hmiService: HmiService,
    private readonly ioService: IOSimService,
    private readonly emulator: EmulatorController
  ) {}

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postInitial();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'plcHmiRuntime',
      'PLC HMI Runtime',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.ioService.onDidChangeState(() => this.postIo());
    this.emulator.onDidUpdateState(snapshot => { this.latestVariables = snapshot; this.postRuntime(); });
    this.emulator.onDidChangeRunState(() => this.postRuntime());

    this.postInitial();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'requestLoad': {
        const model = await this.hmiService.load();
        this.postMessage({ type: 'loaded', hmi: model });
        this.postIo();
        this.postRuntime();
        break;
      }
      case 'ioWrite': {
        const b = message?.binding as HmiBinding | undefined;
        const value = message?.value as any;
        if (!b) { return; }
        if (b.target === 'input') {
          this.ioService.setInputValue(b.symbol, Boolean(value));
        } else if (b.target === 'variable') {
          this.emulator.writeVariable(b.symbol, typeof value === 'number' ? value : Boolean(value));
        } else {
          // outputs are read-only in runtime
        }
        break;
      }
      default:
        break;
    }
  }

  private async postInitial(): Promise<void> {
    const model = await this.hmiService.load();
    this.postMessage({ type: 'loaded', hmi: model });
    this.postIo();
    this.postRuntime();
  }

  private postIo(): void {
    const io = this.ioService.getState();
    this.postMessage({ type: 'ioState', inputs: io.inputs, outputs: io.outputs });
  }

  private postRuntime(): void {
    this.postMessage({ type: 'runtimeState', variables: this.latestVariables });
  }

  private postMessage(payload: unknown): void {
    if (!this.panel) { return; }
    this.panel.webview.postMessage(payload);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-runtime', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-runtime', 'styles.css'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>PLC HMI Runtime</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
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
