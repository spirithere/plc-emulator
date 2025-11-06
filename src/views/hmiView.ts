import * as vscode from 'vscode';

export class HmiLauncherViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case 'openDesigner':
          await vscode.commands.executeCommand('plcEmu.openHmiDesigner');
          break;
        case 'openRuntime':
          await vscode.commands.executeCommand('plcEmu.openHmiRuntime');
          break;
        case 'openJson':
          await this.openHmiJson();
          break;
        default:
          break;
      }
    });
  }

  private async openHmiJson(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      vscode.window.showErrorMessage('Open a workspace folder to edit HMI.');
      return;
    }
    const rel = vscode.workspace.getConfiguration('plcEmu').get<string>('hmiFile') || '.plc/hmi.json';
    const target = vscode.Uri.joinPath(root, rel);
    try {
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      // If not found, offer to create from sample
      const pick = await vscode.window.showInformationMessage('HMI file not found. Create from sample?', 'Create');
      if (pick === 'Create') {
        const sample = vscode.Uri.joinPath(this.extensionUri, 'examples', 'sample-hmi.json');
        let content: Uint8Array;
        try {
          content = await vscode.workspace.fs.readFile(sample);
        } catch {
          content = Buffer.from('{\n  "version": 1,\n  "canvas": { "width": 800, "height": 480, "grid": 10, "background": "#1e1e1e" },\n  "pages": [{ "id": "main", "title": "Main", "widgets": [] }]\n}\n', 'utf8');
        }
        const dir = vscode.Uri.joinPath(target, '..');
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(target, content);
        const doc2 = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc2);
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-launcher', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hmi-launcher', 'styles.css'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}">
    <title>PLC HMI</title>
  </head>
  <body>
    <div class="stack">
      <button id="btnDesigner">Open HMI Designer</button>
      <button id="btnRuntime">Open HMI Runtime</button>
      <hr/>
      <button id="btnOpenJson">Open hmi.json</button>
    </div>
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

