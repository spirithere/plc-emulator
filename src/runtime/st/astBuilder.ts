import { CstNode, IToken } from 'chevrotain';
import { StructuredTextParser } from './parser';
import {
  ArrayAccessExpressionNode,
  AssignmentStatementNode,
  BinaryExpressionNode,
  CaseBranchNode,
  CaseSelectorNode,
  CaseStatementNode,
  ExpressionNode,
  ExitStatementNode,
  ForStatementNode,
  FunctionCallExpressionNode,
  IdentifierExpressionNode,
  IfStatementNode,
  LiteralExpressionNode,
  ProgramNode,
  RangeSelectorNode,
  RepeatStatementNode,
  ReturnStatementNode,
  SourceRange,
  StatementNode,
  UnaryExpressionNode,
  VarDeclarationNode,
  VarSectionNode,
  VarSectionType,
  VariableAccessNode,
  WhileStatementNode
} from './ast';
import { StLexer } from './tokens';

const baseParser = new StructuredTextParser();
const BaseVisitor = baseParser.getBaseCstVisitorConstructor();

function rangeFromTokens(first?: IToken, last?: IToken): SourceRange | undefined {
  if (!first || !last) {
    return undefined;
  }
  const startOffset = first.startOffset ?? 0;
  const endOffset = last.endOffset ?? startOffset;
  return { startOffset, endOffset };
}

function tokenImage(token?: IToken): string | undefined {
  return token?.image;
}

export interface ParseDiagnostic {
  message: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ParseResult {
  program?: ProgramNode;
  diagnostics: ParseDiagnostic[];
}

class AstBuilder extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  program(ctx: Record<string, any>): ProgramNode {
    const nameToken: IToken = ctx.Identifier[0];
    const varSections: VarSectionNode[] =
      (ctx.varSection as CstNode[] | undefined)?.map(section => this.visit(section)) ?? [];
    const body = this.visit(ctx.body[0]) as StatementNode[];
    const endToken: IToken = ctx.END_PROGRAM[0];
    return {
      type: 'Program',
      name: nameToken.image ?? 'Main',
      varSections,
      body,
      range: rangeFromTokens(nameToken, endToken)
    };
  }

  statementList(ctx: Record<string, any>): StatementNode[] {
    const statements: StatementNode[] = [];
    const children = ctx.statement as CstNode[] | undefined;
    if (!children) {
      return statements;
    }
    children.forEach(child => {
      const visited = this.visit(child) as StatementNode | StatementNode[];
      if (Array.isArray(visited)) {
        statements.push(...visited);
      } else if (visited) {
        statements.push(visited);
      }
    });
    return statements;
  }

  varSection(ctx: Record<string, any>): VarSectionNode {
    const keywordToken: IToken =
      ctx.VAR?.[0] ??
      ctx.VAR_INPUT?.[0] ??
      ctx.VAR_OUTPUT?.[0] ??
      ctx.VAR_IN_OUT?.[0] ??
      ctx.VAR_TEMP?.[0];
    const section: VarSectionType = (keywordToken.image?.toUpperCase() as VarSectionType) ?? 'VAR';
    const declarations =
      (ctx.varDeclaration as CstNode[] | undefined)?.map(node => this.visit(node) as VarDeclarationNode) ?? [];
    const endToken: IToken = ctx.END_VAR[0];
    return {
      type: 'VarSection',
      section,
      declarations,
      range: rangeFromTokens(keywordToken, endToken)
    };
  }

  varDeclaration(ctx: Record<string, any>): VarDeclarationNode {
    const nameToken: IToken = ctx.Identifier[0];
    const dataType = this.visit(ctx.typeReference[0]) as string;
    const declarationNode: VarDeclarationNode = {
      type: 'VarDeclaration',
      name: nameToken.image ?? '',
      dataType: dataType || 'UNKNOWN',
      range: rangeFromTokens(nameToken, ctx.Semicolon[0])
    };
    if (ctx.expression) {
      declarationNode.initializer = this.visit(ctx.expression[0]) as ExpressionNode;
    }
    return declarationNode;
  }

  assignmentStatement(ctx: Record<string, any>): AssignmentStatementNode {
    const target = this.visit(ctx.variableAccess[0]) as VariableAccessNode;
    const expression = this.visit(ctx.expression[0]) as ExpressionNode;
    return {
      type: 'Assignment',
      target,
      expression
    };
  }

  variableAccess(ctx: Record<string, any>): VariableAccessNode {
    const path = this.visit(ctx.qualifiedIdentifier[0]) as string[];
    const indices: ExpressionNode[] =
      (ctx.expression as CstNode[] | undefined)?.map(node => this.visit(node) as ExpressionNode) ?? [];
    return {
      type: 'VariableAccess',
      path,
      indices: indices.length ? indices : undefined
    };
  }

