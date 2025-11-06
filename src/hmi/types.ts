export type HmiBindingTarget = 'input' | 'output' | 'variable';

export interface HmiBinding {
  target: HmiBindingTarget;
  symbol: string;
  expression?: string; // future: display transform
}

export interface HmiWidgetBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  label?: string;
}

export interface HmiButton extends HmiWidgetBase {
  type: 'button';
  variant?: 'momentary' | 'toggle';
  binding?: HmiBinding;
}

export interface HmiSwitch extends HmiWidgetBase {
  type: 'switch';
  binding?: HmiBinding; // boolean variable or input
}

export interface HmiLamp extends HmiWidgetBase {
  type: 'lamp';
  binding?: HmiBinding;
  style?: { onColor?: string; offColor?: string };
}

export interface HmiText extends HmiWidgetBase {
  type: 'text';
  text?: string;
}

export interface HmiSlider extends HmiWidgetBase {
  type: 'slider';
  min?: number;
  max?: number;
  step?: number;
  binding?: HmiBinding; // variable only (number)
}

export interface HmiNumeric extends HmiWidgetBase {
  type: 'numeric';
  binding?: HmiBinding; // variable only (number)
}

export interface HmiMotor extends HmiWidgetBase {
  type: 'motor';
  binding?: HmiBinding; // output or variable (boolean)
}

export interface HmiCylinder extends HmiWidgetBase {
  type: 'cylinder';
  binding?: HmiBinding; // output or variable (boolean)
}

export type HmiWidget =
  | HmiButton
  | HmiSwitch
  | HmiLamp
  | HmiText
  | HmiSlider
  | HmiNumeric
  | HmiMotor
  | HmiCylinder
  | HmiWidgetBase;

export interface HmiPage {
  id: string;
  title: string;
  widgets: HmiWidget[];
}

export interface HmiCanvas {
  width: number;
  height: number;
  grid?: number;
  background?: string;
}

export interface HmiModel {
  version: number;
  canvas: HmiCanvas;
  pages: HmiPage[];
}
