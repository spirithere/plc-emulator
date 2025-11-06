import * as vscode from 'vscode';

export interface PLCProfile {
  id: string;
  vendor: string;
  title: string;
  description: string;
  options?: Record<string, unknown>;
}

const builtInProfiles: PLCProfile[] = [
  {
    id: 'iec61131',
    vendor: 'IEC',
    title: 'IEC 61131-3 Base',
    description: 'Reference behavior as defined by the standard.'
  },
  {
    id: 'vendorA',
    vendor: 'Vendor A',
    title: 'Vendor A Compact',
    description: 'Example profile showing how vendor-specific overrides could be configured.',
    options: {
      executionModel: 'compact'
    }
  },
  {
    id: 'vendorB',
    vendor: 'Vendor B',
    title: 'Vendor B Extended',
    description: 'Adds custom function blocks and scan timing differences.',
    options: {
      customBlocks: ['FB_TIMERX', 'FB_PIDX'],
      scanMultiplier: 1.25
    }
  }
];

export class ProfileManager {
  private activeProfile: PLCProfile;
  private readonly changeEmitter = new vscode.EventEmitter<PLCProfile>();
  public readonly onDidChangeProfile = this.changeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const configuredId = vscode.workspace.getConfiguration('plcEmu').get<string>('profileId', 'iec61131');
    this.activeProfile = this.getProfileById(configuredId) ?? builtInProfiles[0];
  }

  public getActiveProfile(): PLCProfile {
    return this.activeProfile;
  }

  public getProfiles(): PLCProfile[] {
    return builtInProfiles;
  }

  public async selectProfile(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      builtInProfiles.map(profile => ({
        label: profile.title,
        description: profile.vendor,
        detail: profile.description,
        profile
      })),
      {
        title: 'Select PLC Dialect Profile',
        placeHolder: this.activeProfile.title
      }
    );

    if (!pick) {
      return;
    }

    this.activeProfile = pick.profile;
    await vscode.workspace.getConfiguration('plcEmu').update('profileId', pick.profile.id, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`PLC profile switched to ${pick.profile.title}.`);
    this.changeEmitter.fire(this.activeProfile);
  }

  private getProfileById(id: string): PLCProfile | undefined {
    return builtInProfiles.find(profile => profile.id === id);
  }
}
