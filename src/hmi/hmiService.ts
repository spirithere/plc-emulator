import * as vscode from 'vscode';
import * as path from 'path';
import { HmiModel } from './types';

export class HmiService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<HmiModel>();
  public readonly onDidChangeModel = this.changeEmitter.event;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  public async load(): Promise<HmiModel> {
    const uri = await this.getHmiUri();
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString('utf8');
      const json = JSON.parse(text) as HmiModel;
      return json;
    } catch {
      // default model
      return this.createDefault();
    }
  }

  public async save(model: HmiModel): Promise<void> {
    const uri = await this.getHmiUri(true);
    const text = JSON.stringify(model, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    this.changeEmitter.fire(model);
  }

  private async getHmiUri(ensureDir = false): Promise<vscode.Uri> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      throw new Error('Open a workspace folder to use HMI.');
    }
    const rel = vscode.workspace.getConfiguration('plcEmu').get<string>('hmiFile') || '.plc/hmi.json';
    const full = vscode.Uri.joinPath(root, rel);
    if (ensureDir) {
      const dir = path.dirname(full.fsPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    }
    return full;
  }

  private createDefault(): HmiModel {
    return {
      version: 1,
      canvas: { width: 1280, height: 720, grid: 10, background: '#1e1e1e' },
      pages: [
        { id: 'main', title: 'Main', widgets: [] }
      ]
    };
  }
}

