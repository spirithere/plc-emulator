import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { IOSimService, IOStateSnapshot } from '../io/ioService';
import { StructuredTextDiagnosticEvent } from './st/runtime';
import { RuntimeController } from './emulator';
import { RuntimeHostAdapter } from './host/extensionAdapter';
import { LadderRung, StructuredTextBlock } from '../types';

interface HostNotification {
  method: string;
  params?: any;
}

export class ExternalRuntimeController implements RuntimeController {
  private readonly stateEmitter = new vscode.EventEmitter<Record<string, number | boolean | string>>();
  private readonly runStateEmitter = new vscode.EventEmitter<boolean>();
  private readonly diagnosticsEmitter = new vscode.EventEmitter<StructuredTextDiagnosticEvent>();
  private readonly variables = new Map<string, number | boolean | string>();
  private readyPromise: Promise<void> | undefined;
  private hostStarted = false;
  private readonly disposables: vscode.Disposable[] = [];
  private lastInputValues = new Map<string, boolean>();
  private disposed = false;

  public readonly onDidUpdateState = this.stateEmitter.event;
  public readonly onDidChangeRunState = this.runStateEmitter.event;

  constructor(
    private readonly plcService: PLCopenService,
    private readonly ioService: IOSimService,
    private readonly host: RuntimeHostAdapter
  ) {
    this.disposables.push(
      this.plcService.onDidChangeModel(() => {
        void this.syncProjectModel();
      }),
      this.ioService.onDidChangeState(snapshot => {
        void this.forwardInputChanges(snapshot);
      }),
      this.host.onNotification(event => this.handleNotification(event as HostNotification)),
      this.host.onExit(() => this.handleHostExit())
    );

    void this.syncProjectModel();
  }

  public async start(): Promise<void> {
    await this.syncProjectModel();
    const scanTime = vscode.workspace.getConfiguration('plcEmu').get<number>('scanTimeMs') ?? 100;
    await this.host.sendRequest('runtime.start', { scanTimeMs: scanTime });
    this.hostStarted = true;
  }

  public async stop(): Promise<void> {
    if (!this.hostStarted) {
      return;
    }
    await this.host.sendRequest('runtime.stop');
    this.hostStarted = false;
  }

  public isRunning(): boolean {
    return this.hostStarted;
  }

  public writeVariable(identifier: string, value: number | boolean | string): void {
    void (async () => {
      await this.ensureHostReady();
      await this.host.sendRequest('runtime.writeVar', { identifier, value });
    })();
  }

  public getVariableNames(): string[] {
    const names = new Set<string>();
    this.variables.forEach((_, key) => names.add(key));
    const ioState = this.ioService.getState();
    ioState.inputs.forEach(input => names.add(input.id));
    ioState.outputs.forEach(output => names.add(output.id));
    return Array.from(names);
  }

  public onStructuredTextDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): vscode.Disposable {
    return this.diagnosticsEmitter.event(listener);
  }

  public dispose(): void {
    this.disposed = true;
    this.stateEmitter.dispose();
    this.runStateEmitter.dispose();
    this.diagnosticsEmitter.dispose();
    this.disposables.forEach(disposable => disposable.dispose());
    void this.host.stop();
  }

  private async ensureHostReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.host.start();
    }
    await this.readyPromise;
  }

  private async syncProjectModel(): Promise<void> {
    await this.ensureHostReady();
    const pous = this.cloneStructuredText(this.plcService.getStructuredTextBlocks());
    const ladder = this.cloneLadderRungs(this.plcService.getLadderRungs());
    await this.host.sendRequest('project.load', { pous, ladder });
  }

  private async forwardInputChanges(snapshot: IOStateSnapshot): Promise<void> {
    await this.ensureHostReady();
    snapshot.inputs.forEach(input => {
      const previous = this.lastInputValues.get(input.id);
      if (previous === input.value) {
        return;
      }
      this.lastInputValues.set(input.id, input.value);
      void this.host.sendRequest('io.setInput', { identifier: input.id, value: input.value });
    });
  }

  private handleNotification(event: HostNotification): void {
    switch (event.method) {
      case 'runtime.state':
        this.consumeRuntimeState(event.params);
        break;
      case 'runtime.runState':
        this.consumeRunState(event.params);
        break;
      case 'structuredText.diagnostics':
        this.consumeDiagnostics(event.params);
        break;
      default:
        break;
    }
  }

  private handleHostExit(): void {
    if (this.disposed) {
      return;
    }
    this.hostStarted = false;
    this.readyPromise = undefined;
    this.runStateEmitter.fire(false);
    void this.syncProjectModel();
  }

  private consumeRuntimeState(event: { sequence: number; snapshot: Record<string, number | boolean | string>; io?: { inputs?: { id: string; value: boolean }[]; outputs?: { id: string; value: boolean }[] } }): void {
    if (!event || !event.snapshot) {
      return;
    }
    this.variables.clear();
    Object.entries(event.snapshot).forEach(([key, value]) => {
      this.variables.set(key, value);
      const boolValue = this.toBoolean(value);
      if (this.isOutputAddress(key)) {
        this.ioService.setOutputValue(key, boolValue);
      } else if (this.isInputAddress(key)) {
        this.ioService.setInputValue(key, boolValue);
      }
    });
    this.stateEmitter.fire(event.snapshot);

    const io = event.io;
    io?.inputs?.forEach(ch => this.ioService.setInputValue(ch.id, ch.value));
    io?.outputs?.forEach(ch => this.ioService.setOutputValue(ch.id, ch.value));
  }

  private consumeRunState(event: { running: boolean }): void {
    const running = Boolean(event?.running);
    this.hostStarted = running;
    this.runStateEmitter.fire(running);
  }

  private consumeDiagnostics(event: StructuredTextDiagnosticEvent): void {
    this.diagnosticsEmitter.fire(event);
  }

  private isOutputAddress(identifier: string): boolean {
    return typeof identifier === 'string' && identifier.trim().toUpperCase().startsWith('Y');
  }

  private isInputAddress(identifier: string): boolean {
    return typeof identifier === 'string' && identifier.trim().toUpperCase().startsWith('X');
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return Boolean(value);
  }

  private cloneStructuredText(blocks: StructuredTextBlock[]): StructuredTextBlock[] {
    return blocks.map(block => ({ ...block }));
  }

  private cloneLadderRungs(rungs: LadderRung[]): LadderRung[] {
    return rungs.map(rung => ({
      ...rung,
      elements: rung.elements.map(element => ({ ...element })),
      branches: rung.branches?.map(branch => ({
        ...branch,
        elements: branch.elements.map(element => ({ ...element }))
      }))
    }));
  }
}
