# バックエンド分離計画（AI エージェント対応）

## 1. 目的と対象範囲
- VS Code 拡張に内包された `EmulatorController` をヘッドレスな実行サービスとして切り出し、1 つの実行環境を複数クライアント（拡張 UI + AI エージェント）が共有できるようにする。
- 既存のリアルタイム変数ストリーミング機能（拡張 Output+状態ビュー）は維持しつつ、外部ツールがスキャン状態を取得・変更できる API を追加する。
- つねに 1 つの PLC プロジェクトを真実のソース（PLCopen XML）として扱い、コード編集→ビルド→実行を自動化できる足場を整える。

## 2. 要件と制約
### 機能要件
1. ヘッドレス Runtime Host が ST+ラダーを現在と同等の周期で実行し、I/O の読み書きを提供する。
2. 双方向ストリーミング: 実行状態（変数マップ、IO、ログ）をサーバー→クライアントへ push、外部クライアントはコマンド（run/stop/step/reset, variable write, IO toggle, profile 切替）を送れる。
3. VS Code 拡張は従来 UI を維持しつつ、Runtime Host 経由でデータを取得する。
4. AI エージェントが CLI/HTTP/WebSocket で Runtime Host に接続し、テスト・デバッグ自動化を実行できる。
5. 1 つの Runtime Host に対して複数クライアントが同時接続でき、購読単位で更新を受け取れる。
6. プロジェクト切替・PLCopen モデル変更時は Runtime Host 側がホットリロードし、全クライアントへ差分通知する。

### 非機能要件
- **リアルタイム性**: デフォルト 100ms スキャンで遅延 20ms 以内を目標。サーバー内でスキャンとストリーム送信を分離する。
- **信頼性**: Host が落ちても再起動して状態同期を復旧できる。クライアントは再接続ロジックを持つ。
- **セキュリティ**: ローカル IPC がデフォルト。リモート展開時は API トークン + オプション TLS。
- **拡張性**: 将来 gRPC, WebSocket, HTTP/JSON-RPC いずれでも提供できるよう、Transport 抽象を導入する。
- **可観測性**: メトリクス/トレースを吐き、AI エージェントが自動で結果判断しやすい構造化ログを出力する。

## 3. 現状まとめ
- VS Code 拡張プロセス内で `EmulatorController` が PLCopen モデル・IO サービス・プロフィールを直接参照し、`EventEmitter` で UI へ通知している。
- リアルタイムストリームは Extension Host 内の output channel / 状態ビューに限定されており、外部プロセスからはアクセスできない。
- IO も `IOSimService` 経由でローカルに閉じているため、AI エージェントは VS Code API 経由でしか操作できない。

## 4. ターゲットアーキテクチャ
| コンポーネント | 役割 |
| --- | --- |
| Runtime Host (Node CLI or service) | PLCopen モデル読み込み、スキャン実行、IO シミュレーション、状態キャプチャ。
| Transport / Gateway | WebSocket + JSON-RPC (初期) でコマンド受信と状態配信。gRPC への差し替えを意識した抽象化。
| Extension Client Adapter | VS Code 拡張側。既存 UI イベントを API コールに変換し、状態ストリームを UI/パネルへ反映。
| Agent SDK | CLI/ライブラリ（Node/ Python）で Runtime Host API を包み、AI エージェントが run/step/inspect/patch を行う。
| Project Sync Service | PLCopen ファイルと Host 間で差分を同期。ファイル変更 → Host にインクリメンタル更新を送る。

### データフロー
1. VS Code または Agent が `project.open` コマンドで PLCopen パスを Runtime Host へ登録。
2. Host がファイル監視し、モデル構築→AST/IO 定義をキャッシュ。
3. `runtime.start` でスキャンループ開始。Host は `state.stream` チャンネルに変数/IO/ログを publish。
4. クライアントは `state.subscribe` で購読し、UI 更新または AI 判断に利用。
5. `runtime.writeVar` / `io.write` で状態変更。Host は楽観ロックで衝突検知し、結果を broadcast。

## 5. API & プロトコル設計（v1 草案）
- **Transport**: ローカルでは Unix Domain Socket + JSON-RPC/MessagePack。リモート想定で WebSocket にも対応。
- **Command Channel** (Request/Response)
  - `project.open`, `project.close`, `project.syncPatch`
  - `runtime.start`, `runtime.stop`, `runtime.step`, `runtime.reset`
  - `runtime.writeVar`, `io.writeChannel`, `profile.set`
  - `diagnostics.get`（ST/LD エラー取得）
