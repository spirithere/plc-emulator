import * as path from 'path';
import * as vscode from 'vscode';
import { PLCopenService } from './services/plcopenService';
import { LadderPanelManager } from './ladder/ladderPanel';
import { EmulatorController } from './runtime/emulator';
import { IOSimService } from './io/ioService';
import { IOPanelManager } from './io/ioPanel';
import { ProfileManager } from './runtime/profileManager';
import { POUTreeProvider } from './views/pouTree';
import { RuntimeViewProvider } from './views/runtimeView';
import { QuickActionsViewProvider } from './views/quickActionsView';

let plcService: PLCopenService;
let ladderManager: LadderPanelManager;
let ioService: IOSimService;
let ioPanel: IOPanelManager;
let emulator: EmulatorController;
let profileManager: ProfileManager;
let pouTreeProvider: POUTreeProvider;
let runtimeViewProvider: RuntimeViewProvider;
let quickActionsViewProvider: QuickActionsViewProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  plcService = new PLCopenService();
  ladderManager = new LadderPanelManager(context.extensionUri, plcService);
  ioService = new IOSimService();
  ioPanel = new IOPanelManager(context.extensionUri, ioService);
  profileManager = new ProfileManager(context);
  emulator = new EmulatorController(plcService, ioService, profileManager);
  pouTreeProvider = new POUTreeProvider(plcService);
  runtimeViewProvider = new RuntimeViewProvider(context.extensionUri, emulator, ioService, profileManager);
  quickActionsViewProvider = new QuickActionsViewProvider(context.extensionUri);

  const syncIoFromModel = (): void => {
    ioService.syncFromProject(plcService.getModel());
  };
  context.subscriptions.push(plcService.onDidChangeModel(syncIoFromModel));
  syncIoFromModel();

  context.subscriptions.push(
    plcService,
    vscode.commands.registerCommand('plcEmu.openProject', () => plcService.pickAndLoadProject()),
    vscode.commands.registerCommand('plcEmu.openStructuredText', () => openStructuredTextEditor()),
    vscode.commands.registerCommand('plcEmu.openStructuredTextBlock', (name: string) => openStructuredTextEditor(name)),
    vscode.commands.registerCommand('plcEmu.openLadderEditor', () => ladderManager.show()),
    vscode.commands.registerCommand('plcEmu.openIOSimulator', () => ioPanel.show()),
    vscode.commands.registerCommand('plcEmu.switchProfile', () => profileManager.selectProfile()),
    vscode.commands.registerCommand('plcEmu.run', () => emulator.start()),
    vscode.commands.registerCommand('plcEmu.stop', () => emulator.stop()),
    vscode.workspace.onDidSaveTextDocument(async document => {
      const root = ensureWorkspaceRoot();
      if (!root) {
        return;
      }

      const mirrorPath = path.join(root.fsPath, '.plc', 'st');
      if (document.uri.fsPath.startsWith(mirrorPath)) {
        const name = path.basename(document.uri.fsPath).replace(/\.st$/, '');
        await plcService.updateStructuredTextBlock(name, document.getText());
        vscode.window.showInformationMessage(`Structured Text block "${name}" updated.`);
      }
    }),
    vscode.window.registerTreeDataProvider('plcPouExplorer', pouTreeProvider),
    vscode.window.registerWebviewViewProvider('plcRuntimeControls', runtimeViewProvider),
    vscode.window.registerWebviewViewProvider('plcQuickActions', quickActionsViewProvider)
  );

  await plcService.loadFromWorkspaceSetting();
  pouTreeProvider.refresh();
}

export function deactivate(): void {
  emulator?.stop();
}

async function openStructuredTextEditor(targetName?: string): Promise<void> {
  const blocks = plcService.getStructuredTextBlocks();
  if (blocks.length === 0) {
    vscode.window.showWarningMessage('No Structured Text blocks found.');
    return;
  }

  let block = blocks.find(b => b.name === targetName);
  if (!block) {
    const selection = await vscode.window.showQuickPick(
      blocks.map(b => ({ label: b.name, block: b })),
      { title: 'Select Structured Text block' }
    );

    if (!selection) {
      return;
    }

    block = selection.block;
  }

  const workspaceRoot = ensureWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Open a workspace folder to edit Structured Text.');
    return;
  }

  const cacheDir = vscode.Uri.joinPath(workspaceRoot, '.plc', 'st');
  await vscode.workspace.fs.createDirectory(cacheDir);
  const mirrorUri = vscode.Uri.joinPath(cacheDir, `${block.name}.st`);
  await vscode.workspace.fs.writeFile(mirrorUri, Buffer.from(block.body, 'utf8'));
  const document = await vscode.workspace.openTextDocument(mirrorUri);
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Active, true);
}

function ensureWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}
