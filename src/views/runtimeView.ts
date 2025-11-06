import * as vscode from 'vscode';
import { EmulatorController } from '../runtime/emulator';
import { IOSimService } from '../io/ioService';
import { ProfileManager } from '../runtime/profileManager';

export class RuntimeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private latestVariables: Record<string, number | boolean | string> = {};

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly emulator: EmulatorController,
    private readonly ioService: IOSimService,
    private readonly profileManager: ProfileManager
  ) {
    this.emulator.onDidUpdateState(snapshot => {
      this.latestVariables = snapshot;
      this.postState();
    });
    this.emulator.onDidChangeRunState(() => this.postState());
    this.ioService.onDidChangeState(() => this.postState());
    this.profileManager.onDidChangeProfile(() => this.postState());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case 'run':
          this.emulator.start();
          break;
        case 'stop':
          this.emulator.stop();
          break;
        case 'openLadder':
          await vscode.commands.executeCommand('plcEmu.openLadderEditor');
          break;
        case 'openIO':
          await vscode.commands.executeCommand('plcEmu.openIOSimulator');
          break;
        case 'switchProfile':
          await vscode.commands.executeCommand('plcEmu.switchProfile');
          break;
        default:
          break;
      }
    });

    this.postState();
  }

  private postState(): void {
    if (!this.view) {
      return;
    }

    const ioState = this.ioService.getState();
    this.view.webview.postMessage({
      type: 'state',
      payload: {
        running: this.emulator.isRunning(),
        profile: this.profileManager.getActiveProfile(),
        scanTime: vscode.workspace.getConfiguration('plcEmu').get<number>('scanTimeMs') ?? 100,
        variables: this.latestVariables,
        outputs: ioState.outputs,
        inputs: ioState.inputs
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'runtime-controls', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'runtime-controls', 'styles.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}">
    <title>PLC Runtime</title>
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