- **State Stream** (Server → Client)
  - `state.scanComplete`：変数スナップショット + diff + scan timestamp
  - `state.ioChange`：IO チャネルごとの差分
  - `state.log`：構造化ログ（level, source, message, metadata）
  - `state.runState`：RUN/STOP 変更イベント
  - `project.changed`：PLCopen モデル更新通知
- **Consistency**: ストリームは ring buffer 化し、クライアント再接続時に `sinceCursor` を指定して欠落分を再取得。
- **Access Control**: ローカルでは OS アカウントに紐づくソケット。リモートでは API Key or OAuth トークン。

## 6. 実装ステップ
1. **Core 抽象化**
   - `EmulatorController` を `RuntimeCore` (純 TypeScript, vscode 非依存) へ抽出。
   - IO, Profile, PLCopen サービスにインターフェースを導入し、依存性注入で runtimes/clients を切り替え可能にする。
2. **Runtime Host プロセス**
   - Node CLI (`plc-emu-host`) を追加し、`RuntimeCore` を起動。
   - IPC 層（JSON-RPC over stdio or socket）とシンプルなコマンドループを実装。
3. **Streaming Gateway**
   - Host 内で Pub/Sub バスを整備し、スキャン結果をストリーム化。
   - 既存のログ/状態イベントをバス経由に置き換え、UI/Agent 両方が subscribe できるようにする。
4. **Extension Adapter**
   - VS Code 拡張から Runtime Host をサブプロセスとして管理（開始/終了/再接続）。
   - 既存 UI（状態ビュー、IO シム、HMI、ST 診断）を新 API に順次載せ替え。
5. **Agent 接続ポイント**
   - CLI/SDK（Node & Python）を公開し、`run`, `step`, `io`, `watch` コマンドを提供。
   - サンプル: Codex/Claude が `plc-emu host` を起動し、自動テストを実行。
6. **外部制御強化**
   - ブレークポイント / ウォッチリスト API
   - シミュレート IO シナリオのシナリオ再生（録画/再生 API）
7. **観測/運用**
   - Prometheus 互換メトリクス, structured log（JSON Lines）。
   - 健康チェック (`/healthz`, `runtime.stats`).

## 7. テスト & バリデーション
- **ユニット**: RuntimeCore と Transport 層を切り離した状態で Vitest を既存テストに追加。
- **統合**: Extension ↔ Host ↔ Agent の E2E を Playwright + headless VS Code Test Runner で自動化。
- **負荷**: 10k 変数・1k IO チャンネルでのスキャン遅延測定。ストリーム輻輳時も 2 スキャン以内に送信することを確認。
- **フェイルオーバー**: Host プロセス kill → 再起動後にクライアントが自動再接続し、最新スナップショットを取得できるか検証。

## 8. リスクと対策
- **スキャン遅延**: IPC/シリアライズによるオーバーヘッド → 差分送信とバイナリ（MessagePack）化で軽量化。
- **状態競合**: 複数クライアントが同一変数を書き換える → `writeVar` に世代番号 + last-writer metadata を含め、衝突時に `409` エラーと通知。
- **プロセス管理**: VS Code 子プロセスがゾンビ化 → ライフサイクル監視 + heartbeat、クラッシュ時の自動再 spawn。
- **セキュリティ**: リモート接続を許可する場合は TLS/認証。デフォルトはローカルホスト限定で起動。
- **開発体験**: エージェントがログを解析できない → 全ログを JSON 形式で出力し、CLI で `--json` フラグを提供。

## 9. 進捗チェックリスト
- [ ] RuntimeCore インターフェース化と VS Code 依存の排除
- [ ] IPC/Transport 層プロトタイピング（JSON-RPC over WebSocket/UDS）
- [ ] Runtime Host CLI (`plc-emu host`) 起動 + 基本コマンド
- [ ] 状態ストリームの差分配送 + 再接続サポート
- [ ] Extension 側アダプター実装＆既存 UI からの移行
- [ ] Agent SDK + サンプルワークフロー（自動テスト, IO スクリプト）
- [ ] 観測・監視（metrics/logs/health）
- [ ] 負荷/フェイルオーバー試験完了
