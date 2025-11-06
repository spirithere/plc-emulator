export enum StatusBarAlignment {
  Left = 1,
  Right = 2
}

class Disposable {
  dispose(): void {
    // no-op
  }
}

export class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];

  public event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable();
  };

  public fire(value: T): void {
    this.listeners.forEach(listener => listener(value));
  }
}

export const window = {
  showInformationMessage: async (_message: string): Promise<void> => undefined,
  showWarningMessage: async (_message: string): Promise<void> => undefined,
  createOutputChannel: (_name: string) => ({ appendLine: (_value: string) => {} }),
  createStatusBarItem: (_alignment: StatusBarAlignment, _priority?: number) => ({
    text: '',
    show: () => {},
    hide: () => {}
  })
};

const configStore: Record<string, unknown> = {
  scanTimeMs: 100,
  profileId: 'iec61131'
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => {
      return (configStore[key] as T) ?? (defaultValue as T);
    },
    update: async (key: string, value: unknown) => {
      configStore[key] = value;
    }
  }),
  workspaceFolders: [] as any,
  fs: {
    readFile: async () => Buffer.from('', 'utf8'),
    writeFile: async () => {},
    stat: async () => ({}),
    createDirectory: async () => {}
  }
};

export const Uri = {
  joinPath: (..._args: unknown[]) => ({ fsPath: '', path: '' })
};
