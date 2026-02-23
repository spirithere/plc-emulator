import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeCore } from '../src/runtime/runtimeCore';
import { RuntimeApplicationService } from '../src/runtime/runtimeApplicationService';
import { InMemoryPlcModelProvider, MemoryIOAdapter } from '../src/runtime/host/providers';
import { LadderRung } from '../src/types';

const latchLadder: LadderRung[] = [
  {
    id: 'rung_0',
    elements: [
      { id: 'contact_start', label: 'X0', type: 'contact', variant: 'no', state: false },
      { id: 'coil_output', label: 'Y0', type: 'coil', state: false }
    ]
  }
];

const graphInstructionLadder: LadderRung[] = [
  {
    id: 'rung_graph_0',
    elements: [
      {
        id: '4',
        label: 'X0',
        type: 'contact',
        variant: 'no',
        state: false,
        metadata: {
          connectionPointIn: {
            connection: [{ refLocalId: '0' }]
          }
        }
      },
      {
        id: '5',
        label: '100',
        type: 'instruction',
        instructionKind: 'inVariable',
        metadata: {}
      },
      {
        id: '3',
        label: 'TON_0:TON',
        type: 'instruction',
        instructionKind: 'block',
        metadata: {
          typeName: 'TON',
          instanceName: 'TON_0',
          inputVariables: {
            variable: [
              {
                formalParameter: 'IN',
                connectionPointIn: { connection: [{ refLocalId: '4' }] }
              },
              {
                formalParameter: 'PT',
                connectionPointIn: { connection: [{ refLocalId: '5' }] }
              }
            ]
          }
        }
      },
      {
        id: '6',
        label: 'Y0',
        type: 'coil',
        state: false,
        metadata: {
          connectionPointIn: {
            connection: [{ refLocalId: '3' }]
          }
        }
      }
    ]
  }
];

const globalAliasLadder: LadderRung[] = [
  {
    id: 'rung_alias_0',
    elements: [
      { id: 'alias_contact', label: 'Glob_Var.Compressor', type: 'contact', variant: 'no', state: false },
      { id: 'alias_coil', label: 'Glob_Var.Lamp', type: 'coil', state: false }
    ]
  }
];

function createRuntimeApp(): { runtime: RuntimeCore; app: RuntimeApplicationService } {
  const modelProvider = new InMemoryPlcModelProvider();
  const ioAdapter = new MemoryIOAdapter();
  const runtime = new RuntimeCore({
    modelProvider,
    ioAdapter
  });
  const app = new RuntimeApplicationService(runtime, modelProvider, ioAdapter);
  activeRuntimes.push(runtime);
  return { runtime, app };
}

const activeRuntimes: RuntimeCore[] = [];

afterEach(() => {
  activeRuntimes.splice(0).forEach(runtime => runtime.dispose());
});

describe('RuntimeApplicationService', () => {
  it('loads a project and controls IO through step/setInputs', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: latchLadder, configurations: [] });
    app.setInputs([{ identifier: 'X0', value: true }]);

    const result = app.step(1);
    expect(result.executedCycles).toBe(1);
    expect(result.lastEvent?.sequence).toBe(1);

    const state = app.getState({ includeIo: true });
    expect(state.state.X0).toBe(true);
    expect(state.state.Y0).toBe(true);
    expect(state.io?.inputs.find(channel => channel.id === 'X0')?.value).toBe(true);
    expect(state.io?.outputs.find(channel => channel.id === 'Y0')?.value).toBe(true);
  });

  it('supports writeVariables and exposes sorted variable names', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: [], configurations: [] });
    const writeResult = app.writeVariables([
      { identifier: 'M10', value: true },
      { identifier: 'M2', value: 5 },
      { identifier: 'M1', value: 'hello' }
    ]);

    expect(writeResult.ok).toBe(true);
    expect(writeResult.count).toBe(3);
    expect(app.listVariables().variables).toEqual(['M1', 'M10', 'M2']);
  });

  it('reports metrics and resets runtime counters', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: latchLadder, configurations: [] });
    app.setInput({ identifier: 'X0', value: true });
    app.step(2);

    const beforeReset = app.getMetrics();
    expect(beforeReset.totalScans).toBe(2);
    expect(beforeReset.sequence).toBe(2);
    expect(beforeReset.running).toBe(false);

    const resetResult = app.reset();
    expect(resetResult.sequence).toBe(0);

    const afterReset = app.getMetrics();
    expect(afterReset.totalScans).toBe(0);
    expect(afterReset.sequence).toBe(0);
  });

  it('rejects step requests while runtime is running', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: latchLadder, configurations: [] });
    app.start(50);

    expect(() => app.step(1)).toThrow('Cannot step runtime while running.');

    app.stop();
  });

  it('executes instruction-graph ladder TON block wiring', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: graphInstructionLadder, configurations: [] });
    app.setInput({ identifier: 'X0', value: true });
    app.step(1);

    const state = app.getState({ includeIo: true });
    expect(state.state['TON_0.Q']).toBe(true);
    expect(state.state.Y0).toBe(true);
    expect(state.io?.outputs.find(channel => channel.id === 'Y0')?.value).toBe(true);
  });

  it('resolves Glob_Var aliases for ladder IO/state', () => {
    const { app } = createRuntimeApp();

    app.loadProject({ pous: [], ladder: globalAliasLadder, configurations: [] });
    app.setInput({ identifier: 'Compressor', value: true });
    app.step(1);

    const state = app.getState({ includeIo: true });
    expect(state.state.Compressor).toBe(true);
    expect(state.state.Lamp).toBe(true);
    expect(state.state['Glob_Var.Lamp']).toBe(true);
    expect(state.io?.outputs.find(channel => channel.id === 'Lamp')?.value).toBe(true);
    expect(state.io?.outputs.find(channel => channel.id === 'Glob_Var.Lamp')?.value).toBe(true);
  });
});
