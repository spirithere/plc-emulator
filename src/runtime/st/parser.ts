import { CstParser } from 'chevrotain';
import {
  allTokens,
  AND,
  Assignment,
  BY,
  CASE,
  Colon,
  CONSTANT,
  DO,
  ELSE,
  END_CASE,
  END_FOR,
  END_IF,
  END_PROGRAM,
  END_REPEAT,
  END_VAR,
  END_WHILE,
  ELSIF,
  EXIT,
  FALSE,
  FOR,
  Identifier,
  IF,
  LBracket,
  LParen,
  MOD,
  PERSISTENT,
  NOT,
  NumberLiteral,
  OF,
  OR,
  RETAIN,
  PROGRAM,
  Range,
  REPEAT,
  RETURN,
  RBracket,
  RParen,
  Semicolon,
  StringLiteral,
  THEN,
  TO,
  TRUE,
  UNTIL,
  VAR,
  VAR_EXTERNAL,
  VAR_GLOBAL,
  VAR_IN_OUT,
  VAR_INPUT,
  VAR_OUTPUT,
  VAR_TEMP,
  WHILE,
  XOR,
  Comma,
  Divide,
  Dot,
  Equal,
  GreaterThan,
  GreaterThanEqual,
  LessThan,
  LessThanEqual,
  Minus,
  NotEqual,
  Plus,
  Times,
  AT,
  AddressLiteral
} from './tokens';

export class StructuredTextParser extends CstParser {
  constructor() {
    super(allTokens, {
      nodeLocationTracking: 'onlyOffset'
    });
    this.performSelfAnalysis();
  }

  public program = this.RULE('program', () => {
    this.CONSUME(PROGRAM);
    this.CONSUME(Identifier);
    this.MANY(() => {
      this.SUBRULE(this.varSection);
    });
    this.SUBRULE(this.statementList, { LABEL: 'body' });
    this.CONSUME(END_PROGRAM);
  });

  private varSection = this.RULE('varSection', () => {
    this.OR([
      { ALT: () => this.CONSUME(VAR) },
      { ALT: () => this.CONSUME(VAR_INPUT) },
      { ALT: () => this.CONSUME(VAR_OUTPUT) },
      { ALT: () => this.CONSUME(VAR_IN_OUT) },
      { ALT: () => this.CONSUME(VAR_GLOBAL) },
      { ALT: () => this.CONSUME(VAR_EXTERNAL) },
      { ALT: () => this.CONSUME(VAR_TEMP) }
    ]);
    this.MANY(() => {
      this.SUBRULE(this.varDeclaration);
    });
    this.CONSUME(END_VAR);
  });

