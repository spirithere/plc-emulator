import {
  DisposableLike,
  PlcModelProvider,
  RunStateListener,
  RuntimeIOAdapter,
  RuntimeLogEvent,
  RuntimeLogListener,
  RuntimeMetrics,
  RuntimeState,
  RuntimeStateEvent,
  RuntimeValue,
  RuntimeStateListener
} from './runtimeTypes';
import { StructuredTextRuntime, StructuredTextDiagnosticEvent } from './st/runtime';
import { Configuration, LadderBranch, LadderElement, LadderRung, StructuredTextBlock } from '../types';

export interface RuntimeCoreOptions {
  modelProvider: PlcModelProvider;
  ioAdapter: RuntimeIOAdapter;
  logger?: (event: RuntimeLogEvent) => void;
  defaultScanTimeMs?: number;
}

export class RuntimeCore {
  private readonly stRuntime: StructuredTextRuntime;
  private readonly variables = new Map<string, RuntimeValue>();
  private readonly stateListeners = new Set<RuntimeStateListener>();
  private readonly runStateListeners = new Set<RunStateListener>();
  private readonly logListeners = new Set<RuntimeLogListener>();
  private readonly diagnosticListeners = new Set<(event: StructuredTextDiagnosticEvent) => void>();
  private readonly disposables: DisposableLike[] = [];
  private scanHandle: NodeJS.Timeout | undefined;
  private running = false;
  private sequence = 0;
  private lastState: RuntimeState = {};
  private lastStateEvent: RuntimeStateEvent | undefined;
  private currentScanTimeMs: number;
  private totalScans = 0;
  private lastScanDurationMs = 0;
  private lastScanTimestamp: number | undefined;
  private scanErrorCount = 0;

  constructor(private readonly options: RuntimeCoreOptions) {
    this.currentScanTimeMs = options.defaultScanTimeMs ?? 100;
    this.stRuntime = new StructuredTextRuntime(options.ioAdapter, message =>
      this.emitLog({ level: 'info', scope: 'structuredText', message })
    );
    const disposeDiagnostics = this.stRuntime.onDiagnostics(event => this.emitDiagnostics(event));
    this.disposables.push({ dispose: disposeDiagnostics });

    const modelDisposable = this.options.modelProvider.onDidChangeModel(() => {
      this.stRuntime.invalidate();
    });
    this.disposables.push(modelDisposable);
  }

  public start(scanTimeMs?: number): boolean {
    if (this.scanHandle) {
      return false;
    }

    this.currentScanTimeMs = Math.max(10, scanTimeMs ?? this.currentScanTimeMs);
    this.seedVariables();
    this.lastState = this.snapshotMemory();
    this.lastStateEvent = {
      snapshot: this.lastState,
      sequence: this.sequence,
      timestamp: Date.now()
    };
    this.running = true;
    this.emitRunState(true);
    this.emitLog({
      level: 'info',
      scope: 'runtime',
      message: `Starting scan cycle (${this.currentScanTimeMs} ms)`
    });

    this.scanHandle = setInterval(() => this.safeScanCycle(), this.currentScanTimeMs);
    return true;
  }

