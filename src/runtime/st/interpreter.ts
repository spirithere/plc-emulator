import {
  ArrayAccessExpressionNode,
  AssignmentStatementNode,
  BinaryExpressionNode,
  CaseSelectorNode,
  CaseStatementNode,
  ExpressionNode,
  ForStatementNode,
  FunctionCallExpressionNode,
  IdentifierExpressionNode,
  IfStatementNode,
  LiteralExpressionNode,
  ProgramNode,
  RepeatStatementNode,
  ReturnStatementNode,
  StatementNode,
  UnaryExpressionNode,
  WhileStatementNode
} from './ast';

export type StValue = number | boolean | string;

export interface ExecutionEnv {
  read(path: string[], indices?: number[]): StValue | undefined;
  write(path: string[], value: StValue, indices?: number[]): void;
  callFunction(path: string[], args: StValue[]): StValue | undefined;
  logDiagnostics?(message: string): void;
}

class ExitSignal extends Error {
  constructor() {
    super('EXIT');
  }
}

class ReturnSignal extends Error {
  constructor(public readonly value?: StValue) {
    super('RETURN');
  }
}

type BinaryOperator = BinaryExpressionNode['operator'];

export class StructuredTextInterpreter {
  constructor(private readonly logger: (message: string) => void = () => {}) {}

  public execute(program: ProgramNode, env: ExecutionEnv): StValue | undefined {
    try {
      this.executeStatements(program.body, env);
    } catch (signal) {
      if (signal instanceof ReturnSignal) {
        return signal.value;
      }
      if (signal instanceof ExitSignal) {
        // EXIT outside of loop — treated as graceful termination.
        return undefined;
      }
      throw signal;
    }
    return undefined;
  }

  public evaluate(expr: ExpressionNode, env: ExecutionEnv): StValue {
    return this.evaluateExpression(expr, env);
  }

  private executeStatements(statements: StatementNode[], env: ExecutionEnv): void {
    for (const statement of statements) {
      this.executeStatement(statement, env);
    }
  }

  private executeStatement(statement: StatementNode, env: ExecutionEnv): void {
    switch (statement.type) {
      case 'Assignment':
        this.executeAssignment(statement, env);
        break;
      case 'If':
        this.executeIf(statement, env);
        break;
      case 'Case':
        this.executeCase(statement, env);
        break;
      case 'For':
        this.executeFor(statement, env);
        break;
      case 'While':
        this.executeWhile(statement, env);
        break;
      case 'Repeat':
        this.executeRepeat(statement, env);
        break;
      case 'Exit':
        throw new ExitSignal();
      case 'Return': {
        const value = statement.expression ? this.evaluateExpression(statement.expression, env) : undefined;
        throw new ReturnSignal(value);
      }
      default:
        this.logger(`Unhandled statement type ${(statement as any).type}`);
    }
  }

  private executeAssignment(statement: AssignmentStatementNode, env: ExecutionEnv): void {
    const value = this.evaluateExpression(statement.expression, env);
    const indices = statement.target.indices?.map(indexExpr => this.toInteger(this.evaluateExpression(indexExpr, env)));
    env.write(statement.target.path, value, indices);
  }

  private executeIf(statement: IfStatementNode, env: ExecutionEnv): void {
    for (const branch of statement.branches) {
      if (this.toBoolean(this.evaluateExpression(branch.condition, env))) {
        this.executeStatements(branch.statements, env);
        return;
      }
    }

    if (statement.elseBranch) {
      this.executeStatements(statement.elseBranch, env);
    }
  }

  private executeCase(statement: CaseStatementNode, env: ExecutionEnv): void {
    const selectorValue = this.evaluateExpression(statement.expression, env);
    for (const caseBranch of statement.cases) {
      if (caseBranch.selectors.some(selector => this.caseSelectorMatches(selector, selectorValue, env))) {
        this.executeStatements(caseBranch.statements, env);
        return;
      }
    }

    if (statement.elseBranch) {
      this.executeStatements(statement.elseBranch, env);
    }
  }

