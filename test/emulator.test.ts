import { describe, expect, it } from 'vitest';
import { EmulatorController } from '../src/runtime/emulator';
import { IOSimService } from '../src/io/ioService';
import { PLCopenService } from '../src/services/plcopenService';
import { ProfileManager, PLCProfile } from '../src/runtime/profileManager';
import { LadderRung, StructuredTextBlock } from '../src/types';

const structuredText: StructuredTextBlock = {
  name: 'MainProgram',
  body: ['PROGRAM MainProgram', '  VAR', '    Counter : INT := 0;', '  END_VAR', '  Counter := Counter + 1;', 'END_PROGRAM'].join('\n')
};

const ladder: LadderRung[] = [
  {
    id: 'rung_0',
    elements: [
      { id: 'c0', label: 'Start Button', type: 'contact', state: true },
      { id: 'coil0', label: 'Motor', type: 'coil', state: false }
    ],
    branches: [
      {
        id: 'branch_0',
        elements: [
          { id: 'b_contact', label: 'Motor', type: 'contact', state: true },
          { id: 'b_coil', label: 'AuxMotor', type: 'coil', state: false }
        ],
        startColumn: 0,
        endColumn: 1
      }
    ]
  }
];

const selfHoldLadder: LadderRung[] = [
  {
    id: 'self_hold_0',
    elements: [
      { id: 'start', label: 'X1', type: 'contact', state: false, variant: 'no' },
      { id: 'stop', label: 'X5', type: 'contact', state: false, variant: 'nc' },
      { id: 'latch', label: 'M0', type: 'coil', state: false }
    ],
    branches: [
      {
        id: 'self_hold_branch',
        elements: [{ id: 'latch_contact', label: 'M0', type: 'contact', state: false, variant: 'no' }],
        startColumn: 0,
        endColumn: 1
      }
    ]
  },
  {
    id: 'self_hold_1',
    elements: [
      { id: 'latch_series', label: 'M0', type: 'contact', state: false, variant: 'no' },
      { id: 'output', label: 'Y0', type: 'coil', state: false }
    ]
  }
];

const openCircuitLadder: LadderRung[] = [
  {
    id: 'open_0',
    elements: [
      { id: 'open_start', label: 'X1', type: 'contact', state: false, variant: 'no' },
      { id: 'open_stop', label: 'X5', type: 'contact', state: false, variant: 'nc' },
      { id: 'open_latch', label: 'M0', type: 'coil', state: false },
      { id: 'open_tail', label: 'Element', type: 'contact', state: false, variant: 'no' }
    ],
    branches: [
      {
        id: 'open_branch',
        elements: [{ id: 'open_branch_contact', label: 'M0', type: 'contact', state: false, variant: 'no' }],
        startColumn: 0,
        endColumn: 1
      }
    ]
  },
  {
    id: 'open_1',
    elements: [
      { id: 'open_feedback', label: 'M0', type: 'contact', state: false, variant: 'no' },
      { id: 'open_output', label: 'Y0', type: 'coil', state: false }
    ]
  }
];

const plcServiceStub = {
  getStructuredTextBlocks: () => [structuredText],
  getLadderRungs: () => ladder,
  getConfigurations: () => [],
  getModel: () => ({ pous: [structuredText], ladder, configurations: [] }),
} as unknown as PLCopenService;

const profile: PLCProfile = {
  id: 'iec61131',
  vendor: 'IEC',
  title: 'IEC 61131-3 Base',
  description: 'Test profile'
};

const profileManagerStub = {
  getActiveProfile: () => profile,
  onDidChangeProfile: () => ({ dispose() {} })
} as unknown as ProfileManager;

function createPlcService(stBlocks: StructuredTextBlock[], ladderRungs: LadderRung[]): PLCopenService {
  return {
    getStructuredTextBlocks: () => stBlocks,
    getLadderRungs: () => ladderRungs,
    getConfigurations: () => [],
    getModel: () => ({ pous: stBlocks, ladder: ladderRungs, configurations: [] }),
    onDidChangeModel: () => ({ dispose() {} })
  } as unknown as PLCopenService;
}

