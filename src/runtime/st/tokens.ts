import { createToken, Lexer } from 'chevrotain';

// Whitespace and comments
const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED
});

const LineComment = createToken({
  name: 'LineComment',
  pattern: /\/\/[^\n\r]*/,
  group: Lexer.SKIPPED
});

const BlockComment = createToken({
  name: 'BlockComment',
  pattern: /\(\*[\s\S]*?\*\)/,
  group: Lexer.SKIPPED
});

// Symbols
export const Assignment = createToken({ name: 'Assignment', pattern: /:=/ });
export const Range = createToken({ name: 'Range', pattern: /\.\./ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /\]/ });
export const AddressLiteral = createToken({ name: 'AddressLiteral', pattern: /%[IQM][A-Za-z0-9_.:-]+/ });

// Operators
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Times = createToken({ name: 'Times', pattern: /\*/ });
export const Divide = createToken({ name: 'Divide', pattern: /\// });
export const Equal = createToken({ name: 'Equal', pattern: /=/ });
export const NotEqual = createToken({ name: 'NotEqual', pattern: /<>/ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const LessThanEqual = createToken({ name: 'LessThanEqual', pattern: /<=/ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const GreaterThanEqual = createToken({ name: 'GreaterThanEqual', pattern: />=/ });

export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[A-Za-z_][A-Za-z0-9_]*/
});

// Keywords
const keyword = (name: string) =>
  createToken({
    name,
    pattern: new RegExp(name.replace(/_/g, '_'), 'i'),
    longer_alt: Identifier
  });

export const PROGRAM = keyword('PROGRAM');
export const VAR = keyword('VAR');
export const VAR_INPUT = keyword('VAR_INPUT');
export const VAR_OUTPUT = keyword('VAR_OUTPUT');
export const VAR_IN_OUT = keyword('VAR_IN_OUT');
export const VAR_GLOBAL = keyword('VAR_GLOBAL');
export const VAR_EXTERNAL = keyword('VAR_EXTERNAL');
export const VAR_TEMP = keyword('VAR_TEMP');
export const END_VAR = keyword('END_VAR');
export const END_PROGRAM = keyword('END_PROGRAM');
export const RETAIN = keyword('RETAIN');
export const PERSISTENT = keyword('PERSISTENT');
export const CONSTANT = keyword('CONSTANT');
export const AT = keyword('AT');

export const IF = keyword('IF');
export const THEN = keyword('THEN');
export const ELSIF = keyword('ELSIF');
export const ELSE = keyword('ELSE');
export const END_IF = keyword('END_IF');

export const CASE = keyword('CASE');
export const OF = keyword('OF');
export const END_CASE = keyword('END_CASE');

export const FOR = keyword('FOR');
export const TO = keyword('TO');
export const BY = keyword('BY');
export const DO = keyword('DO');
export const END_FOR = keyword('END_FOR');

export const WHILE = keyword('WHILE');
export const END_WHILE = keyword('END_WHILE');

export const REPEAT = keyword('REPEAT');
export const UNTIL = keyword('UNTIL');
export const END_REPEAT = keyword('END_REPEAT');

export const EXIT = keyword('EXIT');
export const RETURN = keyword('RETURN');

export const TRUE = keyword('TRUE');
export const FALSE = keyword('FALSE');

export const NOT = keyword('NOT');
export const AND = keyword('AND');
export const OR = keyword('OR');
export const XOR = keyword('XOR');
export const MOD = keyword('MOD');

export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /\d+(\.\d+)?([Ee][+\-]?\d+)?/
});

export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"([^"]|"")*"/
});

export const allTokens = [
  WhiteSpace,
  LineComment,
  BlockComment,
  Assignment,
  Range,
  Comma,
  Colon,
  Semicolon,
  Dot,
  LParen,
  RParen,
  LBracket,
  RBracket,
  AddressLiteral,
  Plus,
  Minus,
  Times,
  Divide,
  NotEqual,
  LessThanEqual,
  GreaterThanEqual,
  LessThan,
  GreaterThan,
  Equal,
  PROGRAM,
  VAR_GLOBAL,
  VAR_EXTERNAL,
  VAR_INPUT,
  VAR_OUTPUT,
  VAR_IN_OUT,
  VAR_TEMP,
  VAR,
  END_VAR,
  END_PROGRAM,
  RETAIN,
  PERSISTENT,
  CONSTANT,
  AT,
  IF,
  THEN,
  ELSIF,
  ELSE,
  END_IF,
  CASE,
  OF,
  END_CASE,
  FOR,
  TO,
  BY,
  DO,
  END_FOR,
  WHILE,
  END_WHILE,
  REPEAT,
  UNTIL,
  END_REPEAT,
  EXIT,
  RETURN,
  TRUE,
  FALSE,
  NOT,
  AND,
  OR,
  XOR,
  MOD,
  Identifier,
  NumberLiteral,
  StringLiteral
];

export const StLexer = new Lexer(allTokens, {
  positionTracking: 'onlyOffset',
  ensureOptimizations: true
});

export type TokenVocabulary = { [name: string]: ReturnType<typeof createToken> };
