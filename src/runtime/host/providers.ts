import { LadderElement, LadderRung, StructuredTextBlock } from '../../types';
import { DisposableLike, PlcModelProvider, RuntimeIOAdapter } from '../runtimeTypes';

export class InMemoryPlcModelProvider implements PlcModelProvider {
  private pous: StructuredTextBlock[] = [];
  private ladder: LadderRung[] = [];
  private readonly listeners = new Set<() => void>();

  public getStructuredTextBlocks(): StructuredTextBlock[] {
    return this.pous;
  }

  public getLadderRungs(): LadderRung[] {
    return this.ladder;
  }

  public getConfigurations(): undefined {
    return undefined;
  }

  public onDidChangeModel(listener: () => void): DisposableLike {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener)
    };
  }

  public load(model: { pous: StructuredTextBlock[]; ladder: LadderRung[] }): void {
    this.pous = model.pous;
    this.ladder = model.ladder;
    this.listeners.forEach(listener => listener());
  }
}

export interface IOChannelSnapshot {
  id: string;
  value: boolean;
}

export interface IOSnapshot {
  inputs: IOChannelSnapshot[];
  outputs: IOChannelSnapshot[];
}

export class MemoryIOAdapter implements RuntimeIOAdapter {
  private readonly inputs = new Map<string, boolean>();
  private readonly outputs = new Map<string, boolean>();

  public setInputValue(identifier: string, value: boolean): void {
    this.inputs.set(identifier, value);
  }

  public getInputValue(identifier: string): boolean | undefined {
    return this.inputs.get(identifier);
  }

  public setOutputValue(identifier: string, value: boolean): void {
    this.outputs.set(identifier, value);
  }

  public syncFromLadder(rungs: LadderRung[]): void {
    const desiredInputs = new Set<string>();
    const desiredOutputs = new Set<string>();

    const registerElement = (element: LadderElement): void => {
      const addr = (element as any).addrType || this.inferAddrType(element.label);
      if (element.type === 'contact' && addr === 'X') {
        desiredInputs.add(element.label);
      } else if (element.type === 'coil' && addr === 'Y') {
        desiredOutputs.add(element.label);
      }
    };

    rungs.forEach(rung => {
      rung.elements.forEach(registerElement);
      rung.branches?.forEach(branch => branch.elements.forEach(registerElement));
    });

    desiredInputs.forEach(id => {
      if (!this.inputs.has(id)) {
        this.inputs.set(id, false);
      }
    });

    desiredOutputs.forEach(id => {
      if (!this.outputs.has(id)) {
        this.outputs.set(id, false);
      }
    });

    for (const key of Array.from(this.inputs.keys())) {
      if (!desiredInputs.has(key)) {
        this.inputs.delete(key);
      }
    }
    for (const key of Array.from(this.outputs.keys())) {
      if (!desiredOutputs.has(key)) {
        this.outputs.delete(key);
      }
    }
  }

  public getSnapshot(): IOSnapshot {
    return {
      inputs: Array.from(this.inputs.entries()).map(([id, value]) => ({ id, value })),
      outputs: Array.from(this.outputs.entries()).map(([id, value]) => ({ id, value }))
    };
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) return undefined;
    const c = identifier.trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') {
      return c;
    }
    return undefined;
  }
}
