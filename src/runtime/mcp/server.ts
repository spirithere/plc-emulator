import { FastMCP } from 'fastmcp';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import { RuntimeApplicationService } from '../runtimeApplicationService';
import { RuntimeProjectModel } from '../runtimeTypes';

export interface RuntimeMcpServerOptions {
  endpoint?: `/${string}`;
  host?: string;
  port: number;
}

export interface RuntimeMcpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const startSchema = z.object({
  scanTimeMs: z.coerce.number().int().min(10).optional()
});

const stepSchema = z.object({
  cycles: z.coerce.number().int().min(1).optional()
});

const writeVarSchema = z.object({
  identifier: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()])
});

const writeVarsSchema = z.object({
  updates: z.array(writeVarSchema).min(1)
});

const setInputSchema = z.object({
  identifier: z.string().min(1),
  value: z.coerce.boolean()
});

const setInputsSchema = z.object({
  updates: z.array(setInputSchema).min(1)
});

const projectLoadSchema = z.object({
  pous: z.array(z.any()),
  ladder: z.array(z.any()),
  configurations: z.array(z.any()).optional()
});

const jsonString = (value: unknown): string => JSON.stringify(value, null, 2);

export function createRuntimeMcpServer(
  runtimeApp: RuntimeApplicationService,
  options: RuntimeMcpServerOptions
): RuntimeMcpServer {
  const server = new FastMCP({
    instructions:
      'Use plc_runtime_* tools to start/stop/step the PLC runtime, read state/metrics, and write variables or inputs.',
    name: 'plc-runtime-mcp',
    version: '0.1.0'
  });

  registerTools(server, runtimeApp);
  registerResources(server, runtimeApp);
  registerRestRoutes(server, runtimeApp);

  return {
    start: () =>
      server.start({
        httpStream: {
          endpoint: options.endpoint ?? '/mcp',
          host: options.host ?? '127.0.0.1',
          port: options.port
        },
        transportType: 'httpStream'
      }),
    stop: () => server.stop()
  };
}

function registerTools(server: FastMCP, runtimeApp: RuntimeApplicationService): void {
  server.addTool({
    description: 'Load a PLC project model with ST blocks, ladder rungs, and optional configurations.',
    execute: async args => jsonString(runtimeApp.loadProject(args as RuntimeProjectModel)),
    name: 'plc_runtime_project_load',
    parameters: projectLoadSchema
  });

  server.addTool({
    description: 'Start runtime scan cycles.',
    execute: async ({ scanTimeMs }) => jsonString(runtimeApp.start(scanTimeMs)),
    name: 'plc_runtime_start',
    parameters: startSchema
  });

  server.addTool({
    description: 'Stop runtime scan cycles.',
    execute: async () => jsonString(runtimeApp.stop()),
    name: 'plc_runtime_stop',
    parameters: z.object({})
  });

  server.addTool({
    description: 'Execute one or more scan cycles while runtime is stopped.',
    execute: async ({ cycles }) => jsonString(runtimeApp.step(cycles ?? 1)),
    name: 'plc_runtime_step',
    parameters: stepSchema
  });

  server.addTool({
    description: 'Reset runtime memory and counters.',
    execute: async () => jsonString(runtimeApp.reset()),
    name: 'plc_runtime_reset',
    parameters: z.object({})
  });

  server.addTool({
    description: 'Get the latest runtime state (with IO snapshot).',
    execute: async () => jsonString(runtimeApp.getState({ includeIo: true })),
    name: 'plc_runtime_get_state',
    parameters: z.object({})
  });

  server.addTool({
    description: 'Get runtime metrics such as scan count and last duration.',
    execute: async () => jsonString(runtimeApp.getMetrics()),
    name: 'plc_runtime_get_metrics',
    parameters: z.object({})
  });

  server.addTool({
    description: 'List known runtime and IO variable identifiers.',
    execute: async () => jsonString(runtimeApp.listVariables()),
    name: 'plc_runtime_list_variables',
    parameters: z.object({})
  });

  server.addTool({
    description: 'Write a single runtime variable.',
    execute: async args => jsonString(runtimeApp.writeVariable(args)),
    name: 'plc_runtime_write_variable',
    parameters: writeVarSchema
  });

  server.addTool({
    description: 'Write multiple runtime variables in one call.',
    execute: async ({ updates }) => jsonString(runtimeApp.writeVariables(updates)),
    name: 'plc_runtime_write_variables',
    parameters: writeVarsSchema
  });

  server.addTool({
    description: 'Set one input channel value.',
    execute: async args => jsonString(runtimeApp.setInput(args)),
    name: 'plc_runtime_set_input',
    parameters: setInputSchema
  });

  server.addTool({
    description: 'Set multiple input channel values in one call.',
    execute: async ({ updates }) => jsonString(runtimeApp.setInputs(updates)),
    name: 'plc_runtime_set_inputs',
    parameters: setInputsSchema
  });
}

