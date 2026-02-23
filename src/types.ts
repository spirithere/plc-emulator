export type PouType = 'program' | 'functionBlock' | 'function';

export interface PouInterface {
  inputVars?: VariableDeclaration[];
  outputVars?: VariableDeclaration[];
  inOutVars?: VariableDeclaration[];
  localVars?: VariableDeclaration[];
  tempVars?: VariableDeclaration[];
}

export interface StructuredTextBlock {
  name: string;
  body: string;
  language?: 'ST' | 'LD' | 'CFC' | 'FBD' | 'Mixed';
  pouType?: PouType;
  interface?: PouInterface;
  addData?: Record<string, unknown>;
}

export type AddressType = 'X' | 'M' | 'Y';
export type IoDirection = 'input' | 'output' | 'memory';

export type VarSection =
  | 'VAR'
  | 'VAR_INPUT'
  | 'VAR_OUTPUT'
  | 'VAR_IN_OUT'
  | 'VAR_TEMP'
  | 'VAR_GLOBAL'
  | 'VAR_EXTERNAL';

export interface VariableDeclaration {
  name: string;
  dataType: string;
  section?: VarSection;
  scope?: 'configuration' | 'resource' | 'local';
  initialValue?: number | boolean | string;
  address?: string;
  retain?: boolean;
  persistent?: boolean;
  constant?: boolean;
  documentation?: string;
  ioDirection?: IoDirection;
  opcUaNodeId?: string;
  addData?: Record<string, unknown>;
}

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
  configurations?: Configuration[];
  metadata?: ProjectMetadata;
}

export interface DigitalChannel {
  id: string;
  label: string;
  type: 'input' | 'output';
  value: boolean;
  address?: string;
  source?: 'ladder' | 'globalVar' | 'runtime';
  opcUaNodeId?: string;
}

export interface ProjectMetadata {
  companyName?: string;
  productName?: string;
  productVersion?: string;
  creationDateTime?: string;
  projectName?: string;
  organization?: string;
  contentVersion?: string;
  contentModificationDateTime?: string;
}

export interface TaskConfig {
  name: string;
  priority?: number;
  interval?: string;
  single?: boolean;
}

export interface ProgramInstance {
  name: string;
  typeName: string;
  taskName?: string;
}

export interface ResourceConfig {
  name: string;
  tasks: TaskConfig[];
  programs: ProgramInstance[];
  globalVars?: VariableDeclaration[];
}

export interface Configuration {
  name: string;
  globalVars?: VariableDeclaration[];
  resources: ResourceConfig[];
}
