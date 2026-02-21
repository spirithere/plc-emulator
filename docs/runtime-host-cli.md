# Runtime Host CLI ガイド

外部バックエンドモード（`plcEmu.runtimeMode = "external"`）では、VS Code 拡張とは別プロセスで IEC スキャンを実行する **Runtime Host CLI** が利用されます。このドキュメントでは、CLI の起動方法と JSON-RPC コマンド仕様をまとめます。

> MCP / REST でランタイムを操作したい場合は `docs/runtime-mcp-rest.md` を参照してください（`npm run host:mcp`）。

## 1. 起動方法

```bash
npm install        # まだなら依存のインストール
npm run compile    # TypeScript ビルド
npm run host -- --port=8123   # Runtime Host CLI を起動（ポート指定可）
```

- `npm run host` は `out/runtime/host/cli.js` を Node.js で実行します。`--port=<number>` を渡すと TCP リッスンポートを変更できます（既定 8123）。
- `--mcp-port=<number>` を併用すると、同一ランタイム状態を共有したまま FastMCP + REST サーバーも同時起動します（例: `npm run host -- --port=8123 --mcp-port=8124`）。
- `npm run host:all` は `runtime/host` (JSON-RPC) と `runtime/mcp` (MCP + REST) を同一プロセスでまとめて起動するショートカットです。
- external runtime モードで VS Code から起動した場合も同じプロセスが `127.0.0.1:<port>` を開放するため、拡張 UI と並行して外部クライアントが接続できます。
- CLI は標準入力からの JSON-RPC と TCP ソケットからの JSON-RPC を同時に受け付け、レスポンス／通知を JSON 1 行で返します。標準エラーにはログ（INFO/WARN/ERROR）が出力されるので、スクリプトでは stdout/stderr を分けて扱ってください。

## 2. 基本シーケンス

1. CLI 起動直後に `{"jsonrpc":"2.0","method":"host.ready","params":{"message":"Runtime host initialized","port":8123}}` のような通知が来ます（`port` は実際に listen しているポート番号）。
2. クライアントは `project.load` で PLC モデル（POU / Ladder）を送信します。
3. `runtime.start` コマンドでスキャンを開始し、`runtime.state` / `runtime.runState` / `structuredText.diagnostics` の通知を購読します（通知は stdin 経由で接続した CLI にも、TCP クライアントにもブロードキャストされます）。`runtime.state` には直近の変数スナップショットに加えて `io.inputs` / `io.outputs` が含まれます。
4. 必要に応じて `runtime.writeVar` / `io.setInput` で変数や IO を操作します。
5. 終了する際は `runtime.stop` → CLI プロセス停止（`Ctrl+C` など）。

## 3. サポートされるコマンド

| メソッド | 説明 | パラメータ例 |
| --- | --- | --- |
| `ping` | 生存確認 | `{}` |
| `project.load` | ST/ラダーのモデルを丸ごと送信。拡張側は PLCopen Service から作った JSON を流用します。| `{ "pous": [...], "ladder": [...] }` |
| `runtime.start` | スキャン開始 | `{ "scanTimeMs": 100 }` |
| `runtime.stop` | スキャン停止 | `{}` |
| `runtime.step` | 停止中に指定回数だけスキャンを実行 | `{ "cycles": 1 }` |
| `runtime.reset` | STOP にしてメモリ/シーケンス/メトリクスをリセット | `{}` |
| `runtime.state.get` | 直近スキャンのスナップショットを同期取得 | `{}` |
| `runtime.metrics.get` | スキャン回数・最終スキャン時間などの実行メトリクスを取得 | `{}` |
| `runtime.variables.list` | 変数名一覧を取得 | `{}` |
| `runtime.writeVar` | 任意変数に値を書き込み | `{ "identifier": "M0", "value": true }` |
| `runtime.writeVars` | 複数変数を一括で書き込み | `{ "updates": [{ "identifier": "M0", "value": true }] }` |
| `io.setInput` | シミュレート入力を変更 | `{ "identifier": "X0", "value": false }` |
| `io.setInputs` | 複数入力を一括で変更 | `{ "updates": [{ "identifier": "X0", "value": false }] }` |

