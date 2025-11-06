import { StructuredTextBlock } from '../../types';
import { IOSimService } from '../../io/ioService';
import { parseStructuredText, ParseDiagnostic } from './astBuilder';
import { ProgramNode, VarDeclarationNode, VarSectionNode, VarSectionType } from './ast';
import { ExecutionEnv, StValue, StructuredTextInterpreter } from './interpreter';

type MemoryValue = number | boolean | string;

interface BlockCacheEntry {
  sourceHash: string;
  program?: ProgramNode;
  diagnostics: ParseDiagnostic[];
  varSections: VarSectionNode[];
  persistentVars: VarDeclarationNode[];
  tempVars: VarDeclarationNode[];
  initialized: boolean;
  canonicalNames: Map<string, string>;
  tempVarNames: Set<string>;
  sectionByName: Map<string, VarSectionType>;
  runtimeDiagnostics: RuntimeDiagnostic[];
  lastDiagnosticsSignature?: string;
}

export type RuntimeDiagnosticSeverity = 'error' | 'warning';

export interface RuntimeDiagnostic {
  message: string;
  severity: RuntimeDiagnosticSeverity;
  source: 'parser' | 'runtime';
  startOffset?: number;
  endOffset?: number;
}

export interface StructuredTextDiagnosticEvent {
  blockName: string;
  blockBody?: string;
  diagnostics: RuntimeDiagnostic[];
}

export class StructuredTextRuntime {
  private readonly cache = new Map<string, BlockCacheEntry>();
  private readonly interpreter: StructuredTextInterpreter;
  private readonly diagnosticsListeners = new Set<(event: StructuredTextDiagnosticEvent) => void>();

  constructor(
    private readonly ioService: IOSimService,
    private readonly log: (message: string) => void = () => {}
  ) {
    this.interpreter = new StructuredTextInterpreter(message => this.log(message));
  }

  public reset(): void {
    this.cache.forEach(entry => {
      entry.initialized = false;
    });
  }

  public invalidate(blockName?: string): void {
    if (blockName) {
      const existing = this.cache.get(blockName);
      if (existing) {
        this.cache.delete(blockName);
        this.emitDiagnostics({ blockName, blockBody: undefined, diagnostics: [] });
      }
    } else {
      const blockNames = Array.from(this.cache.keys());
      this.cache.clear();
      blockNames.forEach(name => this.emitDiagnostics({ blockName: name, blockBody: undefined, diagnostics: [] }));
    }
  }

  public seed(blocks: StructuredTextBlock[], memory: Map<string, MemoryValue>): void {
    blocks.forEach(block => {
      const entry = this.getOrParse(block);
      this.emitSnapshot(block, entry);
      if (entry.diagnostics.length > 0 || !entry.program) {
        return;
      }
      this.ensureInitialized(entry, memory);
    });
  }

  public execute(blocks: StructuredTextBlock[], memory: Map<string, MemoryValue>): void {
    blocks.forEach(block => {
      const entry = this.getOrParse(block);
      this.emitSnapshot(block, entry);
      if (entry.diagnostics.length > 0 || !entry.program) {
        return;
      }
      this.runProgram(block, entry, memory);
    });
  }

  private getOrParse(block: StructuredTextBlock): BlockCacheEntry {
    const existing = this.cache.get(block.name);
    if (existing && existing.sourceHash === block.body) {
      return existing;
    }

    const parseResult = parseStructuredText(block.body);
    let program: ProgramNode | undefined;
    let diagnostics = parseResult.diagnostics;
    if (parseResult.program) {
      program = parseResult.program;
    }

    const varSections = program?.varSections ?? [];
    const persistentVars: VarDeclarationNode[] = [];
    const tempVars: VarDeclarationNode[] = [];
    const canonicalNames = new Map<string, string>();
    const tempVarNames = new Set<string>();
    const sectionByName = new Map<string, VarSectionType>();

    varSections.forEach(section => {
      section.declarations.forEach(declaration => {
        const canonical = declaration.name;
        const key = this.normalize(canonical);
        canonicalNames.set(key, canonical);
        sectionByName.set(key, section.section);
        if (section.section === 'VAR_TEMP') {
          tempVars.push(declaration);
          tempVarNames.add(key);
        } else {
          persistentVars.push(declaration);
        }
      });
    });

    const entry: BlockCacheEntry = {
      sourceHash: block.body,
      program,
      diagnostics,
      varSections,
      persistentVars,
      tempVars,
      initialized: false,
      canonicalNames,
      tempVarNames,
      sectionByName,
      runtimeDiagnostics: [],
      lastDiagnosticsSignature: undefined
    };

    this.cache.set(block.name, entry);
    return entry;
  }

