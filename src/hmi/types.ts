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
  previewOn?: boolean;
}

export interface HmiSwitch extends HmiWidgetBase {
  type: 'switch';
  binding?: HmiBinding; // boolean variable or input
  previewOn?: boolean;
}

export interface HmiLamp extends HmiWidgetBase {
  type: 'lamp';
  binding?: HmiBinding;
  style?: { onColor?: string; offColor?: string };
  previewOn?: boolean;
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
  previewValue?: number;
}

export interface HmiNumeric extends HmiWidgetBase {
  type: 'numeric';
  binding?: HmiBinding; // variable only (number)
  precision?: number;
  unit?: string;
  previewValue?: number;
}

export interface HmiMotor extends HmiWidgetBase {
  type: 'motor';
  binding?: HmiBinding; // output or variable (boolean)
  style?: { color?: string };
  previewOn?: boolean;
}

export interface HmiCylinder extends HmiWidgetBase {
  type: 'cylinder';
  binding?: HmiBinding; // output or variable (boolean)
  style?: { color?: string };
  previewOn?: boolean;
}

export interface HmiFan extends HmiWidgetBase {
  type: 'fan';
  binding?: HmiBinding;
  style?: { color?: string };
  previewOn?: boolean;
}

export interface HmiPump extends HmiWidgetBase {
  type: 'pump';
  binding?: HmiBinding;
  style?: { color?: string };
  previewOn?: boolean;
}

export interface HmiValve extends HmiWidgetBase {
  type: 'valve';
  binding?: HmiBinding;
  style?: { color?: string };
  orientation?: 'horizontal' | 'vertical';
  previewOn?: boolean;
}

export interface HmiGauge extends HmiWidgetBase {
  type: 'gauge';
  binding?: HmiBinding;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
  previewValue?: number;
  style?: { arcColor?: string; activeColor?: string; needleColor?: string };
}

export interface HmiTank extends HmiWidgetBase {
  type: 'tank';
  binding?: HmiBinding;
  min?: number;
  max?: number;
  unit?: string;
  previewValue?: number;
  style?: { fillColor?: string };
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
  | HmiFan
  | HmiPump
  | HmiValve
  | HmiGauge
  | HmiTank
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
