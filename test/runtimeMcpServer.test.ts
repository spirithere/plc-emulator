import * as net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeApplicationService } from '../src/runtime/runtimeApplicationService';
import { InMemoryPlcModelProvider, MemoryIOAdapter } from '../src/runtime/host/providers';
import { createRuntimeMcpServer, RuntimeMcpServer } from '../src/runtime/mcp/server';
import { RuntimeCore } from '../src/runtime/runtimeCore';
import { LadderRung } from '../src/types';

const ladder: LadderRung[] = [
  {
    id: 'r0',
    elements: [
      { id: 'c0', label: 'X0', type: 'contact', variant: 'no', state: false },
      { id: 'y0', label: 'Y0', type: 'coil', state: false }
    ]
  }
];

type RuntimeFixture = {
  baseUrl: string;
  mcpServer: RuntimeMcpServer;
  runtime: RuntimeCore;
};

const fixtures: RuntimeFixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (!fixture) {
      continue;
    }
    await fixture.mcpServer.stop();
    fixture.runtime.dispose();
  }
});

describe('Runtime MCP server (REST compatibility)', () => {
  it('controls runtime state through REST endpoints', async () => {
    const fixture = await startFixture();
    fixtures.push(fixture);

    const health = await fetchJson(`${fixture.baseUrl}/api/v1/health`);
    expect(health.status).toBe('ok');

    await postJson(`${fixture.baseUrl}/api/v1/project/load`, {
      configurations: [],
      ladder,
      pous: []
    });
    await postJson(`${fixture.baseUrl}/api/v1/io/inputs/set`, {
      identifier: 'X0',
      value: true
    });
    await postJson(`${fixture.baseUrl}/api/v1/runtime/step`, { cycles: 1 });

    const state = await fetchJson(`${fixture.baseUrl}/api/v1/runtime/state`);
    expect(state.state.X0).toBe(true);
    expect(state.state.Y0).toBe(true);

    const metrics = await fetchJson(`${fixture.baseUrl}/api/v1/runtime/metrics`);
    expect(metrics.totalScans).toBeGreaterThan(0);
  });
});

async function startFixture(): Promise<RuntimeFixture> {
  const port = await allocatePort();
  const modelProvider = new InMemoryPlcModelProvider();
  const ioAdapter = new MemoryIOAdapter();
  const runtime = new RuntimeCore({
    ioAdapter,
    modelProvider
  });
  const runtimeApp = new RuntimeApplicationService(runtime, modelProvider, ioAdapter);
  const mcpServer = createRuntimeMcpServer(runtimeApp, {
    endpoint: '/mcp',
    host: '127.0.0.1',
    port
  });

  await mcpServer.start();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    mcpServer,
    runtime
  };
}

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate test port.')));
        return;
      }
      const port = address.port;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${text}`);
  }
  return response.json();
}
