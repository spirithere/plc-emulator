import * as path from 'path';
import * as vscode from 'vscode';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import {
  Configuration,
  LadderBranch,
  LadderElement,
  LadderRung,
  PLCProjectModel,
  ProjectMetadata,
  StructuredTextBlock,
  VariableDeclaration,
  PouInterface
} from '../types';
import { parseStructuredText } from '../runtime/st/astBuilder';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: true,
  indentBy: '  ',
  // Keep boolean attributes as explicit values (negated="true") so LD contacts round-trip correctly.
  suppressBooleanAttributes: false
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

  public async updateMetadata(metadata: Partial<ProjectMetadata>): Promise<void> {
    this.model.metadata = { ...(this.model.metadata ?? {}), ...metadata };
    await this.persist();
    this.changeEmitter.fire(this.model);
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
    } catch {
      // Keep default in-memory model if file is missing.
      return;
    }

    await this.loadFromUri(potential);
  }

  public async loadFromUri(uri: vscode.Uri): Promise<void> {
    await this.resetStMirrorCacheIfProjectChanged(uri);

    try {
      await this.loadUriIntoModel(uri);
    } catch (error) {
      console.error('Failed to load PLC project from disk', error);
      const detail = error instanceof Error ? ` ${error.message}` : '';
      void vscode.window.showErrorMessage(`Failed to load PLC project.${detail}`);
      throw error;
    }

    this.projectUri = uri;
    this.registerProjectWatcher();
  }

  /**
   * Clear the generated Structured Text mirror files when switching projects so
   * remnants from a previous XML don't linger in `.plc/st/`.
   */
  private async resetStMirrorCacheIfProjectChanged(uri: vscode.Uri): Promise<void> {
    // If we're reloading the same project file, keep the cache intact.
    if (this.projectUri && this.projectUri.fsPath === uri.fsPath) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const stMirrorDir = vscode.Uri.joinPath(workspaceFolder.uri, '.plc', 'st');
    try {
      await vscode.workspace.fs.delete(stMirrorDir, { recursive: true });
    } catch (error) {
      // Ignore if the mirror folder does not exist or cannot be removed.
      console.warn('Failed to clear ST mirror cache', error);
    }
  }

  public loadFromText(xml: string): void {
    const ast = this.parser.parse(xml);
    const inflated = this.inflateModel(ast);
    this.validateLoadedModel(inflated);
    this.model = inflated;
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

  public getAllVariables(): VariableDeclaration[] {
    const vars: VariableDeclaration[] = [];
    this.model.configurations?.forEach(config => {
      config.globalVars?.forEach(v => vars.push({ ...v, scope: 'configuration' }));
      config.resources?.forEach(resource => {
        resource.globalVars?.forEach(v => vars.push({ ...v, scope: 'resource' }));
      });
    });

    // Parse ST var sections to surface local/POU-level variables (read-only for mapping UI).
    this.model.pous.forEach(pou => {
      const parsed = parseStructuredText(pou.body);
      const sections = parsed.program?.varSections ?? [];
      sections.forEach(section => {
        section.declarations.forEach(decl => {
          vars.push({
            name: decl.name,
            dataType: decl.dataType,
            section: section.section,
            scope: 'local',
            address: decl.address,
            retain: decl.retain,
            persistent: decl.persistent,
            constant: decl.constant,
            documentation: undefined,
            opcUaNodeId: undefined
          });
        });
      });
    });
    return vars;
  }

  public async updateVariableMappings(updates: Array<Pick<VariableDeclaration, 'name' | 'address' | 'opcUaNodeId'>>): Promise<void> {
    let mutated = false;
    const apply = (vars: VariableDeclaration[] | undefined): void => {
      vars?.forEach(v => {
        const match = updates.find(u => u.name === v.name);
        if (match) {
          if (match.address !== undefined && v.address !== match.address) {
            v.address = match.address;
            mutated = true;
          }
          if (match.opcUaNodeId !== undefined && v.opcUaNodeId !== match.opcUaNodeId) {
            v.opcUaNodeId = match.opcUaNodeId;
            mutated = true;
          }
        }
      });
    };

    this.model.configurations?.forEach(config => {
      apply(config.globalVars);
      config.resources?.forEach(resource => apply(resource.globalVars));
    });

    if (mutated) {
      await this.persist();
      this.changeEmitter.fire(this.model);
    }
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

  public async upsertPou(pou: StructuredTextBlock, options: { allowCreate?: boolean } = {}): Promise<void> {
    const name = pou.name?.trim();
    if (!name) {
      throw new Error('POU name is required.');
    }
    pou.name = name;
    const idx = this.model.pous.findIndex(p => p.name === pou.name);
    if (idx >= 0) {
      this.model.pous[idx] = { ...this.model.pous[idx], ...pou };
    } else if (options.allowCreate) {
      if (!pou.body) {
        pou.body = `PROGRAM ${pou.name}\nEND_PROGRAM`;
      }
      this.model.pous.push(pou);
    } else {
      throw new Error(`POU ${pou.name} not found.`);
    }
    await this.persist();
    this.changeEmitter.fire(this.model);
  }

  public async deletePou(name: string): Promise<void> {
    const before = this.model.pous.length;
    this.model.pous = this.model.pous.filter(p => p.name !== name);
    if (this.model.pous.length === before) {
      throw new Error(`POU ${name} not found.`);
    }
    await this.persist();
    this.changeEmitter.fire(this.model);
  }

  public async updateConfigurations(configurations: Configuration[]): Promise<void> {
    this.model.configurations = configurations;
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
    const configurations = this.extractConfigurations(ast);
    const metadata = this.extractMetadata(ast);
    return { pous, ladder, configurations, metadata };
  }

  private extractPous(ast: any): StructuredTextBlock[] {
    const pouNodes = this.extractAllPouNodes(ast);
    if (!pouNodes.length) {
      return [];
    }

    // Ignore ladder-only POUs so we don't mirror them as empty ST blocks and create
    // duplicates on every save. The ladder networks are extracted separately.
    const stPous = pouNodes.filter((pou: any) => !(pou?.body?.LD || pou?.body?.ld));

    return stPous.map((pou: any) => {
      const name = pou?.name ?? pou?.['@_name'] ?? 'UnnamedPOU';
      const bodySt = this.extractStructuredTextBody(pou);
      const interfaceSection = this.extractInterface(pou?.interface);
      return {
        name,
        pouType: (pou?.pouType ?? pou?.['@_pouType'] ?? 'program') as any,
        body: bodySt,
        language: 'ST' as const,
        interface: interfaceSection
      };
    })
      // Strip out empty ladder mirror POUs that were previously produced from LD networks.
      .filter(
        p => !(p.name === 'MainLadder' && (!p.body || p.body.trim() === '') && !p.interface)
      );
  }

  private extractInterface(node: any): PouInterface | undefined {
    if (!node) return undefined;
    const mapVars = (section: any): VariableDeclaration[] | undefined =>
      ensureArray(section?.variable)?.map((v: any) => this.toVariableDeclaration(v));
    const interfaceObj: PouInterface = {
      inputVars: mapVars(node.inputVars),
      outputVars: mapVars(node.outputVars),
      inOutVars: mapVars(node.inOutVars),
      localVars: mapVars(node.localVars),
      tempVars: mapVars(node.tempVars)
    };
    return Object.values(interfaceObj).some(arr => (arr?.length ?? 0) > 0) ? interfaceObj : undefined;
  }

  private toVariableDeclaration(variable: any): VariableDeclaration {
    const name = this.readAttr(variable, 'name') ?? variable?.name ?? 'Var';
    const dataType = this.resolveDataType(variable?.type);
    const address = this.readAttr(variable, 'address');
    const constant = this.readAttr(variable, 'constant') === 'true';
    const retain = this.readAttr(variable, 'retain') === 'true';
    const persistent = this.readAttr(variable, 'persistent') === 'true';
    const opcUaNodeId =
      this.readAttr(variable, 'plcemu:opcUaNodeId') ??
      this.readAttr(variable, 'opcUaNodeId') ??
      variable?.['plcemu:opcUaNodeId'];
    const initialSimple =
      variable?.initialValue?.simpleValue?.value ??
      variable?.initialValue?.simpleValue?.['@_value'] ??
      variable?.initialValue?.simpleValue ??
      variable?.initialValue?.['@_value'];
    return {
      name,
      dataType,
      address,
      constant,
      retain,
      persistent,
      documentation: variable?.documentation,
      initialValue: this.parseSimpleValue(initialSimple),
      ioDirection: this.inferIoDirection(address),
      opcUaNodeId
    };
  }

  private extractLadder(ast: any): LadderRung[] {
    const ldPous = this.extractAllPouNodes(ast).filter((p: any) => p?.body?.LD || p?.body?.ld);
    if (ldPous && ldPous.length > 0) {
      const fromLd: LadderRung[] = [];
      ldPous.forEach((pou: any, pouIndex: number) => {
        const ldBody = pou.body?.LD ?? pou.body?.ld;
        const networks = ensureArray(ldBody?.network);
        if (networks && networks.length > 0) {
          networks.forEach((net: any, netIndex: number) => {
            fromLd.push(this.parseLdNetwork(net, `${pou?.name ?? 'LD'}_${netIndex ?? pouIndex}`));
          });
        } else if (ldBody) {
          // CODESYS LD can store elements directly under <LD> without <network>.
          fromLd.push(this.parseLdNetwork(ldBody, `${pou?.name ?? 'LD'}_0`));
        }
      });
      if (fromLd.length > 0) {
        return fromLd;
      }
    }

    const rungNodes = ensureArray(ast?.project?.ladder?.rung);
    if (!rungNodes) {
      return [];
    }

    return rungNodes.map((r: any, index: number) => ({
      id: r?.id ?? `rung_${index}`,
      elements: this.extractElements(ensureArray(r?.element), r?.id ?? `rung_${index}`),
      branches: this.extractBranches(r)
    }));
  }

  private extractElements(nodes: any[] | undefined, parentId: string): LadderElement[] {
    const readAttr = (node: any, key: string): any => node?.[key] ?? node?.[`_${key}`] ?? node?.[`@_${key}`];

    return nodes?.map((node: any, elementIndex: number) => {
      const id = readAttr(node, 'id') ?? `${parentId}_${elementIndex}`;
      const label = readAttr(node, 'label') ?? readAttr(node, 'name') ?? 'Contact';
      const typeRaw = readAttr(node, 'type');
      const stateRaw = readAttr(node, 'state');
      const variant = readAttr(node, 'variant') ?? 'no';
      const addrTypeRaw = readAttr(node, 'addrType');

      let state: boolean | undefined;
      if (stateRaw === 'true' || stateRaw === true) {
        state = true;
      } else if (stateRaw === 'false' || stateRaw === false) {
        state = false;
      }

      return {
        id,
        label,
        type: typeRaw === 'coil' ? 'coil' : 'contact',
        state,
        variant,
        addrType: this.inferAddrType(addrTypeRaw ?? label)
      };
    }) ?? [];
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

  private extractMetadata(ast: any): ProjectMetadata | undefined {
    const header = ast?.project?.fileHeader;
    const content = ast?.project?.contentHeader;
    const root = ast?.project;
    if (!header && !content) {
      return undefined;
    }
    const metadata: ProjectMetadata = {
      companyName: header?.companyName ?? header?.['@_companyName'],
      productName: header?.productName ?? header?.['@_productName'],
      productVersion: header?.productVersion ?? header?.['@_productVersion'],
      creationDateTime: header?.creationDateTime ?? header?.['@_creationDateTime'],
      projectName: content?.name ?? content?.['@_name'],
      organization: content?.organization ?? content?.['@_organization'],
      contentVersion: content?.version ?? content?.['@_version'],
      contentModificationDateTime: content?.modificationDateTime ?? content?.['@_modificationDateTime']
    };
    if (root?.['@_name']) metadata.projectName = root['@_name'];
    if (root?.['@_productName']) metadata.productName = root['@_productName'];
    if (root?.['@_productVersion']) metadata.productVersion = root['@_productVersion'];
    return Object.values(metadata).some(Boolean) ? metadata : undefined;
  }

  private extractConfigurations(ast: any): Configuration[] | undefined {
    const configurations = ensureArray(ast?.project?.instances?.configurations?.configuration);
    if (!configurations) {
      return undefined;
    }
    return configurations.map((config: any, idx: number) => ({
      name: this.readAttr(config, 'name') ?? `Config${idx}`,
      globalVars: this.extractVariables(ensureArray(config?.globalVars?.variable)),
      resources:
        ensureArray(config?.resource)?.map((resource: any, resourceIndex: number) => {
          const taskNodes = ensureArray(resource?.task);
          return {
            name: this.readAttr(resource, 'name') ?? `Resource${resourceIndex}`,
            tasks: this.extractTasks(taskNodes),
            // CODESYS commonly embeds program instances under task.pouInstance.
            programs: this.extractPrograms(ensureArray(resource?.program), taskNodes),
            globalVars: this.extractVariables(ensureArray(resource?.globalVars?.variable))
          };
        }) ?? []
    }));
  }

  private extractTasks(nodes: any[] | undefined): any[] {
    return (
      nodes?.map((task: any, index: number) => ({
        name: this.readAttr(task, 'name') ?? `Task${index}`,
        interval: this.readAttr(task, 'interval'),
        priority: Number.parseInt(this.readAttr(task, 'priority') ?? '1', 10),
        single: this.readAttr(task, 'single') === 'true'
      })) ?? []
    );
  }

  private extractPrograms(resourceProgramNodes: any[] | undefined, taskNodes: any[] | undefined): any[] {
    const programs =
      resourceProgramNodes?.map((program: any, index: number) => {
        const name = this.firstNonEmpty(this.readAttr(program, 'name'), `Program${index}`);
        return {
          name,
          typeName: this.firstNonEmpty(this.readAttr(program, 'typeName'), this.readAttr(program, 'type'), name, 'MainProgram'),
          taskName: this.firstNonEmpty(this.readAttr(program, 'taskName'), this.readAttr(program, 'task'))
        };
      }) ?? [];

    taskNodes?.forEach((task: any, taskIndex: number) => {
      const taskName = this.firstNonEmpty(this.readAttr(task, 'name'), `Task${taskIndex}`);
      ensureArray(task?.pouInstance)?.forEach((instance: any, instanceIndex: number) => {
        const name = this.firstNonEmpty(this.readAttr(instance, 'name'), `Program_${taskIndex}_${instanceIndex}`);
        programs.push({
          name,
          typeName: this.firstNonEmpty(this.readAttr(instance, 'typeName'), this.readAttr(instance, 'type'), name, 'MainProgram'),
          taskName
        });
      });
    });

    const deduped: any[] = [];
    const seen = new Set<string>();
    programs.forEach(program => {
      const key = `${program.name}::${program.taskName ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(program);
      }
    });

    return deduped;
  }

  private extractVariables(nodes: any[] | undefined): VariableDeclaration[] | undefined {
    if (!nodes) {
      return undefined;
    }
    return nodes.map((variable: any) => this.toVariableDeclaration(variable));
  }

  private readAttr(node: any, key: string): any {
    return node?.[key] ?? node?.[`@_${key}`] ?? node?.[`_${key}`];
  }

  private firstNonEmpty(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string') {
        if (value.trim().length > 0) {
          return value.trim();
        }
        continue;
      }
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
    return '';
  }

  private inferIoDirection(address?: string): 'input' | 'output' | 'memory' | undefined {
    if (!address) return undefined;
    const normalized = address.trim().toUpperCase();
    if (normalized.startsWith('%I')) return 'input';
    if (normalized.startsWith('%Q')) return 'output';
    if (normalized.startsWith('%M')) return 'memory';
    return undefined;
  }

  private parseSimpleValue(raw: unknown): number | boolean | string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw;
    const text = String(raw).trim();
    if (/^(true|false)$/i.test(text)) {
      return text.toLowerCase() === 'true';
    }
    const num = Number(text);
    if (!Number.isNaN(num)) {
      return num;
    }
    return text;
  }

  private extractStructuredTextBody(pou: any): string {
    const stNode = pou?.body?.ST ?? pou?.body?.st;
    if (typeof stNode === 'string') {
      return stNode;
    }
    if (!stNode || typeof stNode !== 'object') {
      return '';
    }

    const fromXhtml = stNode?.xhtml;
    if (typeof fromXhtml === 'string') {
      return fromXhtml;
    }
    if (fromXhtml && typeof fromXhtml === 'object') {
      const text = fromXhtml?.['#text'] ?? fromXhtml?.__text;
      if (typeof text === 'string') {
        return text;
      }
    }

    const directText = stNode?.['#text'] ?? stNode?.__text;
    if (typeof directText === 'string') {
      return directText;
    }

    return '';
  }

  private extractAllPouNodes(ast: any): any[] {
    const direct = ensureArray(ast?.project?.types?.pous?.pou) ?? ensureArray(ast?.project?.pous?.pou) ?? [];
    const embedded = this.extractEmbeddedPouNodes(ast);
    if (!direct.length && !embedded.length) {
      return [];
    }

    const all = [...direct, ...embedded];
    const deduped: any[] = [];
    const seen = new Set<string>();
    all.forEach((pou: any, index: number) => {
      const key = `${pou?.name ?? pou?.['@_name'] ?? `pou_${index}`}::${pou?.pouType ?? pou?.['@_pouType'] ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(pou);
      }
    });
    return deduped;
  }

  private extractEmbeddedPouNodes(ast: any): any[] {
    const result: any[] = [];
    const configurations = ensureArray(ast?.project?.instances?.configurations?.configuration);
    configurations?.forEach((config: any) => {
      ensureArray(config?.resource)?.forEach((resource: any) => {
        ensureArray(resource?.addData?.data)?.forEach((dataNode: any) => {
          ensureArray(dataNode?.pou)?.forEach((pou: any) => result.push(pou));
        });
      });
    });
    return result;
  }

  private resolveDataType(typeNode: any): string {
    if (!typeNode) {
      return 'BOOL';
    }
    if (typeof typeNode === 'string') {
      return typeNode;
    }
    if (typeNode.derived?.['@_name']) {
      return typeNode.derived['@_name'];
    }
    if (typeNode.derived?.name) {
      return typeNode.derived.name;
    }
    const keys = Object.keys(typeNode);
    if (keys.length > 0) {
      return keys[0];
    }
    return 'BOOL';
  }

  private parseLdNetwork(network: any, fallbackId: string): LadderRung {
    const id = network?.name ?? network?.id ?? fallbackId;
    const elements: LadderElement[] = [];

    const contactNodes = ensureArray(network?.contact);
    const coilNodes = ensureArray(network?.coil);

    contactNodes?.forEach((node: any, idx: number) => {
      elements.push(this.ldNodeToElement(node, 'contact', `${id}_c${idx}`));
    });
    coilNodes?.forEach((node: any, idx: number) => {
      elements.push(this.ldNodeToElement(node, 'coil', `${id}_k${idx}`));
    });

    const branches: LadderBranch[] | undefined = ensureArray(network?.parallel)
      ?.flatMap((parallel: any, parallelIndex: number) =>
        ensureArray(parallel?.branch)?.map((branch: any, branchIndex: number) => {
          const branchElements: LadderElement[] = [];
          ensureArray(branch?.contact)?.forEach((node: any, idx: number) => {
            branchElements.push(this.ldNodeToElement(node, 'contact', `${id}_b${branchIndex}_c${idx}`));
          });
          ensureArray(branch?.coil)?.forEach((node: any, idx: number) => {
            branchElements.push(this.ldNodeToElement(node, 'coil', `${id}_b${branchIndex}_k${idx}`));
          });
          const startColumnRaw = branch?.startColumn ?? branch?.['@_startColumn'] ?? '0';
          const endColumnRaw = branch?.endColumn ?? branch?.['@_endColumn'];
          const startColumn = Number.parseInt(startColumnRaw, 10);
          const endColumnParsed =
            endColumnRaw !== undefined ? Number.parseInt(endColumnRaw, 10) : startColumn + branchElements.length;
          return {
            id: branch?.id ?? `${id}_branch_${parallelIndex}_${branchIndex}`,
            elements: branchElements,
            startColumn: Number.isFinite(startColumn) ? startColumn : 0,
            endColumn: Number.isFinite(endColumnParsed) ? endColumnParsed : (Number.isFinite(startColumn) ? startColumn + branchElements.length : branchElements.length)
          } as LadderBranch;
        }) ?? []
      )
      .filter(Boolean);

    return {
      id,
      elements,
      branches: branches && branches.length > 0 ? branches : undefined
    };
  }

  private ldNodeToElement(node: any, type: 'contact' | 'coil', fallbackId: string): LadderElement {
    const readAttr = (key: string): any => node?.[key] ?? node?.[`@_${key}`] ?? node?.[`_${key}`];
    const label = readAttr('variable') ?? readAttr('label') ?? fallbackId;
    const addrType = this.inferAddrType(label);
    const negated = readAttr('negated');
    const variant = negated === 'true' || negated === true ? 'nc' : 'no';
    const stateRaw = readAttr('state');
    const state = stateRaw === 'true' || stateRaw === true ? true : stateRaw === 'false' || stateRaw === false ? false : undefined;
    return {
      id: readAttr('localId') ?? readAttr('refLocalId') ?? readAttr('id') ?? fallbackId,
      label,
      type,
      variant,
      state,
      addrType
    };
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
    let pouNodes: any[] = this.model.pous.map(pou => ({
      '@_name': pou.name,
      '@_pouType': pou.pouType ?? 'program',
      interface: this.serializeInterface(pou.interface),
      body: { ST: pou.body }
    }));

    const ladderPou = this.serializeLadderPou();
    if (ladderPou) {
      const ladderName = ladderPou?.['@_name'] ?? ladderPou?.name;
      // Remove any existing POU with the same name to avoid duplicates from previous saves.
      pouNodes = pouNodes.filter(p => (p?.['@_name'] ?? p?.name) !== ladderName);
      pouNodes.push(ladderPou);
    }

    const projectNode: any = {
      '@_xmlns': 'http://www.plcopen.org/xml/tc6_0200',
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@_xmlns:plcemu': 'https://vibe.codes/plc-emu',
      '@_name': this.model.metadata?.projectName ?? this.model.metadata?.productName ?? 'PLCopenProject',
      '@_productName': this.model.metadata?.productName ?? 'plc-emu',
      '@_productVersion': this.model.metadata?.productVersion ?? '0.1.0',
      fileHeader: this.serializeFileHeader(),
      contentHeader: this.serializeContentHeader(),
      types: {
        pous: { pou: pouNodes }
      }
    };

    const configurations = this.model.configurations ?? [];
    if (configurations.length > 0) {
      projectNode.instances = {
        configurations: {
          configuration: configurations.map(config => this.serializeConfiguration(config))
        }
      };
    }

    return { project: projectNode };
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

    if (element.addrType) {
      serialized['@_addrType'] = element.addrType;
    }

    return serialized;
  }

  private serializeInterface(intf?: PouInterface): any | undefined {
    if (!intf) return undefined;
    const maybe = (vars?: VariableDeclaration[]) => (vars && vars.length ? { variable: vars.map(v => this.serializeVariable(v)) } : undefined);
    const node: any = {
      inputVars: maybe(intf.inputVars),
      outputVars: maybe(intf.outputVars),
      inOutVars: maybe(intf.inOutVars),
      localVars: maybe(intf.localVars),
      tempVars: maybe(intf.tempVars)
    };
    return Object.values(node).some(Boolean) ? node : undefined;
  }

  private serializeFileHeader(): any {
    const meta = this.model.metadata ?? {};
    return {
      '@_companyName': meta.companyName ?? 'plc-emu',
      '@_productName': meta.productName ?? 'plc-emu',
      '@_productVersion': meta.productVersion ?? '0.1.0',
      '@_creationDateTime': meta.creationDateTime ?? new Date().toISOString()
    };
  }

  private serializeContentHeader(): any {
    const meta = this.model.metadata ?? {};
    return {
      '@_name': meta.projectName ?? meta.productName ?? 'PLCopenProject',
      '@_modificationDateTime': meta.contentModificationDateTime ?? new Date().toISOString(),
      '@_version': meta.contentVersion ?? meta.productVersion ?? '0.1.0',
      '@_organization': meta.organization ?? meta.companyName ?? 'plc-emu'
    };
  }

  private serializeConfiguration(config: Configuration): any {
    const node: any = {
      '@_name': config.name
    };
    if (config.globalVars && config.globalVars.length > 0) {
      node.globalVars = {
        variable: config.globalVars.map(v => this.serializeVariable(v))
      };
    }
    if (config.resources && config.resources.length > 0) {
      node.resource = config.resources.map(resource => this.serializeResource(resource));
    }
    return node;
  }

  private serializeResource(resource: any): any {
    const node: any = {
      '@_name': resource.name,
      task: (resource.tasks ?? []).map((task: any) => this.serializeTask(task)),
      program: (resource.programs ?? []).map((program: any) => this.serializeProgramInstance(program))
    };
    if (resource.globalVars && resource.globalVars.length > 0) {
      node.globalVars = { variable: resource.globalVars.map((v: VariableDeclaration) => this.serializeVariable(v)) };
    }
    return node;
  }

  private serializeTask(task: any): any {
    const node: any = {
      '@_name': task.name
    };
    if (task.priority !== undefined) node['@_priority'] = task.priority;
    if (task.interval) node['@_interval'] = task.interval;
    if (task.single !== undefined) node['@_single'] = `${task.single}`;
    return node;
  }

  private serializeProgramInstance(program: any): any {
    const node: any = {
      '@_name': program.name,
      '@_typeName': program.typeName
    };
    if (program.taskName) {
      node['@_taskName'] = program.taskName;
    }
    return node;
  }

  private serializeVariable(variable: VariableDeclaration): any {
    const node: any = {
      '@_name': variable.name
    };
    if (variable.address) node['@_address'] = variable.address;
    if (variable.constant !== undefined) node['@_constant'] = `${variable.constant}`;
    if (variable.retain !== undefined) node['@_retain'] = `${variable.retain}`;
    if (variable.persistent !== undefined) node['@_persistent'] = `${variable.persistent}`;
    if (variable.opcUaNodeId) node['@_plcemu:opcUaNodeId'] = variable.opcUaNodeId;
    node.type = this.serializeTypeNode(variable.dataType);
    if (variable.initialValue !== undefined) {
      node.initialValue = { simpleValue: { '@_value': this.serializeInitialValue(variable.initialValue) } };
    }
    if (variable.documentation) {
      node.documentation = variable.documentation;
    }
    return node;
  }

  private serializeTypeNode(type: string): any {
    const upper = type.toUpperCase();
    const primitives = ['BOOL', 'INT', 'DINT', 'REAL', 'LREAL', 'STRING', 'WORD', 'DWORD'];
    if (primitives.includes(upper)) {
      return { [upper]: {} };
    }
    return { derived: { '@_name': type } };
  }

  private serializeInitialValue(value: number | boolean | string): string {
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
  }

  private serializeLadderPou(): any | undefined {
    if (!this.model.ladder || this.model.ladder.length === 0) {
      return undefined;
    }
    return {
      '@_name': 'MainLadder',
      '@_pouType': 'program',
      body: {
        LD: {
          network: this.model.ladder.map((rung, idx) => this.serializeNetwork(rung, idx))
        }
      }
    };
  }

  private serializeNetwork(rung: LadderRung, index: number): any {
    const network: any = {
      '@_name': rung.id ?? `network_${index}`,
      powerRail: { '@_direction': 'left' }
    };
    const contacts: any[] = [];
    const coils: any[] = [];
    rung.elements.forEach((el, elIndex) => {
      const node = this.serializeLdElement(el, `${rung.id}_${elIndex}`);
      if (el.type === 'contact') {
        contacts.push(node);
      } else {
        coils.push(node);
      }
    });
    if (contacts.length > 0) network.contact = contacts;
    if (coils.length > 0) network.coil = coils;

    if (rung.branches && rung.branches.length > 0) {
      network.parallel = {
        branch: rung.branches.map((branch, branchIndex) => this.serializeBranch(branch, branchIndex))
      };
    }
    return network;
  }

  private serializeBranch(branch: LadderBranch, branchIndex: number): any {
    const node: any = {
      '@_id': branch.id ?? `branch_${branchIndex}`,
      '@_startColumn': branch.startColumn,
      '@_endColumn': branch.endColumn
    };
    const contacts: any[] = [];
    const coils: any[] = [];
    branch.elements.forEach((el, idx) => {
      const serialized = this.serializeLdElement(el, `${branch.id}_${idx}`);
      if (el.type === 'contact') {
        contacts.push(serialized);
      } else {
        coils.push(serialized);
      }
    });
    if (contacts.length > 0) node.contact = contacts;
    if (coils.length > 0) node.coil = coils;
    return node;
  }

  private serializeLdElement(element: LadderElement, fallbackId: string): any {
    const negated = element.variant === 'nc';
    const node: any = {
      '@_localId': element.id ?? fallbackId,
      '@_variable': element.label
    };

    // PLCopen LD represents NC contacts via the "negated" attribute. Omit the
    // attribute for NO to avoid generating empty-valued attributes in the XML.
    if (element.type === 'contact') {
      if (negated) {
        node['@_negated'] = 'true';
      }
    }
    if (element.type === 'coil') {
      return node;
    }
    return node;
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

  private validateLoadedModel(model: PLCProjectModel): void {
    const hasPous = model.pous.length > 0;
    const hasLadder = model.ladder.length > 0;
    const hasProgramBindings =
      model.configurations?.some(configuration =>
        configuration.resources.some(resource => (resource.programs?.length ?? 0) > 0)
      ) ?? false;

    if (!hasPous && !hasLadder && !hasProgramBindings) {
      throw new Error('No POUs, ladder networks, or program bindings were found in the PLCopen XML.');
    }
  }

  private createDefaultModel(): PLCProjectModel {
    return {
      metadata: {
        companyName: 'plc-emu',
        productName: 'plc-emu',
        productVersion: '0.1.0'
      },
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
            { id: 'r0_e0', label: 'XSTOP', type: 'contact', state: false, variant: 'nc', addrType: 'X' },
            { id: 'r0_e1', label: 'XSTART', type: 'contact', state: false, variant: 'no', addrType: 'X' },
            { id: 'r0_e2', label: 'M0', type: 'coil', state: false, addrType: 'M' }
          ],
          branches: [
            {
              id: 'r0_b0',
              elements: [
                { id: 'r0_b0_e0', label: 'M0', type: 'contact', state: false, variant: 'no', addrType: 'M' }
              ],
              startColumn: 0,
              endColumn: 2
            }
          ]
        },
        {
          id: 'rung_1',
          elements: [
            { id: 'r1_e0', label: 'M0', type: 'contact', state: false, variant: 'no', addrType: 'M' },
            { id: 'r1_e1', label: 'Y0', type: 'coil', state: false, addrType: 'Y' }
          ]
        }
      ],
      configurations: [
        {
          name: 'Config0',
          globalVars: [
            { name: 'StartPB', dataType: 'BOOL', address: '%IX0.0', ioDirection: 'input' },
            { name: 'StopPB', dataType: 'BOOL', address: '%IX0.1', ioDirection: 'input' },
            { name: 'MotorOut', dataType: 'BOOL', address: '%QX0.0', ioDirection: 'output' }
          ],
          resources: [
            {
              name: 'Resource1',
              tasks: [{ name: 'CyclicTask', interval: 'PT0.1S', priority: 1 }],
              programs: [{ name: 'PRG_MainProgram', typeName: 'MainProgram', taskName: 'CyclicTask' }]
            }
          ]
        }
      ]
    };
  }

  private inferAddrType(value: string | undefined): 'X' | 'M' | 'Y' | undefined {
    if (!value) return undefined;
    const c = String(value).trim().toUpperCase()[0];
    if (c === 'X' || c === 'M' || c === 'Y') return c;
    return undefined;
  }
}

function ensureArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}
