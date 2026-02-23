import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PLCopenService } from '../src/services/plcopenService';

interface ExternalFixture {
  file: string;
  minPous: number;
  minStBodyChars?: number;
  expectWarnings?: boolean;
}

const externalFixtureDir = resolve(__dirname, '..', 'examples', 'external');

const fixtures: ExternalFixture[] = [
  {
    file: 'codesys-speed-tests.xml',
    minPous: 20,
    expectWarnings: true
  },
  {
    file: 'math-expression-evaluator.xml',
    minPous: 10
  },
  {
    file: 'mixing-tank.xml',
    minPous: 1,
    minStBodyChars: 300
  },
  {
    file: 'siemens.xml',
    minPous: 2
  },
  {
    file: 'rockwell.xml',
    minPous: 2
  }
];

describe('External PLCopen XML examples', () => {
  it.each(fixtures)('loads $file without falling back to default model', fixture => {
    const xml = readFileSync(resolve(externalFixtureDir, fixture.file), 'utf8');
    const service = new PLCopenService();

    service.loadFromText(xml);
    const model = service.getModel();

    expect(model.pous.length).toBeGreaterThanOrEqual(fixture.minPous);
    expect(model.pous.map(pou => pou.name)).not.toContain('MainProgram');

    const totalStChars = model.pous.reduce((sum, pou) => sum + (pou.body?.trim().length ?? 0), 0);
    if (fixture.minStBodyChars !== undefined) {
      expect(totalStChars).toBeGreaterThanOrEqual(fixture.minStBodyChars);
    }

    if (fixture.expectWarnings) {
      expect(service.getLoadWarnings().length).toBeGreaterThan(0);
    }
  });
});
