import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PLCopenService } from '../src/services/plcopenService';

const sampleXml = readFileSync(resolve(__dirname, '../examples/sample-project.plcopen.xml'), 'utf8');
const selfHoldXml = readFileSync(resolve(__dirname, '../examples/self-hold.plcopen.xml'), 'utf8');

describe('PLCopenService', () => {
  it('loads Structured Text blocks and ladder rungs from PLCopen XML text', () => {
    const service = new PLCopenService();
    service.loadFromText(sampleXml);

    const pous = service.getStructuredTextBlocks();
    const ladder = service.getLadderRungs();

    expect(pous.length).toBe(2);
    expect(pous.map(p => p.name)).toContain('MainProgram');
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder[0].elements[0].label).toBe('Start');
  });

  it('exports the in-memory model back to PLCopen XML string', () => {
    const service = new PLCopenService();
    service.loadFromText(sampleXml);

    const xml = service.exportToXml();
    expect(xml).toContain('<project>');
    expect(xml).toContain('MainProgram');
  });

  it('parses parallel branches inside ladder rungs', () => {
    const service = new PLCopenService();
    service.loadFromText(selfHoldXml);

    const ladder = service.getLadderRungs();
    expect(ladder[0].branches?.length).toBeGreaterThan(0);
    expect(ladder[0].branches?.[0].elements[0].label).toBe('M0');
    expect(ladder[0].elements[1].variant).toBe('nc');
  });
});
