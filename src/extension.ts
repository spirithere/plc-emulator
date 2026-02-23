import * as path from 'path';
import * as vscode from 'vscode';
import { PLCopenService } from './services/plcopenService';
import { LadderPanelManager } from './ladder/ladderPanel';
import { EmulatorController, RuntimeController } from './runtime/emulator';
import { ExternalRuntimeController } from './runtime/externalController';
import { IOSimService } from './io/ioService';
import { IOPanelManager } from './io/ioPanel';
import { IOMappingPanelManager } from './io/ioMappingPanel';
import { ProjectViewProvider } from './views/projectViewProvider';
import { ProfileManager } from './runtime/profileManager';
import { POUTreeProvider } from './views/pouTree';
import { RuntimeViewProvider } from './views/runtimeView';
import { HmiLauncherViewProvider } from './views/hmiView';
import { HmiService } from './hmi/hmiService';
import { HmiDesignerPanelManager } from './hmi/hmiDesignerPanel';
import { HmiRuntimePanelManager } from './hmi/hmiRuntimePanel';
import { StructuredTextDiagnosticEvent } from './runtime/st/runtime';
import { RuntimeHostAdapter } from './runtime/host/extensionAdapter';
// Quick actions are now exposed as view title toolbar items via menus; no webview needed.

let plcService: PLCopenService;
let ladderManager: LadderPanelManager;
let ioService: IOSimService;
let ioPanel: IOPanelManager;
let ioMappingPanel: IOMappingPanelManager;
let projectEditorView: ProjectViewProvider;
let emulator: RuntimeController;
let profileManager: ProfileManager;
let pouTreeProvider: POUTreeProvider;
let runtimeViewProvider: RuntimeViewProvider;
let hmiLauncherViewProvider: HmiLauncherViewProvider;
// no quickActionsViewProvider
let hmiService: HmiService;
let hmiDesigner: HmiDesignerPanelManager;
let hmiRuntime: HmiRuntimePanelManager;
let hostAdapter: RuntimeHostAdapter | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  plcService = new PLCopenService();
  ioService = new IOSimService();
  ioPanel = new IOPanelManager(context.extensionUri, ioService);
  ioMappingPanel = new IOMappingPanelManager(context.extensionUri, plcService);
  projectEditorView = new ProjectViewProvider(context.extensionUri, plcService);
  profileManager = new ProfileManager(context);
  const runtimeMode = vscode.workspace.getConfiguration('plcEmu').get<'embedded' | 'external'>('runtimeMode', 'embedded');
  if (runtimeMode === 'external') {
    hostAdapter = new RuntimeHostAdapter(context);
    emulator = new ExternalRuntimeController(plcService, ioService, hostAdapter);
  } else {
    emulator = new EmulatorController(plcService, ioService, profileManager);
  }
  ladderManager = new LadderPanelManager(context.extensionUri, plcService, emulator, ioService);
  pouTreeProvider = new POUTreeProvider(plcService);
  runtimeViewProvider = new RuntimeViewProvider(context.extensionUri, emulator, ioService, profileManager);
  hmiLauncherViewProvider = new HmiLauncherViewProvider(context.extensionUri);
  hmiService = new HmiService();
  hmiDesigner = new HmiDesignerPanelManager(context.extensionUri, hmiService, ioService, emulator);
  hmiRuntime = new HmiRuntimePanelManager(context.extensionUri, hmiService, ioService, emulator);
  // Set up a context key to toggle Run/Stop toolbar items
  const setRunningContext = (running: boolean): Thenable<unknown> =>
    vscode.commands.executeCommand('setContext', 'plcEmu.running', running);

  const syncIoFromModel = (): void => {
    ioService.syncFromProject(plcService.getModel());
  };
  context.subscriptions.push(plcService.onDidChangeModel(syncIoFromModel));
  syncIoFromModel();

  const stDiagnostics = vscode.languages.createDiagnosticCollection('plc-structured-text');

  context.subscriptions.push(
    plcService,
    stDiagnostics,
    emulator,
    emulator.onStructuredTextDiagnostics(event => {
      void handleStructuredTextDiagnostics(event, stDiagnostics, plcService);
    }),
    vscode.commands.registerCommand('plcEmu.openProject', () => plcService.pickAndLoadProject()),
    vscode.commands.registerCommand('plcEmu.openStructuredText', () => openStructuredTextEditor()),
    vscode.commands.registerCommand('plcEmu.openStructuredTextBlock', (name: string) => openStructuredTextEditor(name)),
    vscode.commands.registerCommand('plcEmu.openPouPreview', (name: string) => openPouPreview(name)),
    vscode.commands.registerCommand('plcEmu.openLadderEditor', () => ladderManager.show()),
    vscode.commands.registerCommand('plcEmu.openIOSimulator', () => ioPanel.show()),
    vscode.commands.registerCommand('plcEmu.openIOMapping', () => ioMappingPanel.show()),
    vscode.commands.registerCommand('plcEmu.editProjectInfo', () => projectEditorView.showStandalone()),
    vscode.commands.registerCommand('plcEmu.openHmiDesigner', () => hmiDesigner.show()),
    vscode.commands.registerCommand('plcEmu.openHmiRuntime', () => hmiRuntime.show()),
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
    vscode.window.registerWebviewViewProvider('plcHmiView', hmiLauncherViewProvider),
    vscode.window.registerWebviewViewProvider(ProjectViewProvider.viewId, projectEditorView)
  );
  if (hostAdapter) {
    context.subscriptions.push(hostAdapter);
  }

  // initialize and maintain the running state context key
  await setRunningContext(emulator.isRunning());
  emulator.onDidChangeRunState(running => { void setRunningContext(running); });

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

