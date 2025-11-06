export interface StructuredTextBlock {
  name: string;
  body: string;
}

export interface LadderElement {
  id: string;
  label: string;
  type: 'contact' | 'coil';
  state?: boolean;
  variant?: 'no' | 'nc';
}

export interface LadderRung {
  id: string;
  elements: LadderElement[];
  branches?: LadderBranch[];
}

export interface LadderBranch {
  id: string;
  elements: LadderElement[];
  startColumn: number;
  endColumn: number;
}

export interface PLCProjectModel {
  pous: StructuredTextBlock[];
  ladder: LadderRung[];
}

export interface DigitalChannel {
  id: string;
  label: string;
  type: 'input' | 'output';
  value: boolean;
}