  private caseSelectorMatches(selector: CaseSelectorNode, value: StValue, env: ExecutionEnv): boolean {
    if ((selector as any).type === 'RangeSelector') {
      const rangeSelector = selector as any;
      const fromValue = this.evaluateExpression(rangeSelector.from, env);
      const toValue = this.evaluateExpression(rangeSelector.to, env);
      const numericValue = this.toNumber(value);
      return numericValue >= this.toNumber(fromValue) && numericValue <= this.toNumber(toValue);
    }
    const selectorValue = this.evaluateExpression(selector as ExpressionNode, env);
    return this.equals(selectorValue, value);
  }

  private executeFor(statement: ForStatementNode, env: ExecutionEnv): void {
    const start = this.toNumber(this.evaluateExpression(statement.initialValue, env));
    const end = this.toNumber(this.evaluateExpression(statement.finalValue, env));
    const step = statement.step ? this.toNumber(this.evaluateExpression(statement.step, env)) : 1;
    if (step === 0) {
      this.logger('FOR loop step evaluated to 0; loop skipped.');
      return;
    }

    const path = [statement.controlVariable];
    const condition = step > 0 ? (current: number) => current <= end : (current: number) => current >= end;

    for (let current = start; condition(current); current += step) {
      env.write(path, current);
      try {
        this.executeStatements(statement.body, env);
      } catch (signal) {
        if (signal instanceof ExitSignal) {
          break;
        }
        if (signal instanceof ReturnSignal) {
          throw signal;
        }
        throw signal;
      }
    }
  }

  private executeWhile(statement: WhileStatementNode, env: ExecutionEnv): void {
    while (this.toBoolean(this.evaluateExpression(statement.condition, env))) {
      try {
        this.executeStatements(statement.body, env);
      } catch (signal) {
        if (signal instanceof ExitSignal) {
          break;
        }
        if (signal instanceof ReturnSignal) {
          throw signal;
        }
        throw signal;
      }
    }
  }

  private executeRepeat(statement: RepeatStatementNode, env: ExecutionEnv): void {
    while (true) {
      try {
        this.executeStatements(statement.body, env);
      } catch (signal) {
        if (signal instanceof ExitSignal) {
          break;
        }
        if (signal instanceof ReturnSignal) {
          throw signal;
        }
        throw signal;
      }
      if (this.toBoolean(this.evaluateExpression(statement.condition, env))) {
        break;
      }
    }
  }

  private evaluateExpression(expression: ExpressionNode, env: ExecutionEnv): StValue {
    switch (expression.type) {
      case 'Literal':
        return (expression as LiteralExpressionNode).value;
      case 'Identifier':
        return this.readIdentifier(expression as IdentifierExpressionNode, env);
      case 'ArrayAccess':
        return this.evaluateArrayAccess(expression as ArrayAccessExpressionNode, env);
      case 'UnaryExpression':
        return this.evaluateUnary(expression as UnaryExpressionNode, env);
      case 'BinaryExpression':
        return this.evaluateBinary(expression as BinaryExpressionNode, env);
      case 'FunctionCall':
        return this.evaluateFunctionCall(expression as FunctionCallExpressionNode, env);
      default:
        this.logger(`Unhandled expression type ${(expression as any).type}`);
        return 0;
    }
  }

  private readIdentifier(identifier: IdentifierExpressionNode, env: ExecutionEnv): StValue {
    const value = env.read(identifier.path);
    if (value === undefined) {
      return 0;
    }
    return value;
  }

