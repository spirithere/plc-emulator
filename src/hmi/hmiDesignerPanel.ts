import * as vscode from 'vscode';
import { HmiService } from './hmiService';
import { HmiModel } from './types';
import { IOSimService } from '../io/ioService';
import { EmulatorController } from '../runtime/emulator';

export class HmiDesignerPanelManager {
  private panel: vscode.WebviewPanel | undefined;

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
      'plcHmiDesigner',
      'PLC HMI Designer',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async message => this.handleMessage(message));

    this.postInitial();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'requestLoad': {
        const model = await this.hmiService.load();
        this.postMessage({ type: 'loaded', hmi: model });
        break;
      }
      case 'requestSave': {
        const hmi = message?.hmi as HmiModel | undefined;
        if (!hmi) {
          return;
        }
        await this.hmiService.save(hmi);
        this.postMessage({ type: 'saved', ok: true });
        vscode.window.showInformationMessage('HMI saved.');
        break;
      }
      case 'requestIoList': {
        const io = this.ioService.getState();
        this.postMessage({ type: 'ioList', inputs: io.inputs, outputs: io.outputs });
        break;
      }
      case 'requestVariableList': {
        this.postMessage({ type: 'variableList', variables: this.emulator.getVariableNames() });
        break;
      }
      default:
        break;
    }
  }

  private async postInitial(): Promise<void> {
    const model = await this.hmiService.load();
    this.postMessage({ type: 'loaded', hmi: model });
    const io = this.ioService.getState();
    this.postMessage({ type: 'ioList', inputs: io.inputs, outputs: io.outputs });
    this.postMessage({ type: 'variableList', variables: this.emulator.getVariableNames() });
  }

  private postMessage(payload: unknown): void {
    if (!this.panel) { return; }
    this.panel.webview.postMessage(payload);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-designer', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-designer', 'styles.css'));
    const sharedStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-shared', 'symbols.css'));
    const sharedScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-shared', 'symbols.js'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${sharedStyleUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>PLC HMI Designer</title>
  </head>
  <body>
    <div id="toolbar">
      <button id="btnLoad">Load</button>
      <button id="btnSave">Save</button>
      <span class="flex-spacer"></span>
      <button data-widget="button">+ Button</button>
      <button data-widget="switch">+ Switch</button>
      <button data-widget="lamp">+ Lamp</button>
      <button data-widget="motor">+ Motor</button>
      <button data-widget="fan">+ Fan</button>
      <button data-widget="pump">+ Pump</button>
      <button data-widget="cylinder">+ Cylinder</button>
      <button data-widget="valve">+ Valve</button>
      <span class="sep"></span>
      <button data-widget="slider">+ Slider</button>
      <button data-widget="numeric">+ Numeric</button>
      <button data-widget="gauge">+ Gauge</button>
      <button data-widget="tank">+ Tank</button>
      <button data-widget="text">+ Text</button>
    </div>
    <div id="workspace">
      <div id="canvas" tabindex="0"></div>
      <div id="props">
        <div class="panel-title">プロパティ</div>
        <div id="props-content"></div>
      </div>
    </div>
    <script nonce="${nonce}" src="${sharedScriptUri}"></script>
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