async function openPouPreview(name: string): Promise<void> {
  const block = plcService.getProjectPous().find(pou => pou.name === name);
  if (!block) {
    vscode.window.showErrorMessage(`POU "${name}" was not found.`);
    return;
  }

  const header = [
    `POU: ${block.name}`,
    `Language: ${block.language ?? 'ST'}`,
    `Type: ${block.pouType ?? 'program'}`,
    ''
  ].join('\n');
  const content = `${header}${block.body ?? ''}`;
  const document = await vscode.workspace.openTextDocument({
    content,
    language: 'plaintext'
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Active, true);
}

function ensureWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function handleStructuredTextDiagnostics(
  event: StructuredTextDiagnosticEvent,
  collection: vscode.DiagnosticCollection,
  plcService: PLCopenService
): Promise<void> {
  const workspaceRoot = ensureWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }

  const cacheDir = vscode.Uri.joinPath(workspaceRoot, '.plc', 'st');
  await vscode.workspace.fs.createDirectory(cacheDir);

  const fileUri = vscode.Uri.joinPath(cacheDir, `${event.blockName}.st`);

  const body =
    event.blockBody ?? plcService.getStructuredTextBlocks().find(block => block.name === event.blockName)?.body ?? '';

  if (event.diagnostics.length > 0) {
    await ensureMirrorFile(fileUri, body);
    const diagnostics = event.diagnostics.map(diag => {
      const range = createRangeFromOffsets(body, diag.startOffset, diag.endOffset);
      const severity = diag.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, diag.message, severity);
      diagnostic.source = diag.source === 'runtime' ? 'StructuredText Runtime' : 'StructuredText Parser';
      return diagnostic;
    });
    collection.set(fileUri, diagnostics);
    return;
  }

  collection.delete(fileUri);
}

async function ensureMirrorFile(uri: vscode.Uri, body: string): Promise<void> {
  try {
    const existing = await vscode.workspace.fs.readFile(uri);
    if (Buffer.from(existing).toString('utf8') === body) {
      return;
    }
  } catch {
    // File missing – fall through and create it.
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(body, 'utf8'));
}

function createRangeFromOffsets(body: string, start?: number, end?: number): vscode.Range {
  if (start === undefined && end === undefined) {
    return new vscode.Range(0, 0, 0, 0);
  }

  const safeStart = clampOffset(start ?? 0, body.length);
  const safeEnd = clampOffset(end ?? safeStart, body.length);
  const startPos = offsetToPosition(body, Math.min(safeStart, safeEnd));
  const endPos = offsetToPosition(body, Math.max(safeStart, safeEnd));
  return new vscode.Range(startPos, endPos);
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  const slice = text.slice(0, offset);
  const lineBreaks = slice.match(/\r?\n/g);
  const line = lineBreaks ? lineBreaks.length : 0;
  const lastLineBreakIndex = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('\r'));
  const column = offset - (lastLineBreakIndex >= 0 ? lastLineBreakIndex + 1 : 0);
  return new vscode.Position(line, column);
}

function clampOffset(offset: number, max: number): number {
  if (Number.isNaN(offset) || offset < 0) {
    return 0;
  }
  if (offset > max) {
    return max;
  }
  return offset;
}
