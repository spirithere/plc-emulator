import * as path from 'path';
import * as vscode from 'vscode';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { LadderBranch, LadderElement, LadderRung, PLCProjectModel, StructuredTextBlock } from '../types';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: true,
  indentBy: '  '
};

export class PLCopenService implements vscode.Disposable {
  private readonly parser = new XMLParser(parserOptions);
  private readonly builder = new XMLBuilder(builderOptions);
  private model: PLCProjectModel = this.createDefaultModel();
  private projectUri: vscode.Uri | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<PLCProjectModel>();
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  public readonly onDidChangeModel = this.changeEmitter.event;

  public getModel(): PLCProjectModel {
    return this.model;
  }

  public async pickAndLoadProject(): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      title: 'Select PLCopen XML Project',
      filters: { XML: ['xml'] }
    });

    if (!selection || selection.length === 0) {
      return;
    }

    await this.loadFromUri(selection[0]);
  }

  public async loadFromWorkspaceSetting(): Promise<void> {
    const configured = vscode.workspace.getConfiguration('plcEmu').get<string>('projectFile');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || !configured) {
      return;
    }

    const potential = vscode.Uri.joinPath(workspaceFolder.uri, configured);
    try {
      await vscode.workspace.fs.stat(potential);
      await this.loadFromUri(potential);
    } catch {
      // Keep default in-memory model if file is missing.
    }
  }

  public async loadFromUri(uri: vscode.Uri): Promise<void> {
    try {
      await this.loadUriIntoModel(uri);
    } catch (error) {
      console.error('Failed to load PLC project from disk', error);
      void vscode.window.showErrorMessage('Failed to load PLC project. Check that the XML is valid.');
      throw error;
    }

    this.projectUri = uri;
    this.registerProjectWatcher();
  }

  public loadFromText(xml: string): void {
    const ast = this.parser.parse(xml);
    this.model = this.inflateModel(ast);
    this.changeEmitter.fire(this.model);
  }

  public exportToXml(): string {
    const ast = this.serializeModel();
    return this.builder.build(ast);
  }

  public getStructuredTextBlocks(): StructuredTextBlock[] {
    return this.model.pous;
  }

  public getLadderRungs(): LadderRung[] {
    return this.model.ladder;
  }

  public async updateStructuredTextBlock(name: string, body: string): Promise<void> {
    const block = this.model.pous.find(p => p.name === name);
    if (!block) {
      throw new Error(`Structured Text block ${name} not found in model.`);
    }

    block.body = body;
    await this.persist();
    this.changeEmitter.fire(this.model);
  }

  public async replaceLadder(rungs: LadderRung[]): Promise<void> {
    this.model.ladder = rungs;
    await this.persist();
    this.changeEmitter.fire(this.model);
  }

  public dispose(): void {
    this.fileWatcher?.dispose();
    this.changeEmitter.dispose();
  }

  private inflateModel(ast: any): PLCProjectModel {
    const pous = this.extractPous(ast);
    const ladder = this.extractLadder(ast);
    return { pous, ladder };
  }

  private extractPous(ast: any): StructuredTextBlock[] {
    const pouNodes = ensureArray(ast?.project?.types?.pous?.pou) ?? ensureArray(ast?.project?.pous?.pou);
    if (!pouNodes) {
      return this.createDefaultModel().pous;
    }

    return pouNodes.map((pou: any) => ({
      name: pou?.name ?? 'UnnamedPOU',
      body: pou?.body?.ST ?? pou?.body?.st ?? ''
    }));
  }

  private extractLadder(ast: any): LadderRung[] {
    const rungNodes = ensureArray(ast?.project?.ladder?.rung);
    if (!rungNodes) {
      return this.createDefaultModel().ladder;
    }

    return rungNodes.map((r: any, index: number) => ({
      id: r?.id ?? `rung_${index}`,
      elements: this.extractElements(ensureArray(r?.element), r?.id ?? `rung_${index}`),
      branches: this.extractBranches(r)
    }));
  }

  private extractElements(nodes: any[] | undefined, parentId: string): LadderElement[] {
    return nodes?.map((node: any, elementIndex: number) => ({
      id: node?.id ?? `${parentId}_${elementIndex}`,
      label: node?.label ?? node?.name ?? 'Contact',
      type: node?.type === 'coil' ? 'coil' : 'contact',
      state: node?.state === 'true',
      variant: node?.variant ?? node?.['@_variant'] ?? 'no'
    })) ?? [];
  }

  private extractBranches(rungNode: any): LadderBranch[] | undefined {
    const parallels = ensureArray(rungNode?.parallel);
    if (!parallels || parallels.length === 0) {
      return undefined;
    }

    const branches: LadderBranch[] = [];
    parallels.forEach((parallel: any, parallelIndex: number) => {
      ensureArray(parallel?.branch)?.forEach((branch: any, branchIndex: number) => {
        const startColumnRaw = branch?.startColumn ?? branch?.['@_startColumn'] ?? '0';
        const endColumnRaw =
          branch?.endColumn ?? branch?.['@_endColumn'] ?? `${ensureArray(rungNode?.element)?.length ?? 1}`;
        const startColumn = Number.parseInt(startColumnRaw, 10);
        const endColumn = Number.parseInt(endColumnRaw, 10);

        branches.push({
          id: branch?.id ?? `${rungNode?.id ?? 'rung'}_branch_${parallelIndex}_${branchIndex}`,
          elements: this.extractElements(ensureArray(branch?.element), branch?.id ?? `${parallelIndex}_${branchIndex}`),
          startColumn: Number.isFinite(startColumn) ? startColumn : 0,
          endColumn: Number.isFinite(endColumn)
            ? Math.max(endColumn, (Number.isFinite(startColumn) ? startColumn : 0) + 1)
            : ((Number.isFinite(startColumn) ? startColumn : 0) + 1)
        });
      });
    });

    return branches.length ? branches : undefined;
  }

  private async persist(): Promise<void> {
    if (!this.projectUri) {
      await this.ensureProjectFile();
    }

    if (!this.projectUri) {
      return;
    }

    const xml = this.exportToXml();
    await vscode.workspace.fs.writeFile(this.projectUri, Buffer.from(xml, 'utf8'));
  }

  private async reloadProjectFromDisk(): Promise<void> {
    if (!this.projectUri) {
      return;
    }

    try {
      await this.loadUriIntoModel(this.projectUri);
    } catch (error) {
      console.error('Failed to reload PLC project', error);
      void vscode.window.showErrorMessage('Failed to reload PLC project from disk.');
    }
  }

  private async loadUriIntoModel(uri: vscode.Uri): Promise<void> {
    const buffer = await vscode.workspace.fs.readFile(uri);
    this.loadFromText(buffer.toString());
  }

  private serializeModel(): any {
    return {
      project: {
        types: {
          pous: {
            pou: this.model.pous.map(pou => ({
              '@_name': pou.name,
              '@_pouType': 'program',
              body: { ST: pou.body }
            }))
          }
        },
        ladder: {
          rung: this.model.ladder.map(rung => {
            const rungNode: any = {
              '@_id': rung.id,
              element: rung.elements.map(element => this.serializeElement(element))
            };

            if (rung.branches && rung.branches.length > 0) {
              rungNode.parallel = {
                branch: rung.branches.map(branch => ({
                  '@_id': branch.id,
                  '@_startColumn': branch.startColumn,
                  '@_endColumn': branch.endColumn,
                  element: branch.elements.map(element => this.serializeElement(element))
                }))
              };
            }

            return rungNode;
          })
        }
      }
    };
  }

  private serializeElement(element: LadderElement): any {
    const serialized: Record<string, string> = {
      '@_id': element.id,
      '@_type': element.type,
      '@_label': element.label,
      '@_state': `${element.state ?? false}`
    };

    if (element.variant && element.type === 'contact') {
      serialized['@_variant'] = element.variant;
    }

    return serialized;
  }

  private async ensureProjectFile(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const configured = vscode.workspace.getConfiguration('plcEmu').get<string>('projectFile') ?? 'project.plcopen.xml';
    if (!workspaceFolder) {
      return;
    }

    const target = vscode.Uri.joinPath(workspaceFolder.uri, configured);
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      const xml = this.exportToXml();
      await vscode.workspace.fs.writeFile(target, Buffer.from(xml, 'utf8'));
    }

    this.projectUri = target;
    this.registerProjectWatcher();
  }

  private registerProjectWatcher(): void {
    this.fileWatcher?.dispose();

    if (!this.projectUri) {
      return;
    }

    const directory = path.dirname(this.projectUri.fsPath);
    const fileName = path.basename(this.projectUri.fsPath);
    const pattern = new vscode.RelativePattern(directory, fileName);
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = () => {
      void this.reloadProjectFromDisk();
    };

    this.fileWatcher.onDidChange(reload);
    this.fileWatcher.onDidCreate(reload);
    this.fileWatcher.onDidDelete(() => {
      vscode.window.showWarningMessage('PLCopen project file was deleted. Reverting to in-memory model.');
      this.model = this.createDefaultModel();
      this.changeEmitter.fire(this.model);
    });
  }

  private createDefaultModel(): PLCProjectModel {
    return {
      pous: [
        {
          name: 'MainProgram',
          body: ['PROGRAM MainProgram', '  VAR', '    Counter : INT := 0;', '  END_VAR', '  Counter := Counter + 1;', 'END_PROGRAM'].join('\n')
        }
      ],
      ladder: [
        {
          id: 'rung_0',
          elements: [
            { id: 'r0_e0', label: 'Start', type: 'contact', state: true, variant: 'no' },
            { id: 'r0_e1', label: 'Motor', type: 'coil', state: false }
          ],
          branches: [
            {
              id: 'r0_b0',
              elements: [
                { id: 'r0_b0_e0', label: 'Aux', type: 'contact', state: true, variant: 'no' },
                { id: 'r0_b0_e1', label: 'Motor', type: 'coil', state: false }
              ],
              startColumn: 0,
              endColumn: 1
            }
          ]
        }
      ]
    };
  }
}

function ensureArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}
