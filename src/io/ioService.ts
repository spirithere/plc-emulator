import * as vscode from 'vscode';
import { DigitalChannel, LadderElement, PLCProjectModel } from '../types';

export interface IOStateSnapshot {
  inputs: DigitalChannel[];
  outputs: DigitalChannel[];
}

export class IOSimService {
  // Start with no predefined channels; populate from ladder/ST/HMI interactions.
  private readonly inputs: DigitalChannel[] = [];

  private readonly outputs: DigitalChannel[] = [];

  // Track which channels came from ladder so we can reconcile on project changes.
  private ladderInputIds = new Set<string>();
  private ladderOutputIds = new Set<string>();

  private readonly changeEmitter = new vscode.EventEmitter<IOStateSnapshot>();
  public readonly onDidChangeState = this.changeEmitter.event;

  public getState(): IOStateSnapshot {
    return {
      inputs: this.inputs.map(channel => ({ ...channel })),
      outputs: this.outputs.map(channel => ({ ...channel }))
    };
  }

  public syncFromProject(model: PLCProjectModel): void {
    // Build desired sets from ladder: inputs (X contacts) and outputs (Y coils).
    const desiredInputDefaults = new Map<string, boolean>();
    const desiredOutputDefaults = new Map<string, boolean>();

    const registerElement = (element: LadderElement): void => {
      const addr = (element as any).addrType || this.inferAddrType(element.label);
      if (element.type === 'contact' && addr === 'X') {
        const preferredDefault = element.state ?? false;
        if (!desiredInputDefaults.has(element.label)) {
          desiredInputDefaults.set(element.label, preferredDefault);
        } else if (preferredDefault) {
          desiredInputDefaults.set(element.label, true);
        }
      } else if (element.type === 'coil' && addr === 'Y') {
        const defaultValue = element.state ?? false;
        // In case of duplicates, OR keeps any true initialization.
        desiredOutputDefaults.set(element.label, (desiredOutputDefaults.get(element.label) ?? false) || defaultValue);
      }
    };

    model?.ladder?.forEach(rung => {
      rung.elements.forEach(registerElement);
      rung.branches?.forEach(branch => {
        branch.elements.forEach(registerElement);
      });
    });

    // Reconcile: remove ladder-sourced channels that no longer exist in the model.
    let mutated = false;

    if (this.ladderInputIds.size > 0) {
      const keep = new Set(desiredInputDefaults.keys());
      for (let i = this.inputs.length - 1; i >= 0; i -= 1) {
        const ch = this.inputs[i];
        if (this.ladderInputIds.has(ch.id) && !keep.has(ch.id)) {
          this.inputs.splice(i, 1);
          mutated = true;
        }
      }
    }

    if (this.ladderOutputIds.size > 0) {
      const keep = new Set(desiredOutputDefaults.keys());
      for (let i = this.outputs.length - 1; i >= 0; i -= 1) {
        const ch = this.outputs[i];
        if (this.ladderOutputIds.has(ch.id) && !keep.has(ch.id)) {
          this.outputs.splice(i, 1);
          mutated = true;
        }
      }
    }

    // Add missing inputs from ladder (X contacts)
    desiredInputDefaults.forEach((defaultValue, label) => {
      if (!this.findChannel(this.inputs, label)) {
        this.inputs.push({ id: label, label, type: 'input', value: defaultValue });
        mutated = true;
      }
    });

    // Add missing outputs from ladder (Y coils)
    desiredOutputDefaults.forEach((defaultValue, label) => {
      if (!this.findChannel(this.outputs, label)) {
        this.outputs.push({ id: label, label, type: 'output', value: defaultValue });
        mutated = true;
      }
    });

    // Update tracking sets for next reconciliation
    this.ladderInputIds = new Set(desiredInputDefaults.keys());
    this.ladderOutputIds = new Set(desiredOutputDefaults.keys());

    if (mutated) {
      this.emit();
    }
  }

  public setInputValue(identifier: string, value: boolean): void {
    const channel = this.findChannel(this.inputs, identifier);
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
    let channel = this.findChannel(this.outputs, identifier);
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
    return this.findChannel(this.inputs, identifier)?.value;
  }

  private emit(): void {
    this.changeEmitter.fire(this.getState());
  }

  private findChannel(channels: DigitalChannel[], identifier: string): DigitalChannel | undefined {
    return channels.find(channel => channel.id === identifier || channel.label === identifier);
  }

  private inferAddrType(identifier: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!identifier) return undefined;
    const c = String(identifier).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') return c;
    return undefined;
  }
}
