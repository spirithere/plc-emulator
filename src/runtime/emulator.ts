import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { IOSimService } from '../io/ioService';
import { ProfileManager } from './profileManager';
import { StructuredTextDiagnosticEvent } from './st/runtime';
import { RuntimeCore } from './runtimeCore';
import { PlcModelProvider, RuntimeLogEvent, RuntimeStateEvent } from './runtimeTypes';

export interface RuntimeController extends vscode.Disposable {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  isRunning(): boolean;
  writeVariable(identifier: string, value: number | boolean | string): void;
  getVariableNames(): string[];
  readonly onDidUpdateState: vscode.Event<Record<string, number | boolean | string>>;
  readonly onDidChangeRunState: vscode.Event<boolean>;
  onStructuredTextDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): vscode.Disposable;
}

export class EmulatorController implements RuntimeController {
  private readonly output = vscode.window.createOutputChannel('PLC Emulator');
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly stateEmitter = new vscode.EventEmitter<Record<string, number | boolean | string>>();
  private readonly runStateEmitter = new vscode.EventEmitter<boolean>();
  private readonly runtime: RuntimeCore;
  private readonly disposables: vscode.Disposable[] = [];

  public readonly onDidUpdateState = this.stateEmitter.event;
  public readonly onDidChangeRunState = this.runStateEmitter.event;

  constructor(
    private readonly plcService: PLCopenService,
    private readonly ioService: IOSimService,
    private readonly profileManager: ProfileManager
  ) {
    this.statusItem.hide();
    this.runtime = new RuntimeCore({
      modelProvider: this.createModelProvider(),
      ioAdapter: this.ioService,
      logger: event => this.appendLog(event),
      defaultScanTimeMs: vscode.workspace.getConfiguration('plcEmu').get<number>('scanTimeMs') ?? 100
    });

    const stateDisposable = this.runtime.onState(event => this.handleState(event));
    const runDisposable = this.runtime.onRunState(running => this.handleRunState(running));

    this.disposables.push(this.toVsDisposable(stateDisposable), this.toVsDisposable(runDisposable));
  }

  public start(): void {
    const scanTime = vscode.workspace.getConfiguration('plcEmu').get<number>('scanTimeMs') ?? 100;
    const started = this.runtime.start(scanTime);
    if (!started) {
      void vscode.window.showWarningMessage('PLC emulator is already running.');
      return;
    }
    const profile = this.profileManager.getActiveProfile();
    this.output.appendLine(
      `[Emulator] Starting scan cycle (${this.runtime.getCurrentScanTime()} ms) using profile ${profile.title}`
    );
  }

  public stop(): void {
    if (!this.runtime.isRunning()) {
      return;
    }
    this.runtime.stop();
  }

  public isRunning(): boolean {
    return this.runtime.isRunning();
  }

  public writeVariable(identifier: string, value: number | boolean | string): void {
    this.runtime.writeVariable(identifier, value);
  }

  public getVariableNames(): string[] {
    return this.runtime.getVariableNames();
  }

  public onStructuredTextDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): vscode.Disposable {
    const disposable = this.runtime.onStructuredTextDiagnostics(listener);
    return this.toVsDisposable(disposable);
  }

  public dispose(): void {
    this.runtime.dispose();
    this.statusItem.dispose();
    this.output.dispose();
    this.disposables.forEach(disposable => disposable.dispose());
  }

  private handleState(event: RuntimeStateEvent): void {
    this.output.appendLine(`[Emulator] Scan ${event.sequence} Vars: ${JSON.stringify(event.snapshot)}`);
    this.stateEmitter.fire(event.snapshot);
  }

  private handleRunState(running: boolean): void {
    if (running) {
      this.statusItem.text = `PLC ▶︎ ${this.runtime.getCurrentScanTime()}ms`;
      this.statusItem.show();
    } else {
      this.statusItem.hide();
      this.output.appendLine('[Emulator] Stopped.');
    }
    this.runStateEmitter.fire(running);
  }

  private appendLog(event: RuntimeLogEvent): void {
    const prefix = `[${event.level.toUpperCase()}][${event.scope}]`;
    const details = event.details ? ` ${JSON.stringify(event.details)}` : '';
    this.output.appendLine(`${prefix} ${event.message}${details}`);
  }

  private createModelProvider(): PlcModelProvider {
    return {
      getStructuredTextBlocks: () => this.plcService.getStructuredTextBlocks(),
      getLadderRungs: () => this.plcService.getLadderRungs(),
      getConfigurations: () => this.plcService.getModel().configurations ?? [],
      onDidChangeModel: listener => {
        const disposable = this.plcService.onDidChangeModel(() => listener());
        return { dispose: () => disposable.dispose() };
      }
    };
  }

  /** @internal used by unit tests */
  private seedVariables(): void {
    this.runtime.debugSeedVariables();
  }

  /** @internal used by unit tests */
  private scanCycle(): void {
    this.runtime.debugScanCycle();
  }

  /** @internal used by unit tests */
  private get variables(): Map<string, number | boolean | string> {
    return this.runtime.debugGetMemory();
  }

  private toVsDisposable(disposable: { dispose(): void }): vscode.Disposable {
    return {
      dispose: () => disposable.dispose()
    };
  }
}
