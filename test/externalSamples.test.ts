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

interface ExternalLadderFixture {
  file: string;
  minRungs: number;
  minContacts: number;
  minCoils: number;
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

const ladderFixtures: ExternalLadderFixture[] = [
  {
    file: 'ladder/factoryio-ft-con01.xml',
    minRungs: 1,
    minContacts: 10,
    minCoils: 8
  },
  {
    file: 'ladder/factoryio-ft-con02.xml',
    minRungs: 1,
    minContacts: 6,
    minCoils: 6
  },
  {
    file: 'ladder/factoryio-ft-con03.xml',
    minRungs: 1,
    minContacts: 6,
    minCoils: 6
  },
  {
    file: 'ladder/factoryio-ft-con04.xml',
    minRungs: 1,
    minContacts: 10,
    minCoils: 8
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

  it.each(ladderFixtures)('loads ladder-rich sample $file', fixture => {
    const xml = readFileSync(resolve(externalFixtureDir, fixture.file), 'utf8');
    const service = new PLCopenService();

    service.loadFromText(xml);
    const ladder = service.getLadderRungs();
    expect(ladder.length).toBeGreaterThanOrEqual(fixture.minRungs);

    const elements = ladder.flatMap(rung => [
      ...rung.elements,
      ...(rung.branches?.flatMap(branch => branch.elements) ?? [])
    ]);
    const contacts = elements.filter(element => element.type === 'contact').length;
    const coils = elements.filter(element => element.type === 'coil').length;
    expect(contacts).toBeGreaterThanOrEqual(fixture.minContacts);
    expect(coils).toBeGreaterThanOrEqual(fixture.minCoils);
  });
});
