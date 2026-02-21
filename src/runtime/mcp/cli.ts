#!/usr/bin/env node
import { RuntimeApplicationService } from '../runtimeApplicationService';
import { RuntimeCore } from '../runtimeCore';
import { RuntimeLogEvent } from '../runtimeTypes';
import { InMemoryPlcModelProvider, MemoryIOAdapter } from '../host/providers';
import { createRuntimeMcpServer } from './server';

const defaultPort = Number.parseInt(process.env.PLC_MCP_PORT ?? '8124', 10);
const defaultHost = process.env.PLC_MCP_HOST ?? '127.0.0.1';
const defaultEndpoint = (process.env.PLC_MCP_ENDPOINT as `/${string}` | undefined) ?? '/mcp';

const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const hostArg = args.find(arg => arg.startsWith('--host='));
const endpointArg = args.find(arg => arg.startsWith('--endpoint='));

const port = portArg ? Number.parseInt(portArg.split('=')[1] ?? '', 10) : defaultPort;
const host = hostArg ? hostArg.split('=')[1] || defaultHost : defaultHost;
const endpointCandidate = endpointArg ? endpointArg.split('=')[1] || defaultEndpoint : defaultEndpoint;
const endpoint = endpointCandidate.startsWith('/') ? (endpointCandidate as `/${string}`) : (`/${endpointCandidate}` as `/${string}`);

const modelProvider = new InMemoryPlcModelProvider();
const ioAdapter = new MemoryIOAdapter();
const runtime = new RuntimeCore({
  modelProvider,
  ioAdapter,
  logger: (event: RuntimeLogEvent) => {
    process.stderr.write(`${event.level.toUpperCase()} ${event.scope}: ${event.message}\n`);
  }
});
const runtimeApp = new RuntimeApplicationService(runtime, modelProvider, ioAdapter);

const mcpServer = createRuntimeMcpServer(runtimeApp, {
  endpoint,
  host,
  port: Number.isFinite(port) ? port : defaultPort
});

async function main(): Promise<void> {
  await mcpServer.start();
  process.stderr.write(`[MCP] Runtime MCP server started on http://${host}:${port}${endpoint}\n`);
  process.stderr.write(`[REST] Runtime REST API available at http://${host}:${port}/api/v1\n`);
}

const shutdown = async (): Promise<void> => {
  runtime.stop();
  await mcpServer.stop().catch(() => undefined);
  runtime.dispose();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

void main().catch(error => {
  process.stderr.write(`[MCP] Failed to start runtime MCP server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
