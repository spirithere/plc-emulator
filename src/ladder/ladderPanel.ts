import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { LadderRung } from '../types';
import { RuntimeController } from '../runtime/emulator';
import { IOSimService, IOStateSnapshot } from '../io/ioService';

export class LadderPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private latestRuntime: { running: boolean; variables: Record<string, number | boolean | string> } = {
    running: false,
    variables: {}
  };
  private latestIo: IOStateSnapshot = { inputs: [], outputs: [] };

  constructor(
    private readonly contextUri: vscode.Uri,
    private readonly plcService: PLCopenService,
    private readonly emulator: RuntimeController,
    private readonly ioService: IOSimService
  ) {
    this.plcService.onDidChangeModel(() => this.postModel());
    this.emulator.onDidUpdateState(snapshot => {
      this.latestRuntime.variables = snapshot;
      this.postRuntime();
    });
    this.emulator.onDidChangeRunState(running => {
      this.latestRuntime.running = running;
      this.postRuntime();
    });
    this.latestIo = this.ioService.getState();
    this.ioService.onDidChangeState(state => {
      this.latestIo = state;
      this.postRuntime();
    });
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postModel();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'plcLadderEditor',
      'PLC Ladder Editor',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message?.type === 'ladderChanged') {
        await this.handleLadderUpdate(message.rungs as LadderRung[]);
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.latestRuntime.running = this.emulator.isRunning();
    this.latestIo = this.ioService.getState();
    this.postModel();
    this.postRuntime();
  }

  private async handleLadderUpdate(rungs: LadderRung[]): Promise<void> {
    await this.plcService.replaceLadder(rungs);
    vscode.window.showInformationMessage('Ladder diagram updated.');
  }

  private postModel(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.postMessage({
      type: 'model',
      ladder: this.plcService.getLadderRungs()
    });
  }

  private postRuntime(): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      type: 'runtime',
      payload: {
        running: this.latestRuntime.running,
        variables: this.latestRuntime.variables,
        io: this.latestIo
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.contextUri, 'media', 'ladder', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.contextUri, 'media', 'ladder', 'styles.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>PLC Ladder Editor</title>
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