  private varDeclaration = this.RULE('varDeclaration', () => {
    this.CONSUME(Identifier, { LABEL: 'varName' });
    this.OPTION1(() => {
      this.CONSUME(AT);
      this.CONSUME(AddressLiteral, { LABEL: 'address' });
    });
    this.CONSUME(Colon);
    this.SUBRULE(this.typeReference);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(RETAIN) },
        { ALT: () => this.CONSUME(PERSISTENT) },
        { ALT: () => this.CONSUME(CONSTANT) }
      ]);
    });
    this.OPTION2(() => {
      this.CONSUME(Assignment);
      this.SUBRULE(this.expression);
    });
    this.CONSUME(Semicolon);
  });

  private typeReference = this.RULE('typeReference', () => {
    this.CONSUME(Identifier);
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME1(Dot);
            this.CONSUME2(Identifier);
          }
        },
        {
          ALT: () => {
            this.CONSUME1(LBracket);
            this.SUBRULE(this.expression);
            this.CONSUME1(RBracket);
            this.OPTION(() => {
              this.CONSUME(OF);
              this.SUBRULE2(this.typeReference);
            });
          }
        }
      ]);
    });
  });

  private statementList = this.RULE('statementList', () => {
    this.MANY(() => {
      this.SUBRULE(this.statement);
      this.OPTION(() => {
        this.CONSUME(Semicolon);
      });
    });
  });

  private statement = this.RULE('statement', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.ifStatement) },
      { ALT: () => this.SUBRULE(this.caseStatement) },
      { ALT: () => this.SUBRULE(this.forStatement) },
      { ALT: () => this.SUBRULE(this.whileStatement) },
      { ALT: () => this.SUBRULE(this.repeatStatement) },
      { ALT: () => this.SUBRULE(this.exitStatement) },
      { ALT: () => this.SUBRULE(this.returnStatement) },
      { ALT: () => this.SUBRULE(this.assignmentStatement) }
    ]);
  });

  private assignmentStatement = this.RULE('assignmentStatement', () => {
    this.SUBRULE(this.variableAccess);
    this.CONSUME(Assignment);
    this.SUBRULE(this.expression);
  });

  private ifStatement = this.RULE('ifStatement', () => {
    this.CONSUME(IF);
    this.SUBRULE(this.expression, { LABEL: 'condition' });
    this.CONSUME(THEN);
    this.SUBRULE(this.statementList, { LABEL: 'thenBlock' });
    this.MANY(() => {
      this.CONSUME(ELSIF);
      this.SUBRULE2(this.expression, { LABEL: 'elsifCondition' });
      this.CONSUME2(THEN);
      this.SUBRULE2(this.statementList, { LABEL: 'elsifBlock' });
    });
    this.OPTION(() => {
      this.CONSUME(ELSE);
      this.SUBRULE3(this.statementList, { LABEL: 'elseBlock' });
    });
    this.CONSUME(END_IF);
  });

  private caseStatement = this.RULE('caseStatement', () => {
    this.CONSUME(CASE);
    this.SUBRULE(this.expression, { LABEL: 'selector' });
    this.CONSUME(OF);
    this.AT_LEAST_ONE(() => {
      this.SUBRULE(this.caseBranch);
    });
    this.CONSUME(END_CASE);
  });

  private caseBranch = this.RULE('caseBranch', () => {
    this.SUBRULE(this.caseLabelList);
    this.CONSUME(Colon);
    this.SUBRULE(this.statementList);
  });

  private caseLabelList = this.RULE('caseLabelList', () => {
    this.SUBRULE(this.caseLabel);
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE2(this.caseLabel);
    });
  });

  private caseLabel = this.RULE('caseLabel', () => {
    this.SUBRULE(this.expression, { LABEL: 'from' });
    this.OPTION(() => {
      this.CONSUME(Range);
      this.SUBRULE2(this.expression, { LABEL: 'to' });
    });
  });

  private forStatement = this.RULE('forStatement', () => {
    this.CONSUME(FOR);
    this.CONSUME(Identifier, { LABEL: 'controlVar' });
    this.CONSUME(Assignment);
    this.SUBRULE(this.expression, { LABEL: 'initialValue' });
    this.CONSUME(TO);
    this.SUBRULE2(this.expression, { LABEL: 'finalValue' });
    this.OPTION(() => {
      this.CONSUME(BY);
      this.SUBRULE3(this.expression, { LABEL: 'step' });
    });
    this.CONSUME(DO);
    this.SUBRULE(this.statementList, { LABEL: 'body' });
    this.CONSUME(END_FOR);
  });

  private whileStatement = this.RULE('whileStatement', () => {
    this.CONSUME(WHILE);
    this.SUBRULE(this.expression, { LABEL: 'condition' });
    this.CONSUME(DO);
    this.SUBRULE(this.statementList, { LABEL: 'body' });
    this.CONSUME(END_WHILE);
  });

  private repeatStatement = this.RULE('repeatStatement', () => {
    this.CONSUME(REPEAT);
    this.SUBRULE(this.statementList, { LABEL: 'body' });
    this.CONSUME(UNTIL);
    this.SUBRULE(this.expression, { LABEL: 'condition' });
    this.CONSUME(END_REPEAT);
  });

  private exitStatement = this.RULE('exitStatement', () => {
    this.CONSUME(EXIT);
  });

  private returnStatement = this.RULE('returnStatement', () => {
    this.CONSUME(RETURN);
    this.OPTION(() => {
      this.SUBRULE(this.expression, { LABEL: 'value' });
    });
  });

  private variableAccess = this.RULE('variableAccess', () => {
    this.SUBRULE(this.qualifiedIdentifier);
    this.MANY(() => {
      this.CONSUME(LBracket);
      this.SUBRULE(this.expression);
      this.CONSUME(RBracket);
    });
  });

  private qualifiedIdentifier = this.RULE('qualifiedIdentifier', () => {
    this.CONSUME(Identifier);
    this.MANY(() => {
      this.CONSUME(Dot);
      this.CONSUME2(Identifier);
    });
  });

  private expression = this.RULE('expression', () => {
    this.SUBRULE(this.logicalOrExpression);
  });

  private logicalOrExpression = this.RULE('logicalOrExpression', () => {
    this.SUBRULE(this.logicalAndExpression);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(OR) },
        { ALT: () => this.CONSUME(XOR) }
      ]);
      this.SUBRULE2(this.logicalAndExpression);
    });
  });

  private logicalAndExpression = this.RULE('logicalAndExpression', () => {
    this.SUBRULE(this.comparisonExpression);
    this.MANY(() => {
      this.CONSUME(AND);
      this.SUBRULE2(this.comparisonExpression);
    });
  });

  private comparisonExpression = this.RULE('comparisonExpression', () => {
    this.SUBRULE(this.additiveExpression);
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.CONSUME(Equal) },
        { ALT: () => this.CONSUME(NotEqual) },
        { ALT: () => this.CONSUME(LessThanEqual) },
        { ALT: () => this.CONSUME(GreaterThanEqual) },
        { ALT: () => this.CONSUME(LessThan) },
        { ALT: () => this.CONSUME(GreaterThan) }
      ]);
      this.SUBRULE2(this.additiveExpression);
    });
  });

  private additiveExpression = this.RULE('additiveExpression', () => {
    this.SUBRULE(this.multiplicativeExpression);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Plus) },
        { ALT: () => this.CONSUME(Minus) }
      ]);
      this.SUBRULE2(this.multiplicativeExpression);
    });
  });

  private multiplicativeExpression = this.RULE('multiplicativeExpression', () => {
    this.SUBRULE(this.unaryExpression);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Times) },
        { ALT: () => this.CONSUME(Divide) },
        { ALT: () => this.CONSUME(MOD) }
      ]);
      this.SUBRULE2(this.unaryExpression);
    });
  });

  private unaryExpression = this.RULE('unaryExpression', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(NOT);
          this.SUBRULE(this.unaryExpression);
        }
      },
      {
        ALT: () => {
          this.CONSUME(Plus);
          this.SUBRULE2(this.unaryExpression);
        }
      },
      {
        ALT: () => {
          this.CONSUME(Minus);
          this.SUBRULE3(this.unaryExpression);
        }
      },
      { ALT: () => this.SUBRULE(this.primaryExpression) }
    ]);
  });

  private primaryExpression = this.RULE('primaryExpression', () => {
    this.OR([
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.SUBRULE(this.booleanLiteral) },
      { ALT: () => this.CONSUME(StringLiteral) },
      {
        ALT: () => {
          this.CONSUME(LParen);
          this.SUBRULE(this.expression);
          this.CONSUME(RParen);
        }
      },
      {
        ALT: () => this.SUBRULE(this.functionCall),
        GATE: () => this.LA(1).tokenType === Identifier && this.LA(2).tokenType === LParen
      },
      { ALT: () => this.SUBRULE(this.variableAccess) }
    ]);
  });

  private booleanLiteral = this.RULE('booleanLiteral', () => {
    this.OR([
      { ALT: () => this.CONSUME(TRUE) },
      { ALT: () => this.CONSUME(FALSE) }
    ]);
  });

  private functionCall = this.RULE('functionCall', () => {
    this.CONSUME(Identifier);
    this.MANY(() => {
      this.CONSUME(Dot);
      this.CONSUME2(Identifier);
    });
    this.CONSUME(LParen);
    this.OPTION(() => {
      this.SUBRULE(this.argumentList);
    });
    this.CONSUME(RParen);
  });

  private argumentList = this.RULE('argumentList', () => {
    this.SUBRULE(this.expression);
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE2(this.expression);
    });
  });
}
