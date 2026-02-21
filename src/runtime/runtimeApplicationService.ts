import { LadderRung } from '../types';
import { RuntimeCore } from './runtimeCore';
import {
  MutablePlcModelProvider,
  RuntimeIOAdapter,
  RuntimeMetrics,
  RuntimeProjectModel,
  RuntimeState,
  RuntimeStateEvent,
  RuntimeValue
} from './runtimeTypes';

export interface RuntimeVariableWrite {
  identifier: string;
  value: RuntimeValue;
}

export interface RuntimeInputWrite {
  identifier: string;
  value: boolean;
}

export interface RuntimeStateResponse {
  state: RuntimeState;
  sequence: number;
  timestamp?: number;
  io?: RuntimeIoSnapshot;
}

export interface RuntimeIoSnapshot {
  inputs: Array<{ id: string; value: boolean }>;
  outputs: Array<{ id: string; value: boolean }>;
}

export interface RuntimeStateQueryOptions {
  includeIo?: boolean;
}

export class RuntimeApplicationService {
  constructor(
    private readonly runtime: RuntimeCore,
    private readonly modelProvider: MutablePlcModelProvider,
    private readonly ioAdapter: RuntimeIOAdapter
  ) {}

  public loadProject(model: RuntimeProjectModel): { loaded: true } {
    if (typeof this.modelProvider.loadModel === 'function') {
      this.modelProvider.loadModel(model);
    } else if (typeof this.modelProvider.load === 'function') {
      this.modelProvider.load(model);
    } else {
      throw new Error('Model provider does not support loading a project model.');
    }

    this.syncIoFromLadder(model.ladder);
    return { loaded: true };
  }

  public start(scanTimeMs?: number): { started: boolean; running: boolean; scanTimeMs: number } {
    const started = this.runtime.start(scanTimeMs);
    return {
      started,
      running: this.runtime.isRunning(),
      scanTimeMs: this.runtime.getCurrentScanTime()
    };
  }

  public stop(): { stopped: boolean } {
    const wasRunning = this.runtime.isRunning();
    this.runtime.stop();
    return { stopped: wasRunning };
  }

  public step(cycles = 1): { executedCycles: number; lastEvent?: RuntimeStateEvent } {
    const normalizedCycles = Math.max(0, Math.floor(cycles));
    if (normalizedCycles === 0) {
      return { executedCycles: 0 };
    }

    let lastEvent: RuntimeStateEvent | undefined;
    for (let i = 0; i < normalizedCycles; i += 1) {
      lastEvent = this.runtime.step(1);
    }

    return { executedCycles: normalizedCycles, lastEvent };
  }

  public reset(): RuntimeStateResponse {
    const state = this.runtime.reset();
    const event = this.runtime.getLastStateEvent();
    return {
      state,
      sequence: event?.sequence ?? 0,
      timestamp: event?.timestamp,
      io: this.getIoSnapshot()
    };
  }

  public getState(options?: RuntimeStateQueryOptions): RuntimeStateResponse {
    const event = this.runtime.getLastStateEvent();
    return {
      state: this.runtime.getLastState(),
      sequence: event?.sequence ?? 0,
      timestamp: event?.timestamp,
      io: options?.includeIo ? this.getIoSnapshot() : undefined
    };
  }

  public listVariables(): { variables: string[] } {
    const variables = new Set(this.runtime.getVariableNames());
    const io = this.getIoSnapshot();
    io?.inputs.forEach(channel => variables.add(channel.id));
    io?.outputs.forEach(channel => variables.add(channel.id));
    return { variables: Array.from(variables).sort() };
  }

  public writeVariable(update: RuntimeVariableWrite): { ok: true } {
    this.runtime.writeVariable(update.identifier, update.value);
    return { ok: true };
  }

  public writeVariables(updates: RuntimeVariableWrite[]): { ok: true; count: number } {
    updates.forEach(update => {
      this.runtime.writeVariable(update.identifier, update.value);
    });
    return { ok: true, count: updates.length };
  }

  public setInput(update: RuntimeInputWrite): { ok: true } {
    this.runtime.writeVariable(update.identifier, update.value);
    return { ok: true };
  }

  public setInputs(updates: RuntimeInputWrite[]): { ok: true; count: number } {
    updates.forEach(update => {
      this.runtime.writeVariable(update.identifier, update.value);
    });
    return { ok: true, count: updates.length };
  }

  public getMetrics(): RuntimeMetrics {
    return this.runtime.getMetrics();
  }

  private getIoSnapshot(): RuntimeIoSnapshot | undefined {
    const ioWithSnapshot = this.ioAdapter as RuntimeIOAdapter & {
      getSnapshot?: () => { inputs?: Array<{ id?: string; value?: unknown }>; outputs?: Array<{ id?: string; value?: unknown }> };
      getState?: () => { inputs?: Array<{ id?: string; value?: unknown }>; outputs?: Array<{ id?: string; value?: unknown }> };
    };

    const source = ioWithSnapshot.getSnapshot?.() ?? ioWithSnapshot.getState?.();
    if (!source) {
      return undefined;
    }

    return {
      inputs: this.normalizeIoChannels(source.inputs),
      outputs: this.normalizeIoChannels(source.outputs)
    };
  }

  private normalizeIoChannels(channels: Array<{ id?: string; value?: unknown }> | undefined): Array<{ id: string; value: boolean }> {
    if (!channels) {
      return [];
    }
    return channels
      .filter((channel): channel is { id: string; value?: unknown } => typeof channel?.id === 'string')
      .map(channel => ({ id: channel.id, value: Boolean(channel.value) }));
  }

  private syncIoFromLadder(ladder: LadderRung[]): void {
    const ioWithSync = this.ioAdapter as RuntimeIOAdapter & { syncFromLadder?: (rungs: LadderRung[]) => void };
    ioWithSync.syncFromLadder?.(ladder);
  }
}