describe('EmulatorController', () => {
  it('updates variables and outputs after a scan cycle', () => {
    const ioService = new IOSimService();
    const plcServiceStub = createPlcService([structuredText], ladder);
    const emulator = new EmulatorController(plcServiceStub, ioService, profileManagerStub);
    const internal = emulator as unknown as { seedVariables: () => void; scanCycle: () => void; variables: Map<string, unknown> };

    internal.seedVariables();
    internal.scanCycle();

    const counterValue = internal.variables.get('Counter');
    expect(counterValue).toBe(1);

    const outputs = ioService.getState().outputs;
    const motor = outputs.find(output => output.label === 'Motor');
    expect(motor?.value).toBe(true);

    const aux = outputs.find(output => output.label === 'AuxMotor');
    expect(aux?.value).toBe(true);
  });

  it('supports toggling ladder contacts via the IO simulator during execution', () => {
    const ioService = new IOSimService();
    ioService.syncFromProject({ pous: [], ladder: selfHoldLadder });

    const plcStub = createPlcService([], selfHoldLadder);

    const emulator = new EmulatorController(plcStub, ioService, profileManagerStub);
    const internal = emulator as unknown as { seedVariables: () => void; scanCycle: () => void };

    internal.seedVariables();

    expect(ioService.getState().inputs.find(input => input.id === 'X1')).toBeDefined();
    expect(ioService.getState().inputs.find(input => input.id === 'X5')).toBeDefined();

    ioService.setInputValue('X1', true);
    internal.scanCycle();

    let outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'Y0')?.value).toBe(true);

    // Releasing X1 should keep the latch energized (until X5 is pressed)
    ioService.setInputValue('X1', false);
    internal.scanCycle();
    outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'Y0')?.value).toBe(true);

    ioService.setInputValue('X5', true);
    internal.scanCycle();
    outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'Y0')?.value).toBe(false);
  });

  it('keeps IO inputs and runtime state in sync so the last writer wins', () => {
    const ioService = new IOSimService();
    ioService.syncFromProject({ pous: [], ladder: selfHoldLadder });
    const plcStub = createPlcService([], selfHoldLadder);
    const emulator = new EmulatorController(plcStub, ioService, profileManagerStub);
    const internal = emulator as unknown as {
      seedVariables: () => void;
      scanCycle: () => void;
      variables: Map<string, unknown>;
    };

    internal.seedVariables();
    internal.scanCycle();

    emulator.writeVariable('X1', true);
    internal.scanCycle();

    let x1Input = ioService.getState().inputs.find(input => input.id === 'X1');
    expect(x1Input?.value).toBe(true);
    expect(internal.variables.get('X1')).toBe(true);

    ioService.setInputValue('X1', false);
    internal.scanCycle();

    x1Input = ioService.getState().inputs.find(input => input.id === 'X1');
    expect(x1Input?.value).toBe(false);
    expect(internal.variables.get('X1')).toBe(false);
  });

  it('requires a complete left and right rail path before energizing a coil', () => {
    const ioService = new IOSimService();
    ioService.syncFromProject({ pous: [], ladder: openCircuitLadder });
    ioService.setInputValue('X1', true);
    ioService.setInputValue('X5', false);

    const plcStub = createPlcService([], openCircuitLadder);
    const emulator = new EmulatorController(plcStub, ioService, profileManagerStub);
    const internal = emulator as unknown as { seedVariables: () => void; scanCycle: () => void; variables: Map<string, unknown> };

    internal.seedVariables();
    internal.scanCycle();

    expect(internal.variables.get('M0')).toBe(false);
    const outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'Y0')?.value).toBe(false);
  });

  it('executes Structured Text control flow constructs', () => {
    const controlFlowProgram: StructuredTextBlock = {
      name: 'ControlFlow',
      body: [
        'PROGRAM ControlFlow',
        '  VAR',
        '    Sum : INT := 0;',
        '    Index : INT := 0;',
        '    Flag : BOOL := FALSE;',
        '  END_VAR',
        '  FOR Index := 1 TO 3 DO',
        '    Sum := Sum + Index;',
        '  END_FOR;',
        '  IF Sum = 6 THEN',
        '    Flag := TRUE;',
        '  END_IF;',
        '  WHILE Index > 0 DO',
        '    Index := Index - 1;',
        '  END_WHILE;',
        'END_PROGRAM'
      ].join('\n')
    };

    const ioService = new IOSimService();
    const plcService = createPlcService([controlFlowProgram], []);
    const emulator = new EmulatorController(plcService, ioService, profileManagerStub);
    const internal = emulator as unknown as { seedVariables: () => void; scanCycle: () => void; variables: Map<string, unknown> };

    internal.seedVariables();
    internal.scanCycle();

    expect(internal.variables.get('Sum')).toBe(6);
    expect(internal.variables.get('Flag')).toBe(true);
    expect(internal.variables.get('Index')).toBe(0);
  });
});
