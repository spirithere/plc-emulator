import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EmulatorController } from '../src/runtime/emulator';
import { IOSimService } from '../src/io/ioService';
import { PLCopenService } from '../src/services/plcopenService';
import { ProfileManager, PLCProfile } from '../src/runtime/profileManager';

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

describe('Sample PLCopen project', () => {
  it('executes the bundled sample project end-to-end', () => {
    const xmlPath = resolve(__dirname, '..', 'examples', 'sample-project.plcopen.xml');
    const xml = readFileSync(xmlPath, 'utf8');

    const plcService = new PLCopenService();
    plcService.loadFromText(xml);

    const ioService = new IOSimService();
    ioService.syncFromProject(plcService.getModel());

    const emulator = new EmulatorController(plcService, ioService, profileManagerStub);
    const internal = emulator as unknown as {
      seedVariables: () => void;
      scanCycle: () => void;
      variables: Map<string, unknown>;
    };

    internal.seedVariables();
    internal.scanCycle();

    const variables = internal.variables;
    expect(variables.get('Counter')).toBe(1);
    expect(variables.get('MotorOn')).toBe(false);

    const outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'Motor')?.value).toBe(true);
    expect(outputs.find(output => output.label === 'CoolingFan')?.value).toBe(true);
  });
});
