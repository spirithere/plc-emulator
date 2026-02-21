#!/usr/bin/env node
import * as readline from 'node:readline';
import * as net from 'node:net';
import { RuntimeCore } from '../runtimeCore';
import { RuntimeLogEvent } from '../runtimeTypes';
import { RuntimeApplicationService, RuntimeInputWrite, RuntimeVariableWrite } from '../runtimeApplicationService';
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
    private readonly runtimeApp: RuntimeApplicationService,
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

    try {
      switch (request.method) {
        case 'ping':
          this.sendResponse(request.id, { result: 'pong' }, endpoint);
          break;
        case 'runtime.start':
          this.sendResponse(request.id, this.runtimeApp.start(this.parseScanTimeMs(request.params)), endpoint);
          break;
        case 'runtime.stop':
          this.sendResponse(request.id, this.runtimeApp.stop(), endpoint);
          break;
        case 'runtime.step': {
          const cycles = this.parseCycles(request.params);
          this.sendResponse(request.id, this.runtimeApp.step(cycles), endpoint);
          break;
        }
        case 'runtime.reset':
          this.sendResponse(request.id, this.runtimeApp.reset(), endpoint);
          break;
        case 'runtime.state.get':
          this.sendResponse(request.id, this.runtimeApp.getState({ includeIo: true }), endpoint);
          break;
        case 'runtime.variables.list':
          this.sendResponse(request.id, this.runtimeApp.listVariables(), endpoint);
          break;
        case 'runtime.metrics.get':
          this.sendResponse(request.id, this.runtimeApp.getMetrics(), endpoint);
          break;
        case 'runtime.writeVar':
          this.sendResponse(request.id, this.runtimeApp.writeVariable(this.parseWriteVar(request.params)), endpoint);
          break;
        case 'runtime.writeVars':
          this.sendResponse(request.id, this.runtimeApp.writeVariables(this.parseWriteVars(request.params)), endpoint);
          break;
        case 'io.setInput':
          this.sendResponse(request.id, this.runtimeApp.setInput(this.parseSetInput(request.params)), endpoint);
          break;
        case 'io.setInputs':
          this.sendResponse(request.id, this.runtimeApp.setInputs(this.parseSetInputs(request.params)), endpoint);
          break;
        case 'project.load':
          this.sendResponse(request.id, this.runtimeApp.loadProject(this.parseProjectModel(request.params)), endpoint);
          break;
        default:
          this.sendError(request.id, 'method_not_found', endpoint);
      }
    } catch (error) {
      const code = error instanceof Error && error.message === 'invalid_params' ? 'invalid_params' : 'internal_error';
      this.sendError(request.id, code, endpoint);
    }
  }

  private parseScanTimeMs(params: any): number | undefined {
    if (params?.scanTimeMs === undefined) {
      return undefined;
    }
    const value = Number(params.scanTimeMs);
    if (!Number.isFinite(value)) {
      throw new Error('invalid_params');
    }
    return value;
  }

  private parseCycles(params: any): number {
    if (params?.cycles === undefined) {
      return 1;
    }
    const cycles = Number(params.cycles);
    if (!Number.isFinite(cycles)) {
      throw new Error('invalid_params');
    }
    return cycles;
  }

  private parseWriteVar(params: any): RuntimeVariableWrite {
    if (typeof params?.identifier !== 'string') {
      throw new Error('invalid_params');
    }
    return {
      identifier: params.identifier,
      value: params.value
    };
  }

  private parseWriteVars(params: any): RuntimeVariableWrite[] {
    const updates = params?.updates;
    if (!Array.isArray(updates)) {
      throw new Error('invalid_params');
    }
    return updates.map(update => {
      if (typeof update?.identifier !== 'string') {
        throw new Error('invalid_params');
      }
      return {
        identifier: update.identifier,
        value: update.value
      };
    });
  }

  private parseSetInput(params: any): RuntimeInputWrite {
    if (typeof params?.identifier !== 'string') {
      throw new Error('invalid_params');
    }
    return {
      identifier: params.identifier,
      value: Boolean(params.value)
    };
  }

  private parseSetInputs(params: any): RuntimeInputWrite[] {
    const updates = params?.updates;
    if (!Array.isArray(updates)) {
      throw new Error('invalid_params');
    }
    return updates.map(update => {
      if (typeof update?.identifier !== 'string') {
        throw new Error('invalid_params');
      }
      return {
        identifier: update.identifier,
        value: Boolean(update.value)
      };
    });
  }

  private parseProjectModel(params: any): { pous: any[]; ladder: any[]; configurations?: any[] } {
    const pous = params?.pous;
    const ladder = params?.ladder;
    const configurations = params?.configurations;
    if (!Array.isArray(pous) || !Array.isArray(ladder)) {
      throw new Error('invalid_params');
    }
    if (configurations !== undefined && !Array.isArray(configurations)) {
      throw new Error('invalid_params');
    }
    return { pous, ladder, configurations };
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
const runtimeApp = new RuntimeApplicationService(runtime, modelProvider, ioAdapter);

const server = new RuntimeHostServer(runtime, runtimeApp, ioAdapter, {
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