  public stop(): void {
    if (this.scanHandle) {
      clearInterval(this.scanHandle);
      this.scanHandle = undefined;
      this.running = false;
      this.emitRunState(false);
      this.emitLog({ level: 'info', scope: 'runtime', message: 'Stopped runtime.' });
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getCurrentScanTime(): number {
    return this.currentScanTimeMs;
  }

  public writeVariable(identifier: string, value: number | boolean | string): void {
    const addr = this.inferAddrType(identifier);
    if (addr === 'X') {
      const boolValue = this.toBoolean(value);
      this.options.ioAdapter.setInputValue(identifier, boolValue);
      this.variables.set(identifier, boolValue);
      return;
    }
    if (addr === 'Y') {
      const boolValue = this.toBoolean(value);
      this.options.ioAdapter.setOutputValue(identifier, boolValue);
      this.variables.set(identifier, boolValue);
      return;
    }
    this.variables.set(identifier, value);
  }

  public getVariableNames(): string[] {
    return Array.from(this.variables.keys());
  }

  public getLastState(): RuntimeState {
    return this.lastState;
  }

  public getLastStateEvent(): RuntimeStateEvent | undefined {
    return this.lastStateEvent;
  }

  public reset(): RuntimeState {
    this.stop();
    this.sequence = 0;
    this.totalScans = 0;
    this.lastScanDurationMs = 0;
    this.lastScanTimestamp = undefined;
    this.scanErrorCount = 0;
    this.seedVariables();

    const snapshot = this.snapshotMemory();
    const event: RuntimeStateEvent = {
      snapshot,
      sequence: this.sequence,
      timestamp: Date.now()
    };

    this.lastState = snapshot;
    this.lastStateEvent = event;
    this.stateListeners.forEach(listener => listener(event));
    this.emitLog({ level: 'info', scope: 'runtime', message: 'Runtime reset.' });
    return snapshot;
  }

  public step(cycles = 1): RuntimeStateEvent | undefined {
    if (this.running) {
      throw new Error('Cannot step runtime while running.');
    }

    const normalizedCycles = Math.max(0, Math.floor(cycles));
    if (normalizedCycles === 0) {
      return undefined;
    }

    if (this.variables.size === 0) {
      this.seedVariables();
      this.lastState = this.snapshotMemory();
    }

    let lastEvent: RuntimeStateEvent | undefined;
    for (let i = 0; i < normalizedCycles; i += 1) {
      lastEvent = this.scanCycle();
    }
    return lastEvent;
  }

  public getMetrics(): RuntimeMetrics {
    return {
      running: this.running,
      currentScanTimeMs: this.currentScanTimeMs,
      sequence: this.sequence,
      totalScans: this.totalScans,
      lastScanDurationMs: this.lastScanDurationMs,
      lastScanTimestamp: this.lastScanTimestamp,
      scanErrorCount: this.scanErrorCount
    };
  }

  public onState(listener: RuntimeStateListener): DisposableLike {
    this.stateListeners.add(listener);
    return {
      dispose: () => this.stateListeners.delete(listener)
    };
  }

  public onRunState(listener: RunStateListener): DisposableLike {
    this.runStateListeners.add(listener);
    return {
      dispose: () => this.runStateListeners.delete(listener)
    };
  }

  public onLog(listener: RuntimeLogListener): DisposableLike {
    this.logListeners.add(listener);
    return {
      dispose: () => this.logListeners.delete(listener)
    };
  }

  public onStructuredTextDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): DisposableLike {
    this.diagnosticListeners.add(listener);
    return {
      dispose: () => this.diagnosticListeners.delete(listener)
    };
  }

  public dispose(): void {
    this.stop();
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables.length = 0;
  }

  /** @internal used by unit tests */
  public debugSeedVariables(): void {
    this.seedVariables();
  }

  /** @internal used by unit tests */
  public debugScanCycle(): void {
    this.scanCycle();
  }

  /** @internal used by unit tests */
  public debugGetMemory(): Map<string, RuntimeValue> {
    return this.variables;
  }

  private seedVariables(): void {
    this.variables.clear();
    this.stRuntime.reset();
    const allPous = this.getStructuredTextBlocks();
    const fbDefs = allPous.filter(b => (b.pouType ?? 'program') === 'functionBlock');
    this.stRuntime.setFunctionBlocks(fbDefs);
    this.seedGlobalVariables();
    this.registerFunctionBlockInstances(allPous, fbDefs);
    const blocks = allPous.filter(b => (b.pouType ?? 'program') === 'program');
    this.stRuntime.seed(blocks, this.variables);
  }

  private safeScanCycle(): void {
    try {
      this.scanCycle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.scanErrorCount += 1;
      this.emitLog({ level: 'error', scope: 'runtime', message: `Scan failed: ${message}` });
    }
  }

  private scanCycle(): RuntimeStateEvent {
    const startedAt = Date.now();
    const pous = this.getStructuredTextBlocks().filter(b => (b.pouType ?? 'program') === 'program');
    this.stRuntime.execute(pous, this.variables);
    this.stRuntime.executeFunctionBlocks(this.variables);
    this.executeLadder(this.getLadderRungs());
    // Run FBs again so ladder-updated FB inputs take effect in same scan
    this.stRuntime.executeFunctionBlocks(this.variables);

    const snapshot = this.snapshotMemory();
    this.lastState = snapshot;
    const event: RuntimeStateEvent = {
      snapshot,
      sequence: ++this.sequence,
      timestamp: Date.now()
    };
    this.totalScans += 1;
    this.lastScanTimestamp = event.timestamp;
    this.lastScanDurationMs = Math.max(0, Date.now() - startedAt);
    this.lastStateEvent = event;
    this.stateListeners.forEach(listener => listener(event));
    this.emitLog({
      level: 'info',
      scope: 'runtime',
      message: 'Scan complete.',
      details: { sequence: event.sequence }
    });
    return event;
  }

  private snapshotMemory(): RuntimeState {
    return Object.fromEntries(this.variables) as RuntimeState;
  }

  private executeLadder(rungs: LadderRung[]): void {
    rungs.forEach(rung => this.executeRung(rung));
  }

  private executeRung(rung: LadderRung): void {
    const elements = rung.elements;
    const cols = elements.length;
    const startPower: boolean[] = Array(cols + 1).fill(false);
    startPower[0] = true;

    const branchData: BranchRuntimeData[] = (rung.branches ?? []).map(branch => {
      const conductive = branch.elements.map(el => this.isElementConductive(el));
      return {
        branch,
        conductive,
        fullyConductive: conductive.every(Boolean),
        suffixReach: []
      };
    });

    const branchesByStart = new Map<number, BranchRuntimeData[]>();
    branchData.forEach(data => {
      const startColumn = this.clampColumn(data.branch.startColumn, cols, 0);
      const list = branchesByStart.get(startColumn) ?? [];
      list.push(data);
      branchesByStart.set(startColumn, list);
    });

    const elementConductive = elements.map(el => this.isElementConductive(el));
    const rightReach = this.computeRightReach(elements, elementConductive, branchesByStart, cols);

    branchData.forEach(data => {
      data.suffixReach = this.computeBranchSuffixReach(data.branch, data.conductive, rightReach, cols);
    });

    for (let i = 0; i < cols; i += 1) {
      const incoming = startPower[i];

      const branches = branchesByStart.get(i) ?? [];
      for (const br of branches) {
        const branchOut = this.executeSeries(br.branch.elements, incoming, br.suffixReach);
        const endIdx = this.clampColumn(br.branch.endColumn, cols, i + 1);
        startPower[endIdx] = startPower[endIdx] || branchOut;
      }

      const el = elements[i];
      let next = incoming;
      if (el.type === 'contact') {
        const raw = this.resolveSignal(el.label, el.state ?? true, (el as any).addrType);
        const closed = el.variant === 'nc' ? !raw : raw;
        next = incoming && closed;
      } else if (el.type === 'coil') {
        const canReachRight = rightReach[i + 1] ?? false;
        const energized = incoming && canReachRight;
        this.variables.set(el.label, energized);
        this.options.ioAdapter.setOutputValue(el.label, energized);
        next = incoming;
      }

      startPower[i + 1] = startPower[i + 1] || next;
    }
  }

  private seedGlobalVariables(): void {
    const configurations = this.getConfigurations();
    configurations?.forEach(config => {
      (config.globalVars ?? []).forEach(variable => {
        if (!variable?.name) {
          return;
        }
        if (variable.initialValue !== undefined && !this.variables.has(variable.name)) {
          this.variables.set(variable.name, variable.initialValue);
        }
        const direction =
          variable.ioDirection ??
          this.directionFromAddress(variable.address) ??
          (this.inferAddrType(variable.name) === 'X'
            ? 'input'
            : this.inferAddrType(variable.name) === 'Y'
              ? 'output'
              : undefined);
        if (direction === 'input') {
          this.options.ioAdapter.setInputValue(
            variable.address ?? variable.name,
            this.toBoolean(variable.initialValue ?? false)
          );
        } else if (direction === 'output') {
          this.options.ioAdapter.setOutputValue(
            variable.address ?? variable.name,
            this.toBoolean(variable.initialValue ?? false)
          );
        }
      });
    });
  }

  private executeSeries(elements: LadderElement[], initialPower: boolean, suffixReach?: boolean[]): boolean {
    let powerRail = initialPower;
    elements.forEach((element, idx) => {
      if (element.type === 'contact') {
        const rawSignal = this.resolveSignal(element.label, element.state ?? true, (element as any).addrType);
        const isClosed = element.variant === 'nc' ? !rawSignal : rawSignal;
        powerRail = powerRail && isClosed;
      } else if (element.type === 'coil') {
        const canReachRight = suffixReach ? suffixReach[idx + 1] : true;
        const energized = powerRail && canReachRight;
        this.variables.set(element.label, energized);
        this.options.ioAdapter.setOutputValue(element.label, energized);
      }
    });
    return powerRail;
  }

  private isElementConductive(element: LadderElement): boolean {
    if (element.type === 'coil') {
      return true;
    }
    const raw = this.resolveSignal(element.label, element.state ?? true, (element as any).addrType);
    return element.variant === 'nc' ? !raw : raw;
  }

  private computeRightReach(
    elements: LadderElement[],
    elementConductive: boolean[],
    branchesByStart: Map<number, BranchRuntimeData[]>,
    cols: number
  ): boolean[] {
    const rightReach = Array(cols + 1).fill(false);
    rightReach[cols] = true;

    for (let i = cols - 1; i >= 0; i -= 1) {
      const el = elements[i];
      const conductive = el.type === 'coil' ? true : elementConductive[i];
      let canReach = conductive && rightReach[i + 1];

      const branches = branchesByStart.get(i) ?? [];
      for (const br of branches) {
        const endColumn = this.clampColumn(br.branch.endColumn, cols, i + 1);
        if (br.fullyConductive && rightReach[endColumn]) {
          canReach = true;
          break;
        }
      }

      rightReach[i] = canReach;
    }

    return rightReach;
  }

  private computeBranchSuffixReach(
    branch: LadderBranch,
    conductive: boolean[],
    rightReach: boolean[],
    cols: number
  ): boolean[] {
    const len = branch.elements.length;
    const suffix = Array(len + 1).fill(false);
    const endColumn = this.clampColumn(branch.endColumn, cols, 0);
    suffix[len] = rightReach[endColumn];

    for (let idx = len - 1; idx >= 0; idx -= 1) {
      suffix[idx] = conductive[idx] && suffix[idx + 1];
    }

    return suffix;
  }

  private clampColumn(column: number, cols: number, min = 0): number {
    const lower = Math.max(0, Math.min(min, cols));
    const value = Number.isFinite(column) ? column : 0;
    return Math.min(Math.max(value, lower), cols);
  }

  private resolveSignal(label: string, fallback: boolean, addrType?: 'X' | 'M' | 'Y'): boolean {
    const addr = addrType || this.inferAddrType(label);
    if (addr === 'X') {
      const ioValue = this.options.ioAdapter.getInputValue(label);
      if (ioValue !== undefined) {
        this.variables.set(label, ioValue);
        return ioValue;
      }
    }
    const directIo = this.options.ioAdapter.getInputValue(label);
    if (directIo !== undefined) {
      this.variables.set(label, directIo);
      return directIo;
    }
    if (!this.variables.has(label)) {
      this.variables.set(label, fallback);
    }
    const value = this.variables.get(label);
    if (typeof value === 'number') {
      return value !== 0;
    }
    return Boolean(value);
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) {
      return undefined;
    }
    const c = String(identifier).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') {
      return c;
    }
    return undefined;
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

