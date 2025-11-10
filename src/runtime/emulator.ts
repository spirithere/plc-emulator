import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { LadderBranch, LadderElement, LadderRung, StructuredTextBlock } from '../types';
import { IOSimService } from '../io/ioService';
import { ProfileManager } from './profileManager';
import { StructuredTextDiagnosticEvent, StructuredTextRuntime } from './st/runtime';

export class EmulatorController {
  private scanHandle: NodeJS.Timeout | undefined;
  private readonly variables = new Map<string, number | boolean | string>();
  private readonly output = vscode.window.createOutputChannel('PLC Emulator');
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly stateEmitter = new vscode.EventEmitter<Record<string, number | boolean | string>>();
  private readonly runStateEmitter = new vscode.EventEmitter<boolean>();
  public readonly onDidUpdateState = this.stateEmitter.event;
  public readonly onDidChangeRunState = this.runStateEmitter.event;
  private running = false;
  private readonly stRuntime: StructuredTextRuntime;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly plcService: PLCopenService,
    private readonly ioService: IOSimService,
    private readonly profileManager: ProfileManager
  ) {
    this.statusItem.hide();
    this.stRuntime = new StructuredTextRuntime(this.ioService, message =>
      this.output.appendLine(`[StructuredText] ${message}`)
    );
    const disposable = this.plcService.onDidChangeModel(() => {
      this.stRuntime.invalidate();
    });
    this.disposables.push(disposable);
  }

  public start(): void {
    if (this.scanHandle) {
      vscode.window.showWarningMessage('PLC emulator is already running.');
      return;
    }

    this.seedVariables();
    const scanTime = vscode.workspace.getConfiguration('plcEmu').get<number>('scanTimeMs') ?? 100;
    this.output.appendLine(`[Emulator] Starting scan cycle (${scanTime} ms) using profile ${this.profileManager.getActiveProfile().title}`);
    this.statusItem.text = `PLC ▶︎ ${scanTime}ms`;
    this.statusItem.show();
    this.running = true;
    this.runStateEmitter.fire(true);

    this.scanHandle = setInterval(() => this.scanCycle(), scanTime);
  }

  public stop(): void {
    if (this.scanHandle) {
      clearInterval(this.scanHandle);
      this.scanHandle = undefined;
      this.statusItem.hide();
      this.output.appendLine('[Emulator] Stopped.');
      this.running = false;
      this.runStateEmitter.fire(false);
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public writeVariable(identifier: string, value: number | boolean | string): void {
    this.variables.set(identifier, value);
  }

  public getVariableNames(): string[] {
    return Array.from(this.variables.keys());
  }

  public onStructuredTextDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): vscode.Disposable {
    const dispose = this.stRuntime.onDiagnostics(listener);
    return { dispose };
  }

  private scanCycle(): void {
    const pous = this.plcService.getStructuredTextBlocks();
    this.stRuntime.execute(pous, this.variables);
    this.executeLadder();
    const snapshot = Object.fromEntries(this.variables);
    this.output.appendLine(`[Emulator] Scan complete. Vars: ${JSON.stringify(snapshot)}`);
    this.stateEmitter.fire(snapshot);
  }

  private executeLadder(): void {
    const rungs = this.plcService.getLadderRungs();
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
        this.ioService.setOutputValue(el.label, energized);
        next = incoming; // power rail continues past coils
      }

      startPower[i + 1] = startPower[i + 1] || next;
    }
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
        this.ioService.setOutputValue(element.label, energized);
      }
    });
    return powerRail;
  }

  private isElementConductive(element: LadderElement): boolean {
    if (element.type === 'coil') {
      return true;
    }
    const raw = this.resolveSignal(element.label, element.state ?? true, element.addrType);
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

  private resolveSignal(label: string, fallback: boolean, addrType?: 'X'|'M'|'Y'): boolean {
    const addr = addrType || this.inferAddrType(label);
    if (addr === 'X') {
      const ioValue = this.ioService.getInputValue(label);
      if (ioValue !== undefined) return ioValue;
    }
    if (!this.variables.has(label)) {
      this.variables.set(label, fallback);
    }
    const value = this.variables.get(label);
    if (typeof value === 'number') return value !== 0;
    return Boolean(value);
  }

  private seedVariables(): void {
    this.variables.clear();
    this.stRuntime.reset();
    const blocks = this.plcService.getStructuredTextBlocks();
    this.stRuntime.seed(blocks, this.variables);
  }

  public dispose(): void {
    this.stop();
    this.statusItem.dispose();
    this.output.dispose();
    this.disposables.forEach(disposable => disposable.dispose());
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) return undefined;
    const c = String(identifier).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') return c;
    return undefined;
  }
}

type BranchRuntimeData = {
  branch: LadderBranch;
  conductive: boolean[];
  fullyConductive: boolean;
  suffixReach: boolean[];
};
