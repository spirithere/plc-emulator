import { describe, expect, it } from 'vitest';
import { IOSimService } from '../src/io/ioService';
import { StructuredTextRuntime, StructuredTextDiagnosticEvent } from '../src/runtime/st/runtime';
import { StructuredTextBlock } from '../src/types';

describe('StructuredTextRuntime diagnostics', () => {
  it('emits parser diagnostics for invalid ST blocks and clears them once fixed', () => {
    const runtime = new StructuredTextRuntime(new IOSimService());
    const emitted: StructuredTextDiagnosticEvent[] = [];
    runtime.onDiagnostics(event => {
      emitted.push(event);
    });

    const brokenBlock: StructuredTextBlock = {
      name: 'BrokenProgram',
      body: ['PROGRAM BrokenProgram', '  VAR', '    A : INT;', '  END_VAR', '  A := ;', 'END_PROGRAM'].join('\n')
    };

    runtime.seed([brokenBlock], new Map());

    const parseEvent = emitted.at(-1);
    expect(parseEvent?.blockName).toBe('BrokenProgram');
    expect(parseEvent?.diagnostics).toHaveLength(1);
    expect(parseEvent?.diagnostics[0]?.source).toBe('parser');

    const fixedBlock: StructuredTextBlock = {
      name: 'BrokenProgram',
      body: ['PROGRAM BrokenProgram', '  VAR', '    A : INT := 0;', '  END_VAR', '  A := A + 1;', 'END_PROGRAM'].join('\n')
    };

    runtime.seed([fixedBlock], new Map());

    const clearEvent = emitted.at(-1);
    expect(clearEvent?.blockName).toBe('BrokenProgram');
    expect(clearEvent?.diagnostics).toHaveLength(0);
  });

  it('emits runtime diagnostics when execution raises an error', () => {
    const runtime = new StructuredTextRuntime(new IOSimService());
    const events: StructuredTextDiagnosticEvent[] = [];
    runtime.onDiagnostics(event => {
      events.push(event);
    });

    const block: StructuredTextBlock = {
      name: 'RuntimeProgram',
      body: [
        'PROGRAM RuntimeProgram',
        '  VAR',
        '    Result : INT := 0;',
        '  END_VAR',
        '  Result := UNSUPPORTED();',
        'END_PROGRAM'
      ].join('\n')
    };

    runtime.execute([block], new Map());

    const runtimeEvent = events.at(-1);
    expect(runtimeEvent?.blockName).toBe('RuntimeProgram');
    expect(runtimeEvent?.diagnostics).toHaveLength(1);
    expect(runtimeEvent?.diagnostics[0]?.source).toBe('runtime');
    expect(runtimeEvent?.diagnostics[0]?.message).toContain('Unsupported function');
  });

  it('coerces assignments to declared data types', () => {
    const runtime = new StructuredTextRuntime(new IOSimService());
    const block: StructuredTextBlock = {
      name: 'TypeProgram',
      body: [
        'PROGRAM TypeProgram',
        '  VAR',
        '    Flag : BOOL := FALSE;',
        '    Count : INT := 0;',
        '    Text : STRING := "";',
        '    Unsigned : UINT := 0;',
        '    RealValue : REAL := 0.0;',
        '  END_VAR',
        '  Flag := 1;',
        '  Count := TRUE;',
        '  Text := 123;',
        '  Unsigned := -5;',
        '  RealValue := "3.5";',
        'END_PROGRAM'
      ].join('\n')
    };

    const memory = new Map<string, number | boolean | string>();

    runtime.seed([block], memory);
    runtime.execute([block], memory);

    expect(memory.get('Flag')).toBe(true);
    expect(memory.get('Count')).toBe(1);
    expect(memory.get('Text')).toBe('123');
    expect(memory.get('Unsigned')).toBe(0);
    expect(memory.get('RealValue')).toBeCloseTo(3.5, 5);
  });

  it('honors AT address mappings and IO directions', () => {
    const ioService = new IOSimService();
    const runtime = new StructuredTextRuntime(ioService);
    const block: StructuredTextBlock = {
      name: 'IoMapped',
      body: [
        'PROGRAM IoMapped',
        '  VAR',
        '    Start AT %IX0.7 : BOOL;',
        '    Out AT %QX0.7 : BOOL := FALSE;',
        '    ConstOne : BOOL := TRUE;',
        '  END_VAR',
        '  Out := Start AND ConstOne;',
        'END_PROGRAM'
      ].join('\n')
    };

    const memory = new Map<string, number | boolean | string>();
    ioService.setInputValue('%IX0.7', true);

    runtime.seed([block], memory);
    runtime.execute([block], memory);

    const outputs = ioService.getState().outputs;
    expect(outputs.find(output => output.id === '%QX0.7')?.value).toBe(true);
    expect(memory.get('Out')).toBe(true);
  });
});
