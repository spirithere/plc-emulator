export interface StructuredTextBlock {
  name: string;
  body: string;
}

export type AddressType = 'X' | 'M' | 'Y';

export interface LadderElement {
  id: string;
  label: string;
  type: 'contact' | 'coil';
  state?: boolean;
  variant?: 'no' | 'nc';
  // Addressing domain derived from label prefix or XML attribute.
  // X: input, M: internal memory, Y: output
  addrType?: AddressType;
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