レスポンスは `{"jsonrpc":"2.0","id":<同じID>,"result":...}` 形式です。エラー時は `error.code` に `invalid_params`, `method_not_found` などが返ります。

## 4. 通知イベント

| メソッド | 内容 |
| --- | --- |
| `host.ready` | CLI が初期化されたタイミング（child process 起動時）。|
| `runtime.state` | `{ sequence, timestamp, snapshot }`。スキャン完了毎に発火。|
| `runtime.runState` | `{ running: boolean }`。Run/Stop 切替時に発火。|
| `structuredText.diagnostics` | パーサー/ランタイム診断。VS Code 拡張側の Problems に反映。|

## 5. VS Code からの利用

1. `settings.json` で `"plcEmu.runtimeMode": "external"` を設定。
2. 拡張を再読み込みすると、`RuntimeHostAdapter` が CLI を子プロセスとして起動し、`ExternalRuntimeController` 経由で従来 UI に状態が渡ります。
3. CLI がクラッシュした場合、拡張は自動で再起動し、PLC モデルを再同期します（このとき直前の Run 状態は `STOP` に戻ります）。
4. 拡張が起動したホストも `127.0.0.1:<port>`（既定 8123）を開放します。AI エージェントや別 CLI はこのポートへ接続すれば、拡張と同じ実行環境を共有したままコマンドを送信できます。

## 6. スクリプト／AI エージェントからの直接利用

- **stdio モード**: Node/Python から `child_process.spawn` / `subprocess.Popen` で CLI を起動し、`stdin.write(JSON + "\n")` でコマンドを送信できます。
- **TCP モード（推奨）**: 既に起動中のホストが開いているポートへ接続し、JSON 行を送ります。例: `nc 127.0.0.1 8123` で接続し、`{"jsonrpc":"2.0","id":1,"method":"ping"}` を送ると同じソケットでレスポンスが返ります。
- CLI を手動起動する場合も `npm run host -- --port=9000` などでポートを指定し、VS Code 拡張と AI エージェントが任意の組み合わせで同時接続できます。
- 将来的には WebSocket / gRPC バックエンドも追加予定です。それまではローカル TCP ソケットまたは stdio 経由での制御を想定しています。

### 6.1 `plcrun` ユーティリティ

日常的な操作を簡略化するため、リポジトリには `plcrun` CLI を同梱しています。`npm run compile` 後、次のように利用できます。

```bash
npm run plcrun -- ping                  # 生存確認
npm run plcrun -- start 50              # 50ms スキャンで開始
npm run plcrun -- step 1                # 停止中に 1 スキャンだけ実行
npm run plcrun -- state                 # 直近スナップショット取得
npm run plcrun -- metrics               # 実行メトリクス取得
npm run plcrun -- reset                 # Runtime リセット
npm run plcrun -- write M0 true         # 変数書き込み
npm run plcrun -- rpc runtime.stop      # 任意の method を直接指定
```

`plcrun` は内部的に `127.0.0.1:8123` (環境変数 `PLC_RUN_HOST` / `PLC_RUN_PORT` で変更可) に TCP 接続して JSON-RPC を送信します。VS Code 拡張と同時に利用可能です。

## 7. トラブルシューティング

- **host.ready が届かない**: `npm run compile` が未実行で `out/runtime/host/cli.js` が無い場合や、指定ポートが既に使用中の場合に発生します。再ビルド・ポート変更を行い、CLI を再起動してください。TCP を使う場合は `host.ready` の `port` フィールドで実際のポートを確認できます。
- **scan が進まない**: `project.load` を送信せずに `runtime.start` すると、空の PLC モデルでスキャンするため出力が変化しません。まずモデルを送ってから start してください。
- **大量ログ**: `npm run host -- --log json` のようなオプションは未実装です。標準エラーを好みでフィルタしてください。

今後のロードマップ: 状態差分配信、複数クライアント、WebSocket トランスポートを追加予定です。
