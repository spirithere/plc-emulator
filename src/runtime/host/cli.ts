#!/usr/bin/env node
import * as readline from 'node:readline';
import * as net from 'node:net';
import { RuntimeCore } from '../runtimeCore';
import { RuntimeLogEvent } from '../runtimeTypes';
import { InMemoryPlcModelProvider, MemoryIOAdapter } from './providers';

interface RpcRequest {
  id?: number | string;
  method: string;
  params?: any;
}

interface RpcEndpoint {
  send(payload: unknown): void;
}

class RuntimeHostServer {
  private readonly rl: readline.Interface;
  private readonly tcpClients = new Set<RpcEndpoint>();
  private server?: net.Server;
  private stdoutEndpoint: RpcEndpoint;

  constructor(
    private readonly runtime: RuntimeCore,
    private readonly modelProvider: InMemoryPlcModelProvider,
    private readonly ioAdapter: MemoryIOAdapter,
    private readonly options: { port: number }
  ) {
    this.stdoutEndpoint = {
      send: payload => {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
      }
    };

    this.rl = readline.createInterface({ input: process.stdin });
    this.rl.on('line', line => this.handleLine(line, this.stdoutEndpoint));

    this.runtime.onState(event => {
      const io = this.ioAdapter.getSnapshot();
      const syncedSnapshot = { ...event.snapshot };
      io.inputs.forEach(ch => {
        syncedSnapshot[ch.id] = ch.value;
      });
      io.outputs.forEach(ch => {
        if (typeof syncedSnapshot[ch.id] === 'undefined' || typeof syncedSnapshot[ch.id] === 'boolean') {
          syncedSnapshot[ch.id] = ch.value;
        }
      });
      this.broadcastNotification('runtime.state', { ...event, snapshot: syncedSnapshot, io });
    });

    this.runtime.onRunState(running => {
      this.broadcastNotification('runtime.runState', { running });
    });

    this.runtime.onStructuredTextDiagnostics(event => {
      this.broadcastNotification('structuredText.diagnostics', event);
    });
  }

  public start(): void {
    this.startTcpServer();
  }

  public dispose(): void {
    this.rl.close();
    this.server?.close();
    this.tcpClients.clear();
  }

  private startTcpServer(): void {
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8');
      const endpoint: RpcEndpoint = {
        send: payload => {
          if (socket.writable) {
            socket.write(`${JSON.stringify(payload)}\n`);
          }
        }
      };
      this.tcpClients.add(endpoint);

      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          this.handleLine(line, endpoint);
          newlineIndex = buffer.indexOf('\n');
        }
      });

      const cleanup = (): void => {
        this.tcpClients.delete(endpoint);
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);
    });

    this.server.listen(this.options.port, '127.0.0.1', () => {
      const address = this.server?.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      this.broadcastNotification('host.ready', {
        message: 'Runtime host initialized',
        port
      });
    });
  }

  private handleLine(line: string, endpoint: RpcEndpoint): void {
    if (!line || line.trim().length === 0) {
      return;
    }

    let request: RpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      this.sendError(undefined, 'invalid_json', endpoint);
      return;
    }

    switch (request.method) {
      case 'ping':
        this.sendResponse(request.id, { result: 'pong' }, endpoint);
        break;
      case 'runtime.start': {
        const started = this.runtime.start(request.params?.scanTimeMs);
        this.sendResponse(request.id, { started }, endpoint);
        break;
      }
      case 'runtime.stop': {
        this.runtime.stop();
        this.sendResponse(request.id, { stopped: true }, endpoint);
        break;
      }
      case 'runtime.state.get': {
        const io = this.ioAdapter.getSnapshot();
        const state = { ...this.runtime.getLastState() };
        io.inputs.forEach(ch => {
          state[ch.id] = ch.value;
        });
        io.outputs.forEach(ch => {
          if (typeof state[ch.id] === 'undefined' || typeof state[ch.id] === 'boolean') {
            state[ch.id] = ch.value;
          }
        });
        this.sendResponse(request.id, { state, io }, endpoint);
        break;
      }
      case 'runtime.variables.list': {
        const names = new Set(this.runtime.getVariableNames());
        const ioSnapshot = this.ioAdapter.getSnapshot();
        ioSnapshot.inputs.forEach(ch => names.add(ch.id));
        ioSnapshot.outputs.forEach(ch => names.add(ch.id));
        this.sendResponse(request.id, { variables: Array.from(names).sort() }, endpoint);
        break;
      }
      case 'runtime.writeVar': {
        const { identifier, value } = request.params ?? {};
        if (typeof identifier !== 'string') {
          this.sendError(request.id, 'invalid_params', endpoint);
          return;
        }
        this.runtime.writeVariable(identifier, value);
        this.sendResponse(request.id, { ok: true }, endpoint);
        break;
      }
      case 'io.setInput': {
        const { identifier, value } = request.params ?? {};
        if (typeof identifier !== 'string') {
          this.sendError(request.id, 'invalid_params', endpoint);
          return;
        }
        this.ioAdapter.setInputValue(identifier, Boolean(value));
        this.sendResponse(request.id, { ok: true }, endpoint);
        break;
      }
      case 'project.load': {
        const { pous = [], ladder = [] } = request.params ?? {};
        this.modelProvider.load({ pous, ladder });
        this.ioAdapter.syncFromLadder(ladder);
        this.sendResponse(request.id, { loaded: true }, endpoint);
        break;
      }
      default:
        this.sendError(request.id, 'method_not_found', endpoint);
    }
  }

  private sendResponse(id: number | string | undefined, result: unknown, endpoint: RpcEndpoint): void {
    if (id === undefined) {
      return;
    }
    endpoint.send({ jsonrpc: '2.0', id, result });
  }

  private sendError(id: number | string | undefined, code: string, endpoint: RpcEndpoint): void {
    if (id === undefined) {
      return;
    }
    endpoint.send({ jsonrpc: '2.0', id, error: { code } });
  }

  private broadcastNotification(method: string, params: unknown): void {
    const payload = { jsonrpc: '2.0', method, params };
    this.stdoutEndpoint.send(payload);
    this.tcpClients.forEach(client => client.send(payload));
  }
}

const modelProvider = new InMemoryPlcModelProvider();
const ioAdapter = new MemoryIOAdapter();
const defaultPort = 8123;
const portArg = process.argv.find(arg => arg.startsWith('--port='));
const port = portArg ? Number.parseInt(portArg.split('=')[1] ?? '', 10) : defaultPort;
const runtime = new RuntimeCore({
  modelProvider,
  ioAdapter,
  logger: (event: RuntimeLogEvent) => {
    process.stderr.write(`${event.level.toUpperCase()} ${event.scope}: ${event.message}\n`);
  }
});

const server = new RuntimeHostServer(runtime, modelProvider, ioAdapter, {
  port: Number.isFinite(port) ? port : defaultPort
});
server.start();

const shutdown = (): void => {
  runtime.stop();
  server.dispose();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