  private evaluateArrayAccess(node: ArrayAccessExpressionNode, env: ExecutionEnv): StValue {
    const indices: number[] = [];
    let current: ExpressionNode | IdentifierExpressionNode | ArrayAccessExpressionNode = node;
    const basePath: string[] = [];
    while (current.type === 'ArrayAccess') {
      indices.unshift(this.toInteger(this.evaluateExpression(current.index, env)));
      current = current.base as any;
    }
    if (current.type !== 'Identifier') {
      this.logger('Unsupported array base expression.');
      return 0;
    }
    basePath.push(...(current as IdentifierExpressionNode).path);
    const value = env.read(basePath, indices);
    if (value === undefined) {
      this.logger(`Array element ${basePath.join('.')} not found.`);
      return 0;
    }
    return value;
  }

  private evaluateUnary(node: UnaryExpressionNode, env: ExecutionEnv): StValue {
    const argument = this.evaluateExpression(node.argument, env);
    switch (node.operator) {
      case 'NOT':
        return !this.toBoolean(argument);
      case '+':
        return +this.toNumber(argument);
      case '-':
        return -this.toNumber(argument);
      default:
        this.logger(`Unsupported unary operator ${node.operator}`);
        return 0;
    }
  }

  private evaluateBinary(node: BinaryExpressionNode, env: ExecutionEnv): StValue {
    const left = this.evaluateExpression(node.left, env);
    const right = this.evaluateExpression(node.right, env);
    const operator = node.operator as BinaryOperator;

    switch (operator) {
      case '+':
        return this.add(left, right);
      case '-':
        return this.toNumber(left) - this.toNumber(right);
      case '*':
        return this.toNumber(left) * this.toNumber(right);
      case '/':
        return this.toNumber(left) / this.toNumber(right);
      case 'MOD':
        return this.toInteger(left) % this.toInteger(right);
      case 'AND':
        return this.toBoolean(left) && this.toBoolean(right);
      case 'OR':
        return this.toBoolean(left) || this.toBoolean(right);
      case 'XOR':
        return this.toBoolean(left) !== this.toBoolean(right);
      case '=':
        return this.equals(left, right);
      case '<>':
        return !this.equals(left, right);
      case '<':
        return this.compare(left, right) < 0;
      case '<=':
        return this.compare(left, right) <= 0;
      case '>':
        return this.compare(left, right) > 0;
      case '>=':
        return this.compare(left, right) >= 0;
      default:
        this.logger(`Unsupported binary operator ${operator}`);
        return 0;
    }
  }

  private evaluateFunctionCall(node: FunctionCallExpressionNode, env: ExecutionEnv): StValue {
    const args = node.args.map(arg => this.evaluateExpression(arg, env));
    const result = env.callFunction(node.path, args);
    if (result === undefined) {
      this.logger(`Function ${node.path.join('.')} returned undefined.`);
      return 0;
    }
    return result;
  }

  private add(left: StValue, right: StValue): StValue {
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left) + String(right);
    }
    return this.toNumber(left) + this.toNumber(right);
  }

  private equals(left: StValue, right: StValue): boolean {
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left).toLowerCase() === String(right).toLowerCase();
    }
    if (typeof left === 'boolean' || typeof right === 'boolean') {
      return this.toBoolean(left) === this.toBoolean(right);
    }
    return this.toNumber(left) === this.toNumber(right);
  }

  private compare(left: StValue, right: StValue): number {
    if (typeof left === 'string' || typeof right === 'string') {
      const l = String(left).toLowerCase();
      const r = String(right).toLowerCase();
      if (l < r) return -1;
      if (l > r) return 1;
      return 0;
    }
    const numericLeft = this.toNumber(left);
    const numericRight = this.toNumber(right);
    if (numericLeft < numericRight) return -1;
    if (numericLeft > numericRight) return 1;
    return 0;
  }

  private toNumber(value: StValue): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private toInteger(value: StValue): number {
    return Math.trunc(this.toNumber(value));
  }

  private toBoolean(value: StValue): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === 'on') {
      return true;
    }
    if (normalized === 'false' || normalized === 'off') {
      return false;
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric !== 0;
    }
    return normalized.length > 0;
  }
}
