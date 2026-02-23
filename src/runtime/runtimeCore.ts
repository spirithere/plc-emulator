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
  private readonly instructionState = new Map<string, Record<string, unknown>>();

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
    this.instructionState.clear();
    this.stRuntime.reset();
    const allPous = this.getStructuredTextBlocks().filter(pou => this.isExecutableStructuredText(pou));
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
    const pous = this.getStructuredTextBlocks()
      .filter(pou => this.isExecutableStructuredText(pou))
      .filter(b => (b.pouType ?? 'program') === 'program');
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
    if (this.shouldUseGraphExecution(rung)) {
      this.executeGraphRung(rung);
      return;
    }

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
      } else {
        // Non-boolean instruction nodes are currently treated as pass-through in
        // the simplified runtime while preserving visual/import fidelity.
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
    if (element.type === 'coil' || element.type === 'instruction') {
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

  private shouldUseGraphExecution(rung: LadderRung): boolean {
    return rung.elements.some(element => element.type === 'instruction' || Boolean((element as any).metadata?.connectionPointIn));
  }

  private executeGraphRung(rung: LadderRung): void {
    const elementById = new Map<string, LadderElement>();
    rung.elements.forEach(element => {
      if (element.id) {
        elementById.set(String(element.id), element);
      }
    });

    const outputCache = new Map<string, unknown>();
    const visiting = new Set<string>();
    const evalById = (id: string): unknown => {
      if (outputCache.has(id)) {
        return outputCache.get(id);
      }
      if (visiting.has(id)) {
        return false;
      }
      if (id === '0') {
        outputCache.set(id, true);
        return true;
      }
      const element = elementById.get(id);
      if (!element) {
        return false;
      }
      visiting.add(id);
      const result = this.evaluateGraphElement(element, evalById);
      visiting.delete(id);
      outputCache.set(id, result);
      return result;
    };

    rung.elements.forEach(element => {
      if (element.type === 'coil') {
        void evalById(String(element.id));
      }
    });
  }

  private evaluateGraphElement(
    element: LadderElement,
    evalById: (id: string) => unknown
  ): unknown {
    const metadata = (element as any).metadata;
    const incoming = this.toBoolean(this.resolveIncomingGraphValue(metadata?.connectionPointIn, evalById, true));

    if (element.type === 'contact') {
      const raw = this.resolveSignal(element.label, element.state ?? true, (element as any).addrType);
      const closed = element.variant === 'nc' ? !raw : raw;
      return incoming && closed;
    }

    if (element.type === 'coil') {
      const energized = incoming;
      this.variables.set(element.label, energized);
      this.options.ioAdapter.setOutputValue(element.label, energized);
      return energized;
    }

    return this.evaluateInstructionElement(element, metadata, evalById, incoming);
  }

  private evaluateInstructionElement(
    element: LadderElement,
    metadata: any,
    evalById: (id: string) => unknown,
    incoming: boolean
  ): unknown {
    const kind = (element.instructionKind ?? '').toLowerCase();
    if (kind === 'invariable') {
      return this.readInstructionExpressionValue(element.label);
    }
    if (kind === 'label' || kind === 'jump') {
      return incoming;
    }
    if (kind !== 'block') {
      return incoming;
    }

    const typeName = String(metadata?.typeName ?? metadata?.['@_typeName'] ?? '').toUpperCase();
    const instanceName = String(metadata?.instanceName ?? metadata?.['@_instanceName'] ?? '').trim();
    const stateKey = `${typeName}:${instanceName || element.id}`;
    const state = this.getInstructionState(stateKey);

    const readInput = (...candidates: string[]): unknown => {
      const variables = this.ensureArray(metadata?.inputVariables?.variable);
      for (const variable of variables) {
        const formal = String(variable?.formalParameter ?? variable?.['@_formalParameter'] ?? '').toUpperCase();
        if (!candidates.some(candidate => candidate.toUpperCase() === formal)) {
          continue;
        }
        const ref = this.extractConnectionRef(variable?.connectionPointIn);
        if (!ref) {
          continue;
        }
        return evalById(ref);
      }
      return undefined;
    };

    if (typeName === 'TON') {
      const inVal = this.toBoolean(readInput('IN'));
      const ptMs = this.toDurationMs(readInput('PT'));
      const elapsed = Number(state.elapsedMs ?? 0);
      const nextElapsed = inVal ? elapsed + this.currentScanTimeMs : 0;
      const q = inVal && nextElapsed >= ptMs;
      state.elapsedMs = nextElapsed;
      state.q = q;
      if (instanceName) {
        this.variables.set(`${instanceName}.Q`, q);
      }
      return q;
    }

    if (typeName === 'BLINK') {
      const enable = this.toBoolean(readInput('ENABLE', 'EN'));
      const lowMs = this.toDurationMs(readInput('TIMELOW', 'TL'));
      const highMs = this.toDurationMs(readInput('TIMEHIGH', 'TH'));
      let phase = this.toBoolean(state.phaseHigh ?? true);
      let elapsed = Number(state.elapsedMs ?? 0);
      let out = false;

      if (!enable) {
        phase = true;
        elapsed = 0;
        out = false;
      } else {
        elapsed += this.currentScanTimeMs;
        const threshold = phase ? highMs : lowMs;
        if (elapsed >= threshold) {
          elapsed = 0;
          phase = !phase;
        }
        out = phase;
      }

      state.phaseHigh = phase;
      state.elapsedMs = elapsed;
      state.out = out;
      if (instanceName) {
        this.variables.set(`${instanceName}.OUT`, out);
      }
      return out;
    }

    return incoming;
  }

  private resolveIncomingGraphValue(
    connectionPointInNode: any,
    evalById: (id: string) => unknown,
    fallback: boolean
  ): unknown {
    const ref = this.extractConnectionRef(connectionPointInNode);
    if (!ref) {
      return fallback;
    }
    return evalById(ref);
  }

  private extractConnectionRef(connectionPointInNode: any): string | undefined {
    const connection = this.ensureArray(connectionPointInNode?.connection)[0];
    if (!connection) {
      return undefined;
    }
    const ref = connection?.refLocalId ?? connection?.['@_refLocalId'] ?? connection?.refLocalID ?? connection?.['@_refLocalID'];
    if (ref === undefined || ref === null) {
      return undefined;
    }
    const text = String(ref).trim();
    return text.length > 0 ? text : undefined;
  }

  private getInstructionState(key: string): Record<string, unknown> {
    const existing = this.instructionState.get(key);
    if (existing) {
      return existing;
    }
    const created: Record<string, unknown> = {};
    this.instructionState.set(key, created);
    return created;
  }

  private readInstructionExpressionValue(expression: string): unknown {
    const text = String(expression ?? '').trim();
    if (!text) {
      return 0;
    }
    if (/^(TRUE|FALSE)$/i.test(text)) {
      return text.toUpperCase() === 'TRUE';
    }
    const asNumber = Number(text);
    if (!Number.isNaN(asNumber)) {
      return asNumber;
    }
    if (this.variables.has(text)) {
      return this.variables.get(text);
    }
    const ioValue = this.options.ioAdapter.getInputValue(text);
    if (ioValue !== undefined) {
      return ioValue;
    }
    return text;
  }

  private toDurationMs(value: unknown): number {
    if (typeof value === 'number') {
      return Math.max(0, value);
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const text = String(value ?? '').trim();
    if (!text) {
      return 0;
    }
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) {
      return Math.max(0, Number.parseFloat(text));
    }
    const normalized = text.replace(/^T(?:IME)?#/i, '').toLowerCase();
    let total = 0;
    const pattern = /([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const amount = Number.parseFloat(match[1]);
      const unit = match[2];
      if (!Number.isFinite(amount)) {
        continue;
      }
      if (unit === 'ms') {
        total += amount;
      } else if (unit === 's') {
        total += amount * 1000;
      } else if (unit === 'm') {
        total += amount * 60_000;
      } else if (unit === 'h') {
        total += amount * 3_600_000;
      }
    }
    return Math.max(0, total);
  }

  private ensureArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined || value === null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
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

  private isExecutableStructuredText(pou: StructuredTextBlock): boolean {
    return (pou.language ?? 'ST') === 'ST' || (pou.language ?? 'ST') === 'Mixed';
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
