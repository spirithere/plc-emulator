import { Configuration, LadderRung, StructuredTextBlock } from '../types';

export interface DisposableLike {
  dispose(): void;
}

export type RuntimeValue = number | boolean | string;

export interface RuntimeProjectModel {
  pous: StructuredTextBlock[];
  ladder: LadderRung[];
  configurations?: Configuration[];
}

export interface PlcModelProvider {
  getStructuredTextBlocks(): StructuredTextBlock[];
  getLadderRungs(): LadderRung[];
  getConfigurations(): Configuration[] | undefined;
  onDidChangeModel(listener: () => void): DisposableLike;
}

export interface MutablePlcModelProvider extends PlcModelProvider {
  load?(model: RuntimeProjectModel): void;
  loadModel?(model: RuntimeProjectModel): void;
}

export interface RuntimeIOAdapter {
  getInputValue(identifier: string): boolean | undefined;
  setInputValue(identifier: string, value: boolean): void;
  setOutputValue(identifier: string, value: boolean): void;
}

export type RuntimeState = Record<string, RuntimeValue>;

export interface RuntimeStateEvent {
  sequence: number;
  timestamp: number;
  snapshot: RuntimeState;
}

export interface RuntimeMetrics {
  running: boolean;
  currentScanTimeMs: number;
  sequence: number;
  totalScans: number;
  lastScanDurationMs: number;
  lastScanTimestamp?: number;
  scanErrorCount: number;
}

export type RuntimeStateListener = (event: RuntimeStateEvent) => void;
export type RunStateListener = (running: boolean) => void;

export interface RuntimeLogEvent {
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

export type RuntimeLogListener = (event: RuntimeLogEvent) => void;
