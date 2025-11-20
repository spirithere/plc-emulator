import { Configuration, LadderRung, StructuredTextBlock } from '../types';

export interface DisposableLike {
  dispose(): void;
}

export interface PlcModelProvider {
  getStructuredTextBlocks(): StructuredTextBlock[];
  getLadderRungs(): LadderRung[];
  getConfigurations(): Configuration[] | undefined;
  onDidChangeModel(listener: () => void): DisposableLike;
}

export interface RuntimeIOAdapter {
  getInputValue(identifier: string): boolean | undefined;
  setInputValue(identifier: string, value: boolean): void;
  setOutputValue(identifier: string, value: boolean): void;
}

export type RuntimeState = Record<string, number | boolean | string>;

export interface RuntimeStateEvent {
  sequence: number;
  timestamp: number;
  snapshot: RuntimeState;
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
