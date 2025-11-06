import * as vscode from 'vscode';
import { DigitalChannel, LadderElement, PLCProjectModel } from '../types';

export interface IOStateSnapshot {
  inputs: DigitalChannel[];
  outputs: DigitalChannel[];
}

export class IOSimService {
  private readonly inputs: DigitalChannel[] = [
    { id: 'I0', label: 'Start Button', type: 'input', value: true },
    { id: 'I1', label: 'Stop Button', type: 'input', value: false },
    { id: 'I2', label: 'Emergency', type: 'input', value: false }
  ];

  private readonly outputs: DigitalChannel[] = [
    { id: 'Q0', label: 'Motor', type: 'output', value: false },
    { id: 'Q1', label: 'Pump', type: 'output', value: false },
    { id: 'Q2', label: 'Alarm', type: 'output', value: false }
  ];

  private readonly changeEmitter = new vscode.EventEmitter<IOStateSnapshot>();
  public readonly onDidChangeState = this.changeEmitter.event;

  public getState(): IOStateSnapshot {
    return {
      inputs: this.inputs.map(channel => ({ ...channel })),
      outputs: this.outputs.map(channel => ({ ...channel }))
    };
  }

  public syncFromProject(model: PLCProjectModel): void {
    if (!model?.ladder?.length) {
      return;
    }

    const coilLabels = new Set<string>();
    const contactDefaults = new Map<string, boolean>();

    const registerElement = (element: LadderElement): void => {
      if (element.type === 'coil') {
        coilLabels.add(element.label);
        return;
      }

      if (element.type === 'contact') {
        const preferredDefault = element.state ?? false;
        if (!contactDefaults.has(element.label)) {
          contactDefaults.set(element.label, preferredDefault);
          return;
        }

        if (preferredDefault) {
          contactDefaults.set(element.label, true);
        }
      }
    };

    model.ladder.forEach(rung => {
      rung.elements.forEach(registerElement);
      rung.branches?.forEach(branch => {
        branch.elements.forEach(registerElement);
      });
    });

    let mutated = false;
    contactDefaults.forEach((defaultValue, label) => {
      if (coilLabels.has(label)) {
        return;
      }

      if (this.findChannel(this.inputs, label)) {
        return;
      }

      this.inputs.push({
        id: label,
        label,
        type: 'input',
        value: defaultValue
      });
      mutated = true;
    });

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
}
