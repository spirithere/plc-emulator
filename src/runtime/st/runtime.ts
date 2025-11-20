import { StructuredTextBlock } from '../../types';
import { RuntimeIOAdapter } from '../runtimeTypes';
import { parseStructuredText, ParseDiagnostic } from './astBuilder';
import { ProgramNode, VarDeclarationNode, VarSectionNode, VarSectionType } from './ast';
import { ExecutionEnv, StValue, StructuredTextInterpreter } from './interpreter';

type MemoryValue = number | boolean | string;
type MemoryValueMap = Map<string, MemoryValue>;

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
  addressByName: Map<string, string>;
  ioDirectionByName: Map<string, 'input' | 'output' | 'memory'>;
  constantNames: Set<string>;
  retainNames: Set<string>;
  persistentNames: Set<string>;
  runtimeDiagnostics: RuntimeDiagnostic[];
  lastDiagnosticsSignature?: string;
  typeByName: Map<string, string>;
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
  private readonly fbDefinitions = new Map<string, BlockCacheEntry>();
  private readonly fbInstances = new Map<string, { type: string; memory: MemoryValueMap }>();
  private readonly cache = new Map<string, BlockCacheEntry>();
  private readonly interpreter: StructuredTextInterpreter;
  private readonly diagnosticsListeners = new Set<(event: StructuredTextDiagnosticEvent) => void>();

  constructor(
    private readonly ioService: RuntimeIOAdapter,
    private readonly log: (message: string) => void = () => {}
  ) {
    this.interpreter = new StructuredTextInterpreter(message => this.log(message));
  }

  public setFunctionBlocks(blocks: StructuredTextBlock[]): void {
    this.fbDefinitions.clear();
    blocks.forEach(block => {
      const entry = this.getOrParse(block, true);
      if (entry.program) {
        this.fbDefinitions.set(block.name.toUpperCase(), entry);
      }
    });
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

  private getOrParse(block: StructuredTextBlock, isFunctionBlock = false): BlockCacheEntry {
    const cacheMap = isFunctionBlock ? this.fbDefinitions : this.cache;
    const existing = cacheMap.get(block.name);
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
    const typeByName = new Map<string, string>();
    const addressByName = new Map<string, string>();
    const ioDirectionByName = new Map<string, 'input' | 'output' | 'memory'>();
    const constantNames = new Set<string>();
    const retainNames = new Set<string>();
    const persistentNames = new Set<string>();

    varSections.forEach(section => {
      section.declarations.forEach(declaration => {
        const canonical = declaration.name;
        const key = this.normalize(canonical);
        canonicalNames.set(key, canonical);
        sectionByName.set(key, section.section);
        typeByName.set(key, declaration.dataType);
        if (declaration.address) {
          addressByName.set(key, declaration.address);
          const dir = this.inferIoDirection(declaration.address);
          if (dir) {
            ioDirectionByName.set(key, dir);
          }
        }
        if (!ioDirectionByName.has(key)) {
          const sectionDirection = this.directionFromSection(section.section);
          if (sectionDirection) {
            ioDirectionByName.set(key, sectionDirection);
          }
        }
        if (declaration.constant) {
          constantNames.add(key);
        }
        if (declaration.retain) {
          retainNames.add(key);
        }
        if (declaration.persistent) {
          persistentNames.add(key);
        }
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
      addressByName,
      ioDirectionByName,
      constantNames,
      retainNames,
      persistentNames,
      runtimeDiagnostics: [],
      lastDiagnosticsSignature: undefined,
      typeByName
    };

    cacheMap.set(block.name, entry);
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

      const normalized = this.normalize(declaration.name);
      const ioDirection = entry.ioDirectionByName.get(normalized);
      if (ioDirection === 'input' && declaration.initializer === undefined) {
        const address = entry.addressByName.get(normalized);
        const ioValue =
          (address ? this.ioService.getInputValue(address) : undefined) ??
          this.ioService.getInputValue(declaration.name);
        if (ioValue !== undefined) {
          env.write([declaration.name], ioValue ? 1 : 0);
          return;
        }
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

  public registerFbInstance(instanceName: string, fbType: string): void {
    this.ensureFbInstance(undefined, instanceName, fbType);
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

    if (path.length > 1) {
      const instanceName = path[0];
      const member = path[path.length - 1];
      const instance = this.ensureFbInstance(entry, instanceName);
      if (instance) {
        return instance.memory.get(member);
      }
    }

    const identifier = path[path.length - 1];
    const normalized = this.normalize(identifier);
    const key =
      this.resolveKey(entry, identifier, tempMemory) ?? this.resolveKey(entry, identifier, memory);
    if (key && tempMemory.has(key)) {
      return tempMemory.get(key);
    }
    if (key && memory.has(key)) {
      return memory.get(key);
    }
    const address = entry.addressByName.get(normalized);
    const ioDirection =
      entry.ioDirectionByName.get(normalized) ??
      this.inferIoDirection(address) ??
      (this.inferAddrType(identifier) === 'X' ? 'input' : undefined);
    if (ioDirection === 'input') {
      const ioValue =
        (address ? this.ioService.getInputValue(address) : undefined) ??
        this.ioService.getInputValue(identifier);
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

    if (path.length > 1) {
      const instanceName = path[0];
      const member = path[path.length - 1];
      const instance = this.ensureFbInstance(entry, instanceName, entry.typeByName.get(this.normalize(instanceName)));
      if (!instance) {
        return;
      }
      instance.memory.set(member, value as MemoryValue);
      // mirror into main memory for visibility
      const dotted = `${instanceName}.${member}`;
      memory.set(dotted, value as MemoryValue);
      return;
    }

    const identifier = path[path.length - 1];
    const normalizedName = this.normalize(identifier);
    const key =
      this.resolveKey(entry, identifier, entry.tempVarNames.has(normalizedName) ? tempMemory : memory) ??
      identifier;
    const normalizedKey = key;
    const isTemp = entry.tempVarNames.has(normalizedName);
    const dataType = entry.typeByName.get(normalizedName);
    const coercedValue = dataType ? this.coerceToType(value, dataType) : value;
    const address = entry.addressByName.get(normalizedName);

    const ioDirection =
      entry.ioDirectionByName.get(normalizedName) ??
      this.inferIoDirection(address) ??
      (() => {
        const addrType = this.inferAddrType(identifier);
        if (addrType === 'X') return 'input';
        if (addrType === 'Y') return 'output';
        return undefined;
      })();
    const isConstant = entry.constantNames.has(normalizedName);

    if (isTemp) {
      tempMemory.set(normalizedKey, coercedValue);
      return;
    }

    if (isConstant && memory.has(normalizedKey)) {
      // Do not overwrite constants after initialization.
      return;
    }

    memory.set(normalizedKey, coercedValue);

    const boolValue = this.toBoolean(coercedValue);
    if (ioDirection === 'input') {
      this.ioService.setInputValue(address ?? identifier, boolValue);
    } else if (ioDirection === 'output') {
      this.ioService.setOutputValue(address ?? identifier, boolValue);
    } else {
      // default behavior to keep compatibility with old style (Y prefix)
      this.ioService.setOutputValue(identifier, boolValue);
    }
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

  private inferIoDirection(address?: string): 'input' | 'output' | 'memory' | undefined {
    if (!address) {
      return undefined;
    }
    const normalized = address.trim().toUpperCase();
    if (normalized.startsWith('%I')) {
      return 'input';
    }
    if (normalized.startsWith('%Q')) {
      return 'output';
    }
    if (normalized.startsWith('%M')) {
      return 'memory';
    }
    return undefined;
  }

  private directionFromSection(section: VarSectionType): 'input' | 'output' | undefined {
    if (section === 'VAR_INPUT') {
      return 'input';
    }
    if (section === 'VAR_OUTPUT') {
      return 'output';
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

  private coerceToType(value: StValue, dataType: string): StValue {
    const upper = dataType.toUpperCase();
    if (upper.includes('BOOL')) {
      return this.toBoolean(value);
    }

    if (/(STRING|CHAR)/.test(upper)) {
      return String(value);
    }

    if (upper.includes('REAL') || upper.includes('LREAL')) {
      return this.toNumber(value);
    }

    if (/(INT|DINT|SINT|USINT|UINT|UDINT|LINT|ULINT|WORD|DWORD|LWORD|BYTE)/.test(upper)) {
      const integer = this.toInteger(value);
      const unsignedTypes = ['USINT', 'UINT', 'UDINT', 'ULINT', 'WORD', 'DWORD', 'LWORD', 'BYTE'];
      if (unsignedTypes.some(type => upper.includes(type))) {
        return integer < 0 ? 0 : integer;
      }
      return integer;
    }

    return value;
  }

  private toInteger(value: StValue): number {
    return Math.trunc(this.toNumber(value));
  }

  private invokeFunction(path: string[], args: StValue[]): StValue | undefined {
    const name = path[path.length - 1]?.toUpperCase();
    // Call to FB instance e.g. fbMotor()
    if (path.length === 1) {
      const inst = this.ensureFbInstance(undefined, path[0]);
      if (inst) {
        this.executeFunctionBlock(inst, path[0]);
        return undefined;
      }
    }
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

  public executeFunctionBlocks(memory: Map<string, MemoryValue>): void {
    this.fbInstances.forEach((instance, name) => {
      this.executeFunctionBlock(instance, name, memory);
    });
  }

  private ensureFbInstance(
    entry: BlockCacheEntry | undefined,
    instanceName: string,
    fbType?: string
  ): { type: string; memory: MemoryValueMap } | undefined {
    const key = instanceName.toUpperCase();
    const existing = this.fbInstances.get(key);
    if (existing) return existing;

    const typeName = fbType ?? entry?.typeByName.get(this.normalize(instanceName));
    if (!typeName) return undefined;
    const fbEntry = this.fbDefinitions.get(typeName.toUpperCase());
    if (!fbEntry || !fbEntry.program) return undefined;

    const memory: MemoryValueMap = new Map<string, MemoryValue>();
    fbEntry.persistentVars.forEach(declaration => {
      const value =
        declaration.initializer !== undefined
          ? this.defaultValueForType(declaration.dataType)
          : this.defaultValueForType(declaration.dataType);
      memory.set(declaration.name, value as MemoryValue);
    });
    const inst = { type: typeName, memory };
    this.fbInstances.set(key, inst);
    return inst;
  }

  private executeFunctionBlock(
    instance: { type: string; memory: MemoryValueMap },
    instanceName?: string,
    outerMemory?: Map<string, MemoryValue>
  ): void {
    const fbEntry = this.fbDefinitions.get(instance.type.toUpperCase());
    if (!fbEntry || !fbEntry.program) return;

    // sync inputs from outer memory
    if (outerMemory && instanceName) {
      fbEntry.sectionByName.forEach((section, normalized) => {
        const canonical = fbEntry.canonicalNames.get(normalized) ?? normalized;
        if (section === 'VAR_INPUT' || section === 'VAR_IN_OUT') {
          const dotted = `${instanceName}.${canonical}`;
          if (outerMemory.has(dotted)) {
            instance.memory.set(canonical, outerMemory.get(dotted) as MemoryValue);
          }
        }
      });
    }

    const tempMemory = new Map<string, StValue>();
    const env = this.createExecutionEnv(fbEntry, instance.memory, tempMemory);
    fbEntry.tempVars.forEach(declaration => {
      const value =
        declaration.initializer !== undefined
          ? this.interpreter.evaluate(declaration.initializer, env)
          : this.defaultValueForType(declaration.dataType);
      env.write([declaration.name], value);
    });

    try {
      this.interpreter.execute(fbEntry.program, env);
    } catch (error) {
      this.log(`Runtime error in FB ${instance.type}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // sync outputs back to outer memory
    if (outerMemory && instanceName) {
      fbEntry.sectionByName.forEach((section, normalized) => {
        if (section === 'VAR_OUTPUT' || section === 'VAR_IN_OUT') {
          const canonical = fbEntry.canonicalNames.get(normalized) ?? normalized;
          const value = instance.memory.get(canonical);
          const dotted = `${instanceName}.${canonical}`;
          outerMemory.set(dotted, value as MemoryValue);
          const addr = fbEntry.addressByName.get(normalized);
          const dir =
            fbEntry.ioDirectionByName.get(normalized) ?? this.inferIoDirection(addr) ?? this.inferAddrType(canonical) === 'Y'
              ? 'output'
              : undefined;
          if (dir === 'output') {
            this.ioService.setOutputValue(addr ?? dotted, this.toBoolean(value as StValue));
          }
        }
      });
    }
  }
}
