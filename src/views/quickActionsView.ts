import * as vscode from 'vscode';

type QuickAction = {
  id: string;
  command: string;
  label: string;
  detail?: string;
  icon: string;
};

const COMMANDS: QuickAction[] = [
  {
    id: 'openProject',
    command: 'plcEmu.openProject',
    label: 'Project',
    detail: 'Open PLCopen file',
    icon: folderIcon()
  },
  {
    id: 'openST',
    command: 'plcEmu.openStructuredText',
    label: 'Structured Text',
    detail: 'Edit ST POU',
    icon: bracesIcon()
  },
  {
    id: 'openLadder',
    command: 'plcEmu.openLadderEditor',
    label: 'Ladder',
    detail: 'Open rung editor',
    icon: ladderIcon()
  },
  {
    id: 'openIO',
    command: 'plcEmu.openIOSimulator',
    label: 'I/O',
    detail: 'Toggle inputs & outputs',
    icon: ioIcon()
  },
  {
    id: 'switchProfile',
    command: 'plcEmu.switchProfile',
    label: 'Profile',
    detail: 'Switch dialect profile',
    icon: profileIcon()
  },
  {
    id: 'run',
    command: 'plcEmu.run',
    label: 'Run',
    detail: 'Start emulator',
    icon: playIcon()
  },
  {
    id: 'stop',
    command: 'plcEmu.stop',
    label: 'Stop',
    detail: 'Halt emulator',
    icon: stopIcon()
  }
];

export class QuickActionsViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(message => {
      if (message?.type !== 'command') {
        return;
      }

      const action = COMMANDS.find(cmd => cmd.id === message.id);
      if (!action) {
        return;
      }

      void vscode.commands.executeCommand(action.command);
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const buttons = COMMANDS.map(cmd => `
      <button class="action" data-id="${cmd.id}" title="${cmd.detail ?? cmd.label}" aria-label="${cmd.label}">
        <span class="icon" aria-hidden="true">${cmd.icon}</span>
        <span class="label">${cmd.label}</span>
      </button>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      body {
        margin: 0;
        padding: 0.75rem;
        background: var(--vscode-sideBar-background);
      }

      h2 {
        margin: 0 0 0.6rem;
        font-size: 0.9rem;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        color: var(--vscode-sideBarSectionHeader-foreground);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 0.4rem;
      }

      .action {
        border: 1px solid var(--vscode-contrastBorder, transparent);
        border-radius: 8px;
        padding: 0.65rem 0.4rem 0.5rem;
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        cursor: pointer;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.45rem;
        min-height: 90px;
        transition: background 0.15s ease, transform 0.15s ease;
      }

      .action:hover {
        background: var(--vscode-button-secondaryHoverBackground);
        transform: translateY(-1px);
      }

      .action:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }

      .icon {
        width: 32px;
        height: 32px;
        display: inline-flex;
        justify-content: center;
        align-items: center;
      }

      .icon svg {
        width: 100%;
        height: 100%;
        fill: currentColor;
      }

      .label {
        font-weight: 600;
        font-size: 0.78rem;
        text-align: center;
        line-height: 1.2;
      }
    </style>
  </head>
  <body>
    <h2>Quick Actions</h2>
    <div class="grid">
      ${buttons}
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'command', id: btn.dataset.id });
        });
      });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  let nonce = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function folderIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><path d="M4 5h6l2 2h8v12H4z" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M4 9h16v10H4z" fill="currentColor" opacity="0.2"/></svg>';
}

function bracesIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><path d="M9 4c-1.5 0-2.5 1.2-2.5 2.5v2c0 .8-.7 1.5-1.5 1.5H4v2h1c.8 0 1.5.7 1.5 1.5v2C6.5 17.8 7.5 19 9 19" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M15 4c1.5 0 2.5 1.2 2.5 2.5v2c0 .8.7 1.5 1.5 1.5h1v2h-1c-.8 0-1.5.7-1.5 1.5v2c0 1.3-1 2.5-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
}

function ladderIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><path d="M8 4v16M16 4v16M8 8h8M8 12h8M8 16h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
}

function ioIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><circle cx="8" cy="12" r="3" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M13 9h6v6h-6z" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
}

function profileIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><path d="M7 9l5-5 5 5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 15l5 5 5-5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function playIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><path d="M9 6l9 6-9 6z" fill="currentColor"/></svg>';
}

function stopIcon(): string {
  return '<svg viewBox="0 0 24 24" role="presentation"><rect x="8" y="8" width="8" height="8" fill="currentColor" rx="1"/></svg>';
}
