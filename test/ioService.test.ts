import { describe, expect, it } from 'vitest';
import { IOSimService } from '../src/io/ioService';
import { PLCProjectModel, StructuredTextBlock } from '../src/types';

describe('IOSimService', () => {
  it('discovers mapped IO channels from POU interface variables', () => {
    const service = new IOSimService();
    const pou: StructuredTextBlock = {
      name: 'Cell3',
      language: 'LD',
      body: '',
      interface: {
        localVars: [
          { name: 'C1_working', dataType: 'BOOL', address: '%IX0.0' },
          { name: 'R1_fwd', dataType: 'BOOL', address: '%QX0.0' }
        ]
      }
    };

    const model: PLCProjectModel = {
      pous: [pou],
      ladder: [],
      configurations: []
    };
    service.syncFromProject(model);

    const state = service.getState();
    expect(state.inputs.find(channel => channel.id === 'C1_working')?.address).toBe('%IX0.0');
    expect(state.outputs.find(channel => channel.id === 'R1_fwd')?.address).toBe('%QX0.0');
  });

  it('keeps an existing mapped address when a later declaration omits address', () => {
    const service = new IOSimService();
    const pou: StructuredTextBlock = {
      name: 'Main',
      body: '',
      interface: {
        outputVars: [{ name: 'R1_fwd', dataType: 'BOOL' }]
      }
    };

    const model: PLCProjectModel = {
      pous: [pou],
      ladder: [],
      configurations: [
        {
          name: 'Cfg',
          globalVars: [{ name: 'R1_fwd', dataType: 'BOOL', address: '%QX0.1', ioDirection: 'output' }],
          resources: []
        }
      ]
    };
    service.syncFromProject(model);

    const output = service.getState().outputs.find(channel => channel.id === 'R1_fwd');
    expect(output?.address).toBe('%QX0.1');
  });
});