  qualifiedIdentifier(ctx: Record<string, any>): string[] {
    const identifiers: IToken[] = ctx.Identifier as IToken[];
    return identifiers.map(token => token.image ?? '').filter(Boolean);
  }

  ifStatement(ctx: Record<string, any>): IfStatementNode {
    const branches: Array<{ condition: ExpressionNode; statements: StatementNode[] }> = [];
    const firstCondition = this.visit(ctx.condition[0]) as ExpressionNode;
    const thenStatements = this.visit(ctx.thenBlock[0]) as StatementNode[];
    branches.push({ condition: firstCondition, statements: thenStatements });

    const elsifConditions = ctx.elsifCondition as CstNode[] | undefined;
    const elsifBlocks = ctx.elsifBlock as CstNode[] | undefined;
    if (elsifConditions && elsifBlocks) {
      for (let i = 0; i < elsifConditions.length; i += 1) {
        const condition = this.visit(elsifConditions[i]) as ExpressionNode;
        const statements = this.visit(elsifBlocks[i]) as StatementNode[];
        branches.push({ condition, statements });
      }
    }

    let elseBranch: StatementNode[] | undefined;
    if (ctx.elseBlock) {
      elseBranch = this.visit(ctx.elseBlock[0]) as StatementNode[];
    }

    const endToken: IToken = ctx.END_IF[0];

    return {
      type: 'If',
      branches,
      elseBranch,
      range: rangeFromTokens(ctx.IF?.[0], endToken)
    };
  }

  caseStatement(ctx: Record<string, any>): CaseStatementNode {
    const expression = this.visit(ctx.selector[0]) as ExpressionNode;
    const cases: CaseBranchNode[] =
      (ctx.caseBranch as CstNode[] | undefined)?.map(branch => this.visit(branch) as CaseBranchNode) ?? [];
    return {
      type: 'Case',
      expression,
      cases,
      range: rangeFromTokens(ctx.CASE?.[0], ctx.END_CASE?.[0])
    };
  }

  caseBranch(ctx: Record<string, any>): CaseBranchNode {
    const selectors = this.visit(ctx.caseLabelList[0]) as CaseSelectorNode[];
      const statements = this.visit(ctx.statementList[0]) as StatementNode[];
    return {
      type: 'CaseBranch',
      selectors,
      statements
    };
  }

  caseLabelList(ctx: Record<string, any>): CaseSelectorNode[] {
    const labels = ctx.caseLabel as CstNode[] | undefined;
    if (!labels) {
      return [];
    }
    return labels.flatMap(label => this.visit(label) as CaseSelectorNode[]);
  }

  caseLabel(ctx: Record<string, any>): CaseSelectorNode[] {
    if (ctx.Range) {
      const from = this.visit(ctx.from[0]) as ExpressionNode;
      const to = this.visit(ctx.to[0]) as ExpressionNode;
      const range: RangeSelectorNode = {
        type: 'RangeSelector',
        from,
        to
      };
      return [range];
    }
    return [this.visit(ctx.from[0]) as ExpressionNode];
  }

  forStatement(ctx: Record<string, any>): ForStatementNode {
    const controlVar = tokenImage(ctx.controlVar?.[0]) ?? '';
    const initialValue = this.visit(ctx.initialValue[0]) as ExpressionNode;
    const finalValue = this.visit(ctx.finalValue[0]) as ExpressionNode;
    const step = ctx.step ? (this.visit(ctx.step[0]) as ExpressionNode) : undefined;
    const body = this.visit(ctx.body[0]) as StatementNode[];
    return {
      type: 'For',
      controlVariable: controlVar,
      initialValue,
      finalValue,
      step,
      body,
      range: rangeFromTokens(ctx.FOR?.[0], ctx.END_FOR?.[0])
    };
  }

  whileStatement(ctx: Record<string, any>): WhileStatementNode {
    return {
      type: 'While',
      condition: this.visit(ctx.condition[0]) as ExpressionNode,
      body: this.visit(ctx.body[0]) as StatementNode[],
      range: rangeFromTokens(ctx.WHILE?.[0], ctx.END_WHILE?.[0])
    };
  }

  repeatStatement(ctx: Record<string, any>): RepeatStatementNode {
    return {
      type: 'Repeat',
      body: this.visit(ctx.body[0]) as StatementNode[],
      condition: this.visit(ctx.condition[0]) as ExpressionNode,
      range: rangeFromTokens(ctx.REPEAT?.[0], ctx.END_REPEAT?.[0])
    };
  }

