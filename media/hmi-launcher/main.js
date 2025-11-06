(function () {
  const vscode = acquireVsCodeApi();
  const el = sel => document.querySelector(sel);
  el('#btnDesigner')?.addEventListener('click', () => vscode.postMessage({ type: 'openDesigner' }));
  el('#btnRuntime')?.addEventListener('click', () => vscode.postMessage({ type: 'openRuntime' }));
  el('#btnOpenJson')?.addEventListener('click', () => vscode.postMessage({ type: 'openJson' }));
})();