  private emitRunState(running: boolean): void {
    this.runStateListeners.forEach(listener => listener(running));
  }

  private emitDiagnostics(event: StructuredTextDiagnosticEvent): void {
    this.diagnosticListeners.forEach(listener => listener(event));
  }

  private emitLog(event: RuntimeLogEvent): void {
    this.options.logger?.(event);
    this.logListeners.forEach(listener => listener(event));
  }

  private directionFromAddress(address?: string): 'input' | 'output' | 'memory' | undefined {
    if (!address) return undefined;
    const normalized = address.trim().toUpperCase();
    if (normalized.startsWith('%I')) return 'input';
    if (normalized.startsWith('%Q')) return 'output';
    if (normalized.startsWith('%M')) return 'memory';
    return undefined;
  }

  private getConfigurations(): Configuration[] | undefined {
    return this.options.modelProvider.getConfigurations?.();
  }

  private getStructuredTextBlocks(): StructuredTextBlock[] {
    return this.options.modelProvider.getStructuredTextBlocks();
  }

  private getLadderRungs(): LadderRung[] {
    return this.options.modelProvider.getLadderRungs();
  }

  private registerFunctionBlockInstances(pous: StructuredTextBlock[], fbDefs: StructuredTextBlock[]): void {
    const fbNames = new Set(fbDefs.map(fb => fb.name));
    pous.forEach(pou => {
      const intf = pou.interface;
      if (!intf) return;
      const sections = [
        ...(intf.inputVars ?? []),
        ...(intf.outputVars ?? []),
        ...(intf.inOutVars ?? []),
        ...(intf.localVars ?? [])
      ];
      sections.forEach(v => {
        if (fbNames.has(v.dataType)) {
          this.stRuntime.registerFbInstance(v.name, v.dataType);
        }
      });
    });
  }
}

type BranchRuntimeData = {
  branch: LadderBranch;
  conductive: boolean[];
  fullyConductive: boolean;
  suffixReach: boolean[];
};