  exitStatement(): ExitStatementNode {
    return { type: 'Exit' };
  }

  returnStatement(ctx: Record<string, any>): ReturnStatementNode {
    return {
      type: 'Return',
      expression: ctx.value ? (this.visit(ctx.value[0]) as ExpressionNode) : undefined,
      range: rangeFromTokens(ctx.RETURN?.[0], ctx.RETURN?.[0])
    };
  }

  logicalOrExpression(ctx: Record<string, any>): ExpressionNode {
    return this.visitBinaryChain(ctx, 'logicalAndExpression', ctx.OR, ctx.XOR);
  }

  logicalAndExpression(ctx: Record<string, any>): ExpressionNode {
    return this.visitBinaryChain(ctx, 'comparisonExpression', ctx.AND);
  }

  comparisonExpression(ctx: Record<string, any>): ExpressionNode {
    const left = this.visit(ctx.additiveExpression[0]) as ExpressionNode;
    if (!ctx.Equal && !ctx.NotEqual && !ctx.LessThan && !ctx.LessThanEqual && !ctx.GreaterThan && !ctx.GreaterThanEqual) {
      return left;
    }
    const operatorToken: IToken =
      ctx.Equal?.[0] ??
      ctx.NotEqual?.[0] ??
      ctx.LessThan?.[0] ??
      ctx.LessThanEqual?.[0] ??
      ctx.GreaterThan?.[0] ??
      ctx.GreaterThanEqual?.[0];
    const right = this.visit(ctx.additiveExpression[1]) as ExpressionNode;
    const node: BinaryExpressionNode = {
      type: 'BinaryExpression',
      operator: operatorToken.image?.toUpperCase() as BinaryExpressionNode['operator'],
      left,
      right
    };
    return node;
  }

  additiveExpression(ctx: Record<string, any>): ExpressionNode {
    return this.visitBinaryChain(ctx, 'multiplicativeExpression', ctx.Plus, ctx.Minus);
  }

  multiplicativeExpression(ctx: Record<string, any>): ExpressionNode {
    return this.visitBinaryChain(ctx, 'unaryExpression', ctx.Times, ctx.Divide, ctx.MOD);
  }

  private visitBinaryChain(
    ctx: Record<string, any>,
    subRuleName: string,
    ...operatorTokensArrays: Array<IToken[] | undefined>
  ): ExpressionNode {
    const operands = ctx[subRuleName] as CstNode[];
    let expression = this.visit(operands[0]) as ExpressionNode;
    const operators: IToken[] = [];
    operatorTokensArrays.forEach(arr => {
      if (arr) {
        arr.forEach(token => operators.push(token));
      }
    });
    operators.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
    operators.forEach((token, index) => {
      const rightOperand = this.visit(operands[index + 1]) as ExpressionNode;
      expression = {
        type: 'BinaryExpression',
        operator: token.image?.toUpperCase() as BinaryExpressionNode['operator'],
        left: expression,
        right: rightOperand
      };
    });
    return expression;
  }

  unaryExpression(ctx: Record<string, any>): ExpressionNode {
    if (ctx.NOT) {
      return {
        type: 'UnaryExpression',
        operator: 'NOT',
        argument: this.visit(ctx.unaryExpression[0]) as ExpressionNode
      };
    }

    if (ctx.Plus) {
      return {
        type: 'UnaryExpression',
        operator: '+',
        argument: this.visit(ctx.unaryExpression[0]) as ExpressionNode
      };
    }

    if (ctx.Minus) {
      return {
        type: 'UnaryExpression',
        operator: '-',
        argument: this.visit(ctx.unaryExpression[0]) as ExpressionNode
      };
    }

    return this.visit(ctx.primaryExpression[0]) as ExpressionNode;
  }

