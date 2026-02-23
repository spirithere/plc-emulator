import * as vscode from 'vscode';
import { PLCopenService } from '../services/plcopenService';
import { LadderRung, StructuredTextBlock } from '../types';

export class POUTreeProvider implements vscode.TreeDataProvider<POUTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<POUTreeItem | undefined | null | void>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly plcService: PLCopenService) {
    this.plcService.onDidChangeModel(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: POUTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: POUTreeItem): vscode.ProviderResult<POUTreeItem[]> {
    if (!element) {
      return [
        new POUTreeItem('POUs', vscode.TreeItemCollapsibleState.Expanded, 'group:st'),
        new POUTreeItem('Ladder Rungs', vscode.TreeItemCollapsibleState.Expanded, 'group:ld')
      ];
    }

    if (element.contextValue === 'group:st') {
      return this.getStructuredTextItems();
    }

    if (element.contextValue === 'group:ld') {
      return this.getLadderItems();
    }

    return [];
  }

  private getStructuredTextItems(): POUTreeItem[] {
    const blocks = this.plcService.getProjectPous();
    if (!blocks.length) {
      return [new POUTreeItem('No POUs found', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    return blocks.map(block => this.createPouItem(block));
  }

  private getLadderItems(): POUTreeItem[] {
    const rungs = this.plcService.getLadderRungs();
    if (!rungs.length) {
      return [new POUTreeItem('No rungs defined', vscode.TreeItemCollapsibleState.None, 'info')];
    }

    return rungs.map((rung, index) => this.createRungItem(rung, index));
  }

  private createPouItem(block: StructuredTextBlock): POUTreeItem {
    const item = new POUTreeItem(block.name, vscode.TreeItemCollapsibleState.None, 'pou');
    const language = block.language ?? 'ST';
    item.description = language === 'ST' ? 'Structured Text' : language;
    item.command = language === 'ST'
      ? {
          command: 'plcEmu.openStructuredTextBlock',
          title: 'Edit Structured Text Block',
          arguments: [block.name]
        }
      : {
          command: 'plcEmu.openPouPreview',
          title: 'Open POU Preview',
          arguments: [block.name]
        };
    return item;
  }

  private createRungItem(rung: LadderRung, index: number): POUTreeItem {
    const item = new POUTreeItem(rung.id || `Rung ${index + 1}`, vscode.TreeItemCollapsibleState.None, 'rung');
    item.description = `${(rung.elements?.length ?? 0) + (rung.branches?.length ?? 0)} segments`;
    item.command = {
      command: 'plcEmu.openLadderEditor',
      title: 'Open Ladder Editor'
    };
    return item;
  }
}

export class POUTreeItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, public readonly contextValue: string) {
    super(label, collapsibleState);
  }
}
