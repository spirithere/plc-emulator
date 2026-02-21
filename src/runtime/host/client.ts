#!/usr/bin/env node
import * as net from 'node:net';

interface CommandConfig {
  method: string;
  buildParams: (args: string[]) => any;
  description: string;
}

const HOST = process.env.PLC_RUN_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.PLC_RUN_PORT ?? '8123', 10);
const args = process.argv.slice(2);

let customMethod: string | undefined;
let methodOverride: string | undefined;

const commands: Record<string, CommandConfig> = {
  ping: {
    method: 'ping',
    buildParams: () => ({}),
    description: 'Ensure the runtime host is reachable.'
  },
  start: {
    method: 'runtime.start',
    buildParams: ([scan]) => ({ scanTimeMs: scan ? Number(scan) || 100 : 100 }),
    description: 'Start scan cycles (optional scan time in ms).'
  },
  stop: {
    method: 'runtime.stop',
    buildParams: () => ({}),
    description: 'Stop scan cycles.'
  },
  step: {
    method: 'runtime.step',
    buildParams: ([cycles]) => ({ cycles: cycles ? Number(cycles) || 1 : 1 }),
    description: 'Execute scan cycles once while stopped (optional cycle count).'
  },
  reset: {
    method: 'runtime.reset',
    buildParams: () => ({}),
    description: 'Stop and reset runtime memory/state.'
  },
  state: {
    method: 'runtime.state.get',
    buildParams: () => ({}),
    description: 'Fetch the most recent scan snapshot.'
  },
  metrics: {
    method: 'runtime.metrics.get',
    buildParams: () => ({}),
    description: 'Fetch runtime metrics.'
  },
  vars: {
    method: 'runtime.variables.list',
    buildParams: () => ({}),
    description: 'List known variable identifiers.'
  },
  write: {
    method: 'runtime.writeVar',
    buildParams: ([id, value]) => {
      if (!id) throw new Error('Missing identifier');
      if (value === undefined) throw new Error('Missing value');
      const coerced = coerceValue(value);
      if (isInputIdentifier(id)) {
        methodOverride = 'io.setInput';
        return { identifier: id, value: Boolean(coerced) };
      }
      methodOverride = undefined;
      return { identifier: id, value: coerced };
    },
    description: 'Write a variable value. Usage: plcrun write M0 true'
  },
  input: {
    method: 'io.setInput',
    buildParams: ([id, value]) => {
      if (!id) throw new Error('Missing identifier');
      if (value === undefined) throw new Error('Missing value');
      return { identifier: id, value: Boolean(coerceValue(value)) };
    },
    description: 'Toggle an input channel. Usage: plcrun input X0 false'
  },
  rpc: {
    method: '',
    buildParams: ([methodName, json]) => {
      if (!methodName) throw new Error('Usage: plcrun rpc <method> [jsonParams]');
      customMethod = methodName;
      return json ? JSON.parse(json) : {};
    },
    description: 'Send an arbitrary JSON-RPC method. Usage: plcrun rpc runtime.start {"scanTimeMs":50}'
  }
};

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(args.length === 0 ? 1 : 0);
}

const commandName = args[0];
const commandArgs = args.slice(1);
const command = commands[commandName];

if (!command) {
  console.error(`Unknown command: ${commandName}`);
  printHelp();
  process.exit(1);
}

let params: any;
try {
  params = command.buildParams(commandArgs);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const method = commandName === 'rpc' && customMethod ? customMethod : command.method;
const resolvedMethod = methodOverride ?? method;
const requestId = Date.now();
const payload = JSON.stringify({ jsonrpc: '2.0', id: requestId, method: resolvedMethod, params }) + '\n';
methodOverride = undefined;

const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  socket.write(payload);
});

let buffer = '';
socket.setEncoding('utf8');
socket.on('data', chunk => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length > 0) {
      handleLine(line);
    }
    newlineIndex = buffer.indexOf('\n');
  }
});

socket.on('error', error => {
  console.error(`Connection error: ${(error as Error).message}`);
  process.exit(1);
});

socket.on('end', () => {
  process.exit(0);
});

function handleLine(line: string): void {
  let message: any;
  try {
    message = JSON.parse(line);
  } catch (error) {
    console.error('Malformed JSON from host:', line);
    return;
  }

  if (message.id === requestId) {
    if (message.error) {
      console.error('RPC error:', JSON.stringify(message.error, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(message.result, null, 2));
    socket.end();
  } else if (typeof message.method === 'string') {
    console.log(JSON.stringify(message, null, 2));
  }
}

function coerceValue(raw: string): number | boolean | string {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!Number.isNaN(num)) {
    return num;
  }
  return raw;
}

function isInputIdentifier(identifier: string): boolean {
  const trimmed = identifier.trim().toUpperCase();
  return trimmed.startsWith('X');
}

function printHelp(): void {
  console.log('Usage: plcrun <command> [args]\n');
  console.log('Commands:');
  Object.entries(commands).forEach(([name, conf]) => {
    if (name === 'rpc') {
      console.log(`  ${name.padEnd(8)} - ${conf.description}`);
    } else {
      console.log(`  ${name.padEnd(8)} - ${conf.description}`);
    }
  });
  console.log('\nEnvironment variables:');
  console.log('  PLC_RUN_HOST  Hostname to connect (default 127.0.0.1)');
  console.log('  PLC_RUN_PORT  Port number (default 8123)');
}
