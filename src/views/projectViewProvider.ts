import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { ProjectEditorSession, getProjectEditorHtml } from './projectEditorSession';

export class ProjectViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'plcProjectEditor';
  private session: ProjectEditorSession | undefined;

  constructor(
    private readonly contextUri: vscode.Uri,
    private readonly plcService: PLCopenService
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.contextUri]
    };
    this.session?.dispose();
    this.session = new ProjectEditorSession(webviewView.webview, this.contextUri, this.plcService);
  }

  public showStandalone(): void {
    const panel = vscode.window.createWebviewPanel(
      'plcProjectEditorPanel',
      'PLC Project Editor',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.contextUri]
    };
    const session = new ProjectEditorSession(panel.webview, this.contextUri, this.plcService);
    panel.onDidDispose(() => session.dispose());
  }
}
