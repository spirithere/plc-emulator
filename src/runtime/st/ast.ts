export type PrimitiveType = 'BOOL' | 'INT' | 'DINT' | 'REAL' | 'LREAL' | 'STRING' | 'WORD' | 'DWORD' | 'UNKNOWN';

export interface SourceRange {
  startOffset: number;
  endOffset: number;
}

export interface ProgramNode {
  type: 'Program';
  name: string;
  body: StatementNode[];
  varSections: VarSectionNode[];
  range?: SourceRange;
}

export interface VarSectionNode {
  type: 'VarSection';
  section: VarSectionType;
  declarations: VarDeclarationNode[];
  range?: SourceRange;
}

export type VarSectionType = 'VAR' | 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT' | 'VAR_TEMP';

export interface VarDeclarationNode {
  type: 'VarDeclaration';
  name: string;
  dataType: string;
  initializer?: ExpressionNode;
  range?: SourceRange;
}

export type StatementNode =
  | AssignmentStatementNode
  | IfStatementNode
  | CaseStatementNode
  | ForStatementNode
  | WhileStatementNode
  | RepeatStatementNode
  | ExitStatementNode
  | ReturnStatementNode;

export interface AssignmentStatementNode {
  type: 'Assignment';
  target: VariableAccessNode;
  expression: ExpressionNode;
  range?: SourceRange;
}

export interface IfStatementNode {
  type: 'If';
  branches: Array<{ condition: ExpressionNode; statements: StatementNode[] }>;
  elseBranch?: StatementNode[];
  range?: SourceRange;
}

export interface CaseStatementNode {
  type: 'Case';
  expression: ExpressionNode;
  cases: CaseBranchNode[];
  elseBranch?: StatementNode[];
  range?: SourceRange;
}

export interface CaseBranchNode {
  type: 'CaseBranch';
  selectors: CaseSelectorNode[];
  statements: StatementNode[];
  range?: SourceRange;
}

export type CaseSelectorNode = ExpressionNode | RangeSelectorNode;

export interface RangeSelectorNode {
  type: 'RangeSelector';
  from: ExpressionNode;
  to: ExpressionNode;
  range?: SourceRange;
}

export interface ForStatementNode {
  type: 'For';
  controlVariable: string;
  initialValue: ExpressionNode;
  finalValue: ExpressionNode;
  step?: ExpressionNode;
  body: StatementNode[];
  range?: SourceRange;
}

export interface WhileStatementNode {
  type: 'While';
  condition: ExpressionNode;
  body: StatementNode[];
  range?: SourceRange;
}

export interface RepeatStatementNode {
  type: 'Repeat';
  condition: ExpressionNode;
  body: StatementNode[];
  range?: SourceRange;
}

export interface ExitStatementNode {
  type: 'Exit';
  range?: SourceRange;
}

export interface ReturnStatementNode {
  type: 'Return';
  expression?: ExpressionNode;
  range?: SourceRange;
}

export type ExpressionNode =
  | BinaryExpressionNode
  | UnaryExpressionNode
  | LiteralExpressionNode
  | IdentifierExpressionNode
  | FunctionCallExpressionNode
  | ArrayAccessExpressionNode;

export interface BinaryExpressionNode {
  type: 'BinaryExpression';
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | 'MOD'
    | '='
    | '<>'
    | '<'
    | '<='
    | '>'
    | '>='
    | 'AND'
    | 'OR'
    | 'XOR';
  left: ExpressionNode;
  right: ExpressionNode;
  range?: SourceRange;
}

export interface UnaryExpressionNode {
  type: 'UnaryExpression';
  operator: 'NOT' | '+' | '-';
  argument: ExpressionNode;
  range?: SourceRange;
}

export interface LiteralExpressionNode {
  type: 'Literal';
  value: number | boolean | string;
  literalType: 'Number' | 'Boolean' | 'String';
  range?: SourceRange;
}

export interface IdentifierExpressionNode {
  type: 'Identifier';
  path: string[];
  range?: SourceRange;
}

export interface ArrayAccessExpressionNode {
  type: 'ArrayAccess';
  base: ExpressionNode;
  index: ExpressionNode;
  range?: SourceRange;
}

export interface FunctionCallExpressionNode {
  type: 'FunctionCall';
  path: string[];
  args: ExpressionNode[];
  range?: SourceRange;
}

export interface VariableAccessNode {
  type: 'VariableAccess';
  path: string[];
  indices?: ExpressionNode[];
  range?: SourceRange;
}
