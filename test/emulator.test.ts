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
        ]
      }
    ]
  }
];

const plcServiceStub = {
  getStructuredTextBlocks: () => [structuredText],
  getLadderRungs: () => ladder
} as unknown as PLCopenService;

const profile: PLCProfile = {
  id: 'iec61131',
  vendor: 'IEC',
  title: 'IEC 61131-3 Base',
  description: 'Test profile'
};

const profileManagerStub = {
  getActiveProfile: () => profile
} as unknown as ProfileManager;

describe('EmulatorController', () => {
  it('updates variables and outputs after a scan cycle', () => {
    const ioService = new IOSimService();
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
});