  primaryExpression(ctx: Record<string, any>): ExpressionNode {
    if (ctx.NumberLiteral) {
      const token: IToken = ctx.NumberLiteral[0];
      return {
        type: 'Literal',
        value: Number(token.image),
        literalType: 'Number',
        range: rangeFromTokens(token, token)
      };
    }

    if (ctx.StringLiteral) {
      const token: IToken = ctx.StringLiteral[0];
      const inner = token.image.slice(1, -1).replace(/""/g, '"');
      return {
        type: 'Literal',
        value: inner,
        literalType: 'String',
        range: rangeFromTokens(token, token)
      };
    }

    if (ctx.booleanLiteral) {
      return this.visit(ctx.booleanLiteral[0]) as ExpressionNode;
    }

    if (ctx.functionCall) {
      return this.visit(ctx.functionCall[0]) as FunctionCallExpressionNode;
    }

    if (ctx.variableAccess) {
      const variable = this.visit(ctx.variableAccess[0]) as VariableAccessNode;
      let expression: ExpressionNode = {
        type: 'Identifier',
        path: variable.path
      } as IdentifierExpressionNode;
      (variable.indices ?? []).forEach(indexExpr => {
        expression = {
          type: 'ArrayAccess',
          base: expression,
          index: indexExpr
        } as ArrayAccessExpressionNode;
      });
      return expression;
    }

    if (ctx.expression) {
      return this.visit(ctx.expression[0]) as ExpressionNode;
    }

    throw new Error('Unknown primary expression');
  }

  booleanLiteral(ctx: Record<string, any>): LiteralExpressionNode {
    const token: IToken = ctx.TRUE?.[0] ?? ctx.FALSE?.[0];
    return {
      type: 'Literal',
      value: token.image?.toUpperCase() === 'TRUE',
      literalType: 'Boolean',
      range: rangeFromTokens(token, token)
    };
  }

  functionCall(ctx: Record<string, any>): FunctionCallExpressionNode {
    const identifiers: IToken[] = ctx.Identifier as IToken[];
    const path = identifiers.map(token => token.image ?? '').filter(Boolean);
    const args =
      ctx.argumentList?.[0] !== undefined
        ? (this.visit(ctx.argumentList[0]) as ExpressionNode[])
        : [];
    return {
      type: 'FunctionCall',
      path,
      args
    };
  }

  statement(ctx: Record<string, any>): StatementNode {
    if (ctx.assignmentStatement) {
      return this.visit(ctx.assignmentStatement[0]) as AssignmentStatementNode;
    }
    if (ctx.ifStatement) {
      return this.visit(ctx.ifStatement[0]) as IfStatementNode;
    }
    if (ctx.caseStatement) {
      return this.visit(ctx.caseStatement[0]) as CaseStatementNode;
    }
    if (ctx.forStatement) {
      return this.visit(ctx.forStatement[0]) as ForStatementNode;
    }
    if (ctx.whileStatement) {
      return this.visit(ctx.whileStatement[0]) as WhileStatementNode;
    }
    if (ctx.repeatStatement) {
      return this.visit(ctx.repeatStatement[0]) as RepeatStatementNode;
    }
    if (ctx.exitStatement) {
      return this.visit(ctx.exitStatement[0]) as ExitStatementNode;
    }
    if (ctx.returnStatement) {
      return this.visit(ctx.returnStatement[0]) as ReturnStatementNode;
    }
    throw new Error('Unhandled statement node.');
  }

  expression(ctx: Record<string, any>): ExpressionNode {
    return this.visit(ctx.logicalOrExpression[0]) as ExpressionNode;
  }

  argumentList(ctx: Record<string, any>): ExpressionNode[] {
    const expressions = ctx.expression as CstNode[] | undefined;
    if (!expressions) {
      return [];
    }
    return expressions.map(expr => this.visit(expr) as ExpressionNode);
  }

  typeReference(ctx: Record<string, any>): string {
    const identifiers: IToken[] = (ctx.Identifier as IToken[]) ?? [];
    let result = identifiers.map(token => token.image ?? '').filter(Boolean).join('.');
    if (ctx.typeReference) {
      const nested = this.visit(ctx.typeReference[0]) as string;
      if (ctx.OF) {
        result = `${result} OF ${nested}`;
      } else if (nested) {
        result = `${result}.${nested}`;
      }
    }
    if (!result) {
      result = 'UNKNOWN';
    }
    return result;
  }
}

const builder = new AstBuilder();

export function buildAst(cst: CstNode): ProgramNode {
  return builder.visit(cst) as ProgramNode;
}

export function parseStructuredText(text: string): ParseResult {
  const lexResult = StLexer.tokenize(text);
  const parser = new StructuredTextParser();
  parser.input = lexResult.tokens;
  const cst = parser.program();

  const diagnostics: ParseDiagnostic[] = [];
  if (lexResult.errors.length > 0) {
    lexResult.errors.forEach(error =>
      diagnostics.push({
        message: error.message,
        startOffset: error.offset,
        endOffset: error.offset
      })
    );
  }

  if (parser.errors.length > 0) {
    parser.errors.forEach(error =>
      diagnostics.push({
        message: error.message,
        startOffset: error.token?.startOffset,
        endOffset: error.token?.endOffset
      })
    );
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const program = buildAst(cst);
  return { program, diagnostics };
}
