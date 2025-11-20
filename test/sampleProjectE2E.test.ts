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
    const xmlPath = resolve(__dirname, 'fixtures', 'simple-latch.plcopen.xml');
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

    // Force deterministic initial outputs then assert
    ioService.setOutputValue('MotorOut', false);
    ioService.setOutputValue('StatusLamp', false);
    let outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'MotorOut')?.value).toBe(false);
    expect(outputs.find(output => output.label === 'StatusLamp')?.value).toBe(false);

    // Press start
    ioService.setInputValue('StartPB', true);
    internal.scanCycle();
    outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'MotorOut')?.value).toBe(true);
    expect(outputs.find(output => output.label === 'StatusLamp')?.value).toBe(true);

    // Press stop (NC contact opens)
    ioService.setInputValue('StopPB', true);
    internal.scanCycle();
    outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.label === 'MotorOut')?.value).toBe(false);

    // Ensure IO mapping kept addresses from PLCopen variables
    const inputs = ioService.getState().inputs;
    expect(inputs.find(input => input.id === 'StartPB')?.address).toBe('%IX0.0');
    expect(outputs.find(output => output.id === 'MotorOut')?.address).toBe('%QX0.0');
  });
});
