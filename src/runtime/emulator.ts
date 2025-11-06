import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { LadderElement, LadderRung, StructuredTextBlock } from '../types';
import { IOSimService } from '../io/ioService';
import { ProfileManager } from './profileManager';

export class EmulatorController {
  private scanHandle: NodeJS.Timeout | undefined;
  private readonly variables = new Map<string, number | boolean>();
  private readonly output = vscode.window.createOutputChannel('PLC Emulator');
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly stateEmitter = new vscode.EventEmitter<Record<string, number | boolean>>();
  private readonly runStateEmitter = new vscode.EventEmitter<boolean>();
  public readonly onDidUpdateState = this.stateEmitter.event;
  public readonly onDidChangeRunState = this.runStateEmitter.event;
  private running = false;

  constructor(
    private readonly plcService: PLCopenService,
    private readonly ioService: IOSimService,
    private readonly profileManager: ProfileManager
  ) {
    this.statusItem.hide();
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

  public writeVariable(identifier: string, value: number | boolean): void {
    this.variables.set(identifier, value);
  }

  private scanCycle(): void {
    const pous = this.plcService.getStructuredTextBlocks();
    pous.forEach(block => this.executeStructuredText(block));
    this.executeLadder();
    const snapshot = Object.fromEntries(this.variables);
    this.output.appendLine(`[Emulator] Scan complete. Vars: ${JSON.stringify(snapshot)}`);
    this.stateEmitter.fire(snapshot);
  }

  private executeStructuredText(block: StructuredTextBlock): void {
    const lines = block.body.split(/\r?\n/);
    const assignmentRegex = /(\w+)\s*:=\s*([^;]+);/;
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('VAR') || trimmed.startsWith('END_VAR')) {
        return;
      }

      const match = trimmed.match(assignmentRegex);
      if (!match) {
        return;
      }

      const [, variable, expression] = match;
      const value = this.evaluateExpression(expression.trim());
      this.variables.set(variable, value);
      this.ioService.setOutputValue(variable, value !== 0);
    });
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

    const byStart = new Map<number, LadderRung['branches']>();
    rung.branches?.forEach(br => {
      const list = byStart.get(br.startColumn) ?? [];
      list.push(br);
      byStart.set(br.startColumn, list);
    });

    for (let i = 0; i < cols; i += 1) {
      const incoming = startPower[i];

      const branches = byStart.get(i) ?? [];
      for (const br of branches) {
        const branchOut = this.executeSeries(br.elements, incoming);
        const endIdx = Math.min(Math.max(br.endColumn, i + 1), cols);
        startPower[endIdx] = startPower[endIdx] || branchOut;
      }

      const el = elements[i];
      let next = incoming;
      if (el.type === 'contact') {
        const raw = this.resolveSignal(el.label, el.state ?? true, (el as any).addrType);
        const closed = el.variant === 'nc' ? !raw : raw;
        next = incoming && closed;
      } else if (el.type === 'coil') {
        this.variables.set(el.label, incoming);
        this.ioService.setOutputValue(el.label, incoming);
        next = incoming; // power rail continues past coils
      }

      startPower[i + 1] = startPower[i + 1] || next;
    }
  }

  private executeSeries(elements: LadderElement[], initialPower: boolean): boolean {
    let powerRail = initialPower;
    elements.forEach(element => {
      if (element.type === 'contact') {
        const rawSignal = this.resolveSignal(element.label, element.state ?? true, (element as any).addrType);
        const isClosed = element.variant === 'nc' ? !rawSignal : rawSignal;
        powerRail = powerRail && isClosed;
      } else if (element.type === 'coil') {
        this.variables.set(element.label, powerRail);
        this.ioService.setOutputValue(element.label, powerRail);
      }
    });
    return powerRail;
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

  private evaluateExpression(expression: string): number {
    const sanitized = expression.replace(/[^0-9A-Za-z_+\-*/(). ]/g, '');
    const substituted = sanitized.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, identifier) => {
      const value = this.getSymbolValue(identifier);
      if (value === undefined) {
        return '0';
      }
      return typeof value === 'number' ? String(value) : value ? '1' : '0';
    });

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${substituted});`);
      const result = fn();
      if (typeof result === 'number' && Number.isFinite(result)) {
        return result;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private seedVariables(): void {
    this.variables.clear();
    const blocks = this.plcService.getStructuredTextBlocks();
    const initRegex = /(\w+)\s*:\s*\w+\s*:=\s*([^;]+);/;
    blocks.forEach(block => {
      block.body.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        const initMatch = trimmed.match(initRegex);
        if (initMatch) {
          const [, variable, expression] = initMatch;
          this.variables.set(variable, this.evaluateExpression(expression));
        }
      });
    });
  }

  private getSymbolValue(identifier: string): number | boolean | undefined {
    if (this.variables.has(identifier)) {
      return this.variables.get(identifier);
    }

    const ioValue = this.ioService.getInputValue(identifier);
    if (ioValue !== undefined) {
      return ioValue;
    }

    return undefined;
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) return undefined;
    const c = String(identifier).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') return c;
    return undefined;
  }
}