  private ensureInitialized(entry: BlockCacheEntry, memory: Map<string, MemoryValue>): void {
    if (entry.initialized || !entry.program) {
      return;
    }

    const tempMemory = new Map<string, StValue>();
    const env = this.createExecutionEnv(entry, memory, tempMemory);

    entry.persistentVars.forEach(declaration => {
      const key = this.resolveKey(entry, declaration.name, memory);
      if (key !== undefined && memory.has(key)) {
        return;
      }

      const value =
        declaration.initializer !== undefined
          ? this.interpreter.evaluate(declaration.initializer, env)
          : this.defaultValueForType(declaration.dataType);
      env.write([declaration.name], value);
    });

    entry.initialized = true;
  }

  private runProgram(block: StructuredTextBlock, entry: BlockCacheEntry, memory: Map<string, MemoryValue>): void {
    if (!entry.program) {
      return;
    }

    const tempMemory = new Map<string, StValue>();
    const env = this.createExecutionEnv(entry, memory, tempMemory);

    // Initialize VAR_TEMP on each execution
    entry.tempVars.forEach(declaration => {
      const value =
        declaration.initializer !== undefined
          ? this.interpreter.evaluate(declaration.initializer, env)
          : this.defaultValueForType(declaration.dataType);
      env.write([declaration.name], value);
    });

    try {
      this.interpreter.execute(entry.program, env);
      if (entry.runtimeDiagnostics.length > 0) {
        entry.runtimeDiagnostics = [];
        this.emitSnapshot(block, entry);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Runtime error in ${block.name}: ${message}`);
      entry.runtimeDiagnostics = [
        {
          message,
          severity: 'error',
          source: 'runtime'
        }
      ];
      this.emitSnapshot(block, entry);
    }
  }

  public onDiagnostics(listener: (event: StructuredTextDiagnosticEvent) => void): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  private createExecutionEnv(
    entry: BlockCacheEntry,
    memory: Map<string, MemoryValue>,
    tempMemory: Map<string, StValue>
  ): ExecutionEnv {
    const runtime = this;
    return {
      read(path: string[], indices?: number[]): StValue | undefined {
        return runtime.readValue(entry, memory, tempMemory, path, indices);
      },
      write(path: string[], value: StValue, indices?: number[]): void {
        runtime.writeValue(entry, memory, tempMemory, path, value, indices);
      },
      callFunction(path: string[], args: StValue[]): StValue | undefined {
        return runtime.invokeFunction(path, args);
      },
      logDiagnostics: message => this.log(message)
    };
  }

  private readValue(
    entry: BlockCacheEntry,
    memory: Map<string, MemoryValue>,
    tempMemory: Map<string, StValue>,
    path: string[],
    indices?: number[]
  ): StValue | undefined {
    if (indices && indices.length > 0) {
      this.log('Array access is not yet supported in the ST runtime.');
      return undefined;
    }

    const key = this.resolveKey(entry, path[path.length - 1], tempMemory) ?? this.resolveKey(entry, path[path.length - 1], memory);
    if (key && tempMemory.has(key)) {
      return tempMemory.get(key);
    }
    if (key && memory.has(key)) {
      return memory.get(key);
    }

    const identifier = path[path.length - 1];
    const addrType = this.inferAddrType(identifier);
    if (addrType === 'X') {
      const ioValue = this.ioService.getInputValue(identifier);
      if (ioValue !== undefined) {
        return ioValue ? 1 : 0;
      }
    }
    return undefined;
  }

  private writeValue(
    entry: BlockCacheEntry,
    memory: Map<string, MemoryValue>,
    tempMemory: Map<string, StValue>,
    path: string[],
    value: StValue,
    indices?: number[]
  ): void {
    if (indices && indices.length > 0) {
      this.log('Array assignment is not yet supported in the ST runtime.');
      return;
    }

    const identifier = path[path.length - 1];
    const key = this.resolveKey(entry, identifier, entry.tempVarNames.has(this.normalize(identifier)) ? tempMemory : memory) ?? identifier;
    const normalizedKey = key;
    const isTemp = entry.tempVarNames.has(this.normalize(identifier));

    if (isTemp) {
      tempMemory.set(normalizedKey, value);
      return;
    }

    memory.set(normalizedKey, value);

    const boolValue = this.toBoolean(value);
    this.ioService.setOutputValue(identifier, boolValue);
  }

  private resolveKey(
    entry: BlockCacheEntry,
    identifier: string,
    map: Map<string, unknown>
  ): string | undefined {
    const existingKey = this.findKeyCaseInsensitive(map, identifier);
    if (existingKey) {
      return existingKey;
    }
    const canonical = entry.canonicalNames.get(this.normalize(identifier));
    return canonical ?? identifier;
  }

  private findKeyCaseInsensitive(map: Map<string, unknown>, key: string): string | undefined {
    if (map.has(key)) {
      return key;
    }
    const lowerKey = key.toLowerCase();
    for (const entryKey of map.keys()) {
      if (entryKey.toLowerCase() === lowerKey) {
        return entryKey;
      }
    }
    return undefined;
  }

  private inferAddrType(identifier: string): 'X' | 'M' | 'Y' | undefined {
    if (!identifier || identifier.length === 0) {
      return undefined;
    }

    const first = identifier.trim().toUpperCase()[0];
    if (first === 'X' || first === 'M' || first === 'Y') {
      return first;
    }
    return undefined;
  }

  private defaultValueForType(dataType: string): StValue {
    const upper = dataType.toUpperCase();
    if (upper.includes('BOOL')) {
      return false;
    }
    if (upper.includes('INT') || upper.includes('REAL') || upper.includes('DINT') || upper.includes('WORD')) {
      return 0;
    }
    if (upper.includes('STRING')) {
      return '';
    }
    return 0;
  }

  private toBoolean(value: StValue): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'off') {
      return false;
    }
    return normalized.length > 0;
  }

  private invokeFunction(path: string[], args: StValue[]): StValue | undefined {
    const name = path[path.length - 1]?.toUpperCase();
    switch (name) {
      case 'ABS':
        return Math.abs(this.toNumber(args[0] ?? 0));
      case 'MIN':
        return args.reduce((acc, current) => (this.toNumber(current) < this.toNumber(acc) ? current : acc));
      case 'MAX':
        return args.reduce((acc, current) => (this.toNumber(current) > this.toNumber(acc) ? current : acc));
      case 'LIMIT': {
        const lo = this.toNumber(args[0] ?? 0);
        const hi = this.toNumber(args[1] ?? 0);
        const value = this.toNumber(args[2] ?? 0);
        return Math.min(Math.max(value, lo), hi);
      }
      default:
        throw new Error(`Unsupported function ${name ?? 'UNKNOWN'}`);
    }
  }

  private toNumber(value: StValue): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private normalize(value: string): string {
    return value.toUpperCase();
  }

  private emitSnapshot(block: StructuredTextBlock, entry: BlockCacheEntry): void {
    const diagnostics: RuntimeDiagnostic[] = [
      ...entry.diagnostics.map(diag => ({
        message: diag.message,
        severity: 'error' as const,
        source: 'parser' as const,
        startOffset: diag.startOffset,
        endOffset: diag.endOffset
      })),
      ...entry.runtimeDiagnostics
    ];

    const signature = JSON.stringify(
      diagnostics.map(d => [d.message, d.severity, d.source, d.startOffset ?? null, d.endOffset ?? null])
    );

    if (signature === entry.lastDiagnosticsSignature) {
      return;
    }

    entry.lastDiagnosticsSignature = signature;

    if (diagnostics.length > 0) {
      diagnostics.forEach(diag => {
        this.log(`ST diagnostic in ${block.name}: ${diag.message}`);
      });
    }

    this.emitDiagnostics({
      blockName: block.name,
      blockBody: block.body,
      diagnostics
    });
  }

  private emitDiagnostics(event: StructuredTextDiagnosticEvent): void {
    this.diagnosticsListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        this.log(`Diagnostics listener threw: ${(error as Error).message}`);
      }
    });
  }
}
