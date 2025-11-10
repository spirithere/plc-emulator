import * as cp from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as vscode from 'vscode';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface HostNotification {
  method: string;
  params?: unknown;
}

export class RuntimeHostAdapter implements vscode.Disposable {
  private child?: cp.ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationEmitter = new vscode.EventEmitter<HostNotification>();
  private readonly exitEmitter = new vscode.EventEmitter<void>();
  private readonly output = vscode.window.createOutputChannel('PLC Runtime Host');
  private nextId = 1;
  private rl?: readline.Interface;
  private startPromise?: Promise<void>;
  private startResolve?: () => void;
  private startReject?: (error: Error) => void;

  public readonly onNotification = this.notificationEmitter.event;
  public readonly onExit = this.exitEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.child) {
      return Promise.resolve();
    }

    this.startPromise = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;

      const hostEntrypoint = this.context.asAbsolutePath(path.join('out', 'runtime', 'host', 'cli.js'));
      this.child = cp.spawn(process.execPath, [hostEntrypoint], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const cleanup = (): void => {
        this.child = undefined;
        this.rl?.close();
        this.rl = undefined;
        this.startPromise = undefined;
        this.startResolve = undefined;
        this.startReject = undefined;
      };

      this.child.on('exit', code => {
        this.output.appendLine(`Runtime host exited with code ${code ?? 0}`);
        const reject = this.startReject;
        cleanup();
        if (reject) {
          reject(new Error('Runtime host exited before it was ready.'));
        }
        this.rejectAllPending(new Error('Runtime host exited.'));
        this.exitEmitter.fire();
      });

      this.child.on('error', error => {
        this.output.appendLine(`Runtime host failed to start: ${error.message}`);
        const reject = this.startReject;
        cleanup();
        reject?.(error);
      });

      this.child.stderr.on('data', chunk => {
        this.output.appendLine(chunk.toString());
      });

      this.rl = readline.createInterface({ input: this.child.stdout });
      this.rl.on('line', line => this.handleLine(line));
    });

    return this.startPromise;
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      return;
    }
    this.child.kill();
    this.child = undefined;
    this.rl?.close();
    this.rl = undefined;
    this.startPromise = undefined;
    this.startResolve = undefined;
    this.startReject = undefined;
    this.rejectAllPending(new Error('Runtime host stopped.'));
  }

  public sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error('Runtime host is not running.'));
    }

    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  public dispose(): void {
    this.stop().catch(() => undefined);
    this.notificationEmitter.dispose();
    this.exitEmitter.dispose();
    this.output.dispose();
  }

  private handleLine(line: string): void {
    if (!line) {
      return;
    }
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(message.error);
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      if (typeof message.method === 'string') {
        if (message.method === 'host.ready' && this.startResolve) {
          this.startResolve();
          this.startResolve = undefined;
          this.startReject = undefined;
        }
        this.notificationEmitter.fire({ method: message.method, params: message.params });
      }
    } catch (error) {
      this.output.appendLine(`Failed to parse host message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private rejectAllPending(error: Error): void {
    this.pending.forEach(pending => pending.reject(error));
    this.pending.clear();
  }
}
