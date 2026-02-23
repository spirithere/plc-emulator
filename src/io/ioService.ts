import * as vscode from 'vscode';
import { DigitalChannel, LadderElement, PLCProjectModel } from '../types';
import { RuntimeIOAdapter } from '../runtime/runtimeTypes';

export interface IOStateSnapshot {
  inputs: DigitalChannel[];
  outputs: DigitalChannel[];
}

export class IOSimService implements RuntimeIOAdapter {
  // Start with no predefined channels; populate from ladder/ST/HMI interactions.
  private readonly inputs: DigitalChannel[] = [];

  private readonly outputs: DigitalChannel[] = [];

  // Track which channels came from ladder so we can reconcile on project changes.
  private ladderInputIds = new Set<string>();
  private ladderOutputIds = new Set<string>();
  // Track channels sourced from PLCopen variable declarations.
  private varInputIds = new Set<string>();
  private varOutputIds = new Set<string>();

  private readonly changeEmitter = new vscode.EventEmitter<IOStateSnapshot>();
  public readonly onDidChangeState = this.changeEmitter.event;

  public getState(): IOStateSnapshot {
    return {
      inputs: this.inputs.map(channel => ({ ...channel })),
      outputs: this.outputs.map(channel => ({ ...channel }))
    };
  }

  public syncFromProject(model: PLCProjectModel): void {
    const desiredInputs = new Map<
      string,
      { defaultValue: boolean; address?: string; source: 'ladder' | 'globalVar'; opcUaNodeId?: string }
    >();
    const desiredOutputs = new Map<
      string,
      { defaultValue: boolean; address?: string; source: 'ladder' | 'globalVar'; opcUaNodeId?: string }
    >();

    const registerElement = (element: LadderElement): void => {
      const addr = (element as any).addrType || this.inferAddrType(element.label);
      if (element.type === 'contact' && addr === 'X') {
        const preferredDefault = element.state ?? false;
        const existing = desiredInputs.get(element.label);
        if (!existing) {
          desiredInputs.set(element.label, { defaultValue: preferredDefault, source: 'ladder' });
        } else if (preferredDefault) {
          existing.defaultValue = true;
        }
      } else if (element.type === 'coil' && addr === 'Y') {
        const defaultValue = element.state ?? false;
        const existing = desiredOutputs.get(element.label);
        const value = (existing?.defaultValue ?? false) || defaultValue;
        desiredOutputs.set(element.label, { defaultValue: value, source: 'ladder' });
      }
    };

    model?.ladder?.forEach(rung => {
      rung.elements.forEach(registerElement);
      rung.branches?.forEach(branch => {
        branch.elements.forEach(registerElement);
      });
    });

    const registerVariables = (vars: any[] | undefined): void => {
      vars?.forEach(variable => {
        const name = variable?.name;
        if (!name) return;
        const direction =
          variable?.ioDirection ??
          this.inferDirectionFromAddress(variable?.address) ??
          (() => {
            const addrType = this.inferAddrType(name);
            if (addrType === 'X') return 'input';
            if (addrType === 'Y') return 'output';
            return undefined;
          })();
        if (!direction) return;
        const defaultValue = this.toBoolean(variable?.initialValue ?? false);
        if (direction === 'input') {
          const existing = desiredInputs.get(name);
          desiredInputs.set(name, {
            defaultValue: existing?.defaultValue ?? defaultValue,
            address: variable.address ?? existing?.address,
            source: 'globalVar',
            opcUaNodeId: variable.opcUaNodeId ?? existing?.opcUaNodeId
          });
        } else if (direction === 'output') {
          const existing = desiredOutputs.get(name);
          desiredOutputs.set(name, {
            defaultValue: existing?.defaultValue ?? defaultValue,
            address: variable.address ?? existing?.address,
            source: 'globalVar',
            opcUaNodeId: variable.opcUaNodeId ?? existing?.opcUaNodeId
          });
        }
      });
    };

    model?.configurations?.forEach(config => {
      registerVariables(config.globalVars);
      config.resources?.forEach(resource => registerVariables(resource.globalVars));
    });

    // Some PLCopen exports define mapped IO addresses on POU interface variables
    // (for example localVars with %IX/%QX), not only configuration globals.
    model?.pous?.forEach(pou => {
      const intf = pou.interface;
      if (!intf) {
        return;
      }
      registerVariables([
        ...(intf.inputVars ?? []),
        ...(intf.outputVars ?? []),
        ...(intf.inOutVars ?? []),
        ...(intf.localVars ?? []),
        ...(intf.tempVars ?? [])
      ]);
    });

    // Reconcile: remove ladder-sourced channels that no longer exist in the model.
    let mutated = false;

    if (this.ladderInputIds.size > 0 || this.varInputIds.size > 0) {
      const keep = new Set(desiredInputs.keys());
      for (let i = this.inputs.length - 1; i >= 0; i -= 1) {
        const ch = this.inputs[i];
        if ((this.ladderInputIds.has(ch.id) || this.varInputIds.has(ch.id)) && !keep.has(ch.id)) {
          this.inputs.splice(i, 1);
          mutated = true;
        }
      }
    }

    if (this.ladderOutputIds.size > 0 || this.varOutputIds.size > 0) {
      const keep = new Set(desiredOutputs.keys());
      for (let i = this.outputs.length - 1; i >= 0; i -= 1) {
        const ch = this.outputs[i];
        if ((this.ladderOutputIds.has(ch.id) || this.varOutputIds.has(ch.id)) && !keep.has(ch.id)) {
          this.outputs.splice(i, 1);
          mutated = true;
        }
      }
    }

    desiredInputs.forEach((data, label) => {
      const channel = this.findChannel(this.inputs, label, data.address);
      if (!channel) {
        this.inputs.push({
          id: label,
          label,
          type: 'input',
          value: data.defaultValue,
          address: data.address,
          source: data.source,
          opcUaNodeId: data.opcUaNodeId
        });
        mutated = true;
      } else {
        channel.address = data.address ?? channel.address;
        channel.opcUaNodeId = data.opcUaNodeId ?? channel.opcUaNodeId;
      }
    });

    desiredOutputs.forEach((data, label) => {
      const channel = this.findChannel(this.outputs, label, data.address);
      if (!channel) {
        this.outputs.push({
          id: label,
          label,
          type: 'output',
          value: data.defaultValue,
          address: data.address,
          source: data.source,
          opcUaNodeId: data.opcUaNodeId
        });
        mutated = true;
      } else {
        channel.address = data.address ?? channel.address;
        channel.opcUaNodeId = data.opcUaNodeId ?? channel.opcUaNodeId;
      }
    });

    this.ladderInputIds = new Set(
      Array.from(desiredInputs.entries())
        .filter(([, data]) => data.source === 'ladder')
        .map(([label]) => label)
    );
    this.ladderOutputIds = new Set(
      Array.from(desiredOutputs.entries())
        .filter(([, data]) => data.source === 'ladder')
        .map(([label]) => label)
    );

    this.varInputIds = new Set(
      Array.from(desiredInputs.entries())
        .filter(([, data]) => data.source === 'globalVar')
        .map(([label]) => label)
    );
    this.varOutputIds = new Set(
      Array.from(desiredOutputs.entries())
        .filter(([, data]) => data.source === 'globalVar')
        .map(([label]) => label)
    );

    if (mutated) {
      this.emit();
    }
  }

