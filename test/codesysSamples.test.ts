import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PLCopenService } from '../src/services/plcopenService';
import { PLCProjectModel } from '../src/types';

interface FixtureCase {
  file: string;
  productNameToken: string;
  minPous: number;
  minConfigurations: number;
  minTasks: number;
  expectedPouNames?: string[];
}

const fixtureDir = resolve(__dirname, 'fixtures', 'codesys');

const cases: FixtureCase[] = [
  {
    file: 'codesys-minimal.xml',
    productNameToken: 'CODESYS',
    minPous: 3,
    minConfigurations: 0,
    minTasks: 0,
    expectedPouNames: ['Main', 'Clamp', 'LegacyAction']
  },
  {
    file: 'codesys-st-small.xml',
    productNameToken: 'CODESYS',
    minPous: 1,
    minConfigurations: 1,
    minTasks: 1,
    expectedPouNames: ['Main']
  },
  {
    file: 'codesys-st-medium.xml',
    productNameToken: 'CODESYS',
    minPous: 1,
    minConfigurations: 1,
    minTasks: 1,
    expectedPouNames: ['Main']
  },
  {
    file: 'codesys-st-large.xml',
    productNameToken: 'CODESYS',
    minPous: 3,
    minConfigurations: 0,
    minTasks: 0,
    expectedPouNames: ['Main', 'Helper', 'LegacyDb']
  }
];

function countTasks(model: PLCProjectModel): number {
  return (
    model.configurations?.reduce((total, config) => {
      const resourceTaskCount = config.resources.reduce((resourceTotal, resource) => resourceTotal + resource.tasks.length, 0);
      return total + resourceTaskCount;
    }, 0) ?? 0
  );
}

describe('PLCopenService external CODESYS fixtures', () => {
  it.each(cases)('loads $file and extracts key fields', fixture => {
    const xml = readFileSync(resolve(fixtureDir, fixture.file), 'utf8');
    const service = new PLCopenService();

    service.loadFromText(xml);
    const model = service.getModel();

    expect(model.metadata?.productName?.toUpperCase()).toContain(fixture.productNameToken);
    expect(model.pous.length).toBeGreaterThanOrEqual(fixture.minPous);
    expect(model.configurations?.length ?? 0).toBeGreaterThanOrEqual(fixture.minConfigurations);
    expect(countTasks(model)).toBeGreaterThanOrEqual(fixture.minTasks);

    fixture.expectedPouNames?.forEach(name => {
      expect(model.pous.map(p => p.name)).toContain(name);
    });

  });

  it.each(cases)('round-trips $file through exportToXml/loadFromText', fixture => {
    const xml = readFileSync(resolve(fixtureDir, fixture.file), 'utf8');
    const service = new PLCopenService();

    service.loadFromText(xml);
    const exported = service.exportToXml();

    expect(exported).toContain('<project');
    expect(exported).toContain('xmlns="http://www.plcopen.org/xml/tc6_0200"');

    const roundTrip = new PLCopenService();
    roundTrip.loadFromText(exported);
    expect(roundTrip.getModel().pous.length).toBeGreaterThanOrEqual(1);
  });

  it('throws clear error for unsupported CFC/advanced LD in refrigerator-control fixture', () => {
    const xml = readFileSync(resolve(fixtureDir, 'refrigerator-control.xml'), 'utf8');
    const service = new PLCopenService();

    expect(() => service.loadFromText(xml)).toThrow('uses CFC implementation, which is not supported yet');
  });
});