function registerResources(server: FastMCP, runtimeApp: RuntimeApplicationService): void {
  server.addResource({
    description: 'Latest runtime state snapshot including IO.',
    load: async () => ({
      mimeType: 'application/json',
      text: jsonString(runtimeApp.getState({ includeIo: true }))
    }),
    mimeType: 'application/json',
    name: 'plc-runtime-state',
    uri: 'resource://plc-runtime/state'
  });

  server.addResource({
    description: 'Runtime metrics snapshot.',
    load: async () => ({
      mimeType: 'application/json',
      text: jsonString(runtimeApp.getMetrics())
    }),
    mimeType: 'application/json',
    name: 'plc-runtime-metrics',
    uri: 'resource://plc-runtime/metrics'
  });
}

function registerRestRoutes(server: FastMCP, runtimeApp: RuntimeApplicationService): void {
  const app = server.getApp();

  app.get('/api/v1', c =>
    c.json({
      endpoints: {
        health: '/api/v1/health',
        ioSet: '/api/v1/io/inputs/set',
        ioSetBatch: '/api/v1/io/inputs/set-batch',
        projectLoad: '/api/v1/project/load',
        runtimeMetrics: '/api/v1/runtime/metrics',
        runtimeReset: '/api/v1/runtime/reset',
        runtimeStart: '/api/v1/runtime/start',
        runtimeState: '/api/v1/runtime/state',
        runtimeStep: '/api/v1/runtime/step',
        runtimeStop: '/api/v1/runtime/stop',
        variableList: '/api/v1/runtime/variables',
        variableWrite: '/api/v1/runtime/variables/write',
        variableWriteBatch: '/api/v1/runtime/variables/write-batch'
      },
      mcpEndpoint: '/mcp'
    })
  );

  app.get('/api/v1/health', c =>
    c.json({
      service: 'plc-runtime-mcp',
      status: 'ok'
    })
  );

  app.get('/api/v1/runtime/state', c => {
    const includeIo = parseBoolean(c.req.query('includeIo')) ?? true;
    return c.json(runtimeApp.getState({ includeIo }));
  });

  app.get('/api/v1/runtime/variables', c => c.json(runtimeApp.listVariables()));
  app.get('/api/v1/runtime/metrics', c => c.json(runtimeApp.getMetrics()));

  app.post('/api/v1/runtime/start', async c =>
    withBody(c, startSchema.optional(), body => runtimeApp.start(body?.scanTimeMs))
  );
  app.post('/api/v1/runtime/stop', c => c.json(runtimeApp.stop()));
  app.post('/api/v1/runtime/reset', c => c.json(runtimeApp.reset()));
  app.post('/api/v1/runtime/step', async c =>
    withBody(c, stepSchema.optional(), body => runtimeApp.step(body?.cycles ?? 1))
  );

  app.post('/api/v1/runtime/variables/write', async c => withBody(c, writeVarSchema, body => runtimeApp.writeVariable(body)));
  app.post('/api/v1/runtime/variables/write-batch', async c =>
    withBody(c, writeVarsSchema, body => runtimeApp.writeVariables(body.updates))
  );

  app.post('/api/v1/io/inputs/set', async c => withBody(c, setInputSchema, body => runtimeApp.setInput(body)));
  app.post('/api/v1/io/inputs/set-batch', async c =>
    withBody(c, setInputsSchema, body => runtimeApp.setInputs(body.updates))
  );

  app.post('/api/v1/project/load', async c =>
    withBody(c, projectLoadSchema, body => runtimeApp.loadProject(body as RuntimeProjectModel))
  );
}

async function withBody<T>(
  c: HonoContext,
  schema: z.ZodType<T>,
  handler: (body: T) => unknown
): Promise<Response> {
  const raw = await safeJson(c);
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return c.json(
      {
        code: 'invalid_params',
        issues: parsed.error.issues.map(issue => ({
          message: issue.message,
          path: issue.path.join('.')
        }))
      },
      400
    );
  }

  try {
    return c.json(handler(parsed.data));
  } catch (error) {
    return handleRuntimeError(c, error);
  }
}

async function safeJson(c: HonoContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function handleRuntimeError(c: HonoContext, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('Cannot step runtime while running')) {
    return c.json({ code: 'runtime_running', message }, 409);
  }

  return c.json({ code: 'internal_error', message }, 500);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
}