  public setInputValue(identifier: string, value: boolean): void {
    const channel = this.findChannel(this.inputs, identifier, identifier);
    let mutated = false;
    if (!channel) {
      this.inputs.push({ id: identifier, label: identifier, type: 'input', value });
      mutated = true;
    } else if (channel.value !== value) {
      channel.value = value;
      mutated = true;
    }

    if (mutated) {
      this.emit();
    }
  }

  public setOutputValue(identifier: string, value: boolean): void {
    let channel = this.findChannel(this.outputs, identifier, identifier);
    let mutated = false;
    if (!channel) {
      channel = { id: identifier, label: identifier, type: 'output', value };
      this.outputs.push(channel);
      mutated = true;
    } else if (channel.value !== value) {
      channel.value = value;
      mutated = true;
    }
    if (mutated) {
      this.emit();
    }
  }

  public getInputValue(identifier: string): boolean | undefined {
    return this.findChannel(this.inputs, identifier, identifier)?.value;
  }

  private emit(): void {
    this.changeEmitter.fire(this.getState());
  }

  private findChannel(channels: DigitalChannel[], identifier: string, address?: string): DigitalChannel | undefined {
    return channels.find(
      channel =>
        channel.id === identifier ||
        channel.label === identifier ||
        (!!address && channel.address === address)
    );
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) return undefined;
    const c = String(identifier).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') return c;
    return undefined;
  }

  private inferDirectionFromAddress(address?: string): 'input' | 'output' | 'memory' | undefined {
    if (!address) return undefined;
    const norm = address.trim().toUpperCase();
    if (norm.startsWith('%I')) return 'input';
    if (norm.startsWith('%Q')) return 'output';
    if (norm.startsWith('%M')) return 'memory';
    return undefined;
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
      if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
    }
    return Boolean(value);
  }
}
