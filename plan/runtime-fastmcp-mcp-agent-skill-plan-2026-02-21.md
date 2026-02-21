# PLC Runtime 汎用化・高速化・MCP/REST対応 実装計画

作成日: 2026-02-21  
対象リポジトリ: `/Users/spirithere/Projects/vibe/plc-emu`

## 1. 目的

既存の `plc-emu` ランタイムを以下へ進化させる。

1. より汎用的なランタイム（VS Code 拡張非依存、単体利用可能）
2. より高速なランタイム（高頻度スキャン時の遅延とメモリ圧迫を低減）
3. API 拡充（既存 JSON-RPC を維持しつつ REST + MCP を追加）
4. Agent が MCP 経由で状態監視・制御できる運用
5. 上記ランタイム制御を再利用可能にする Agent Skill 実装（`skill-creator` ベース）

## 2. 調査サマリ（一次情報）

### 2.1 現行実装（repo）

- `src/runtime/runtimeCore.ts`
  - 実行コアは既に VS Code 依存が薄く、`PlcModelProvider`/`RuntimeIOAdapter` 抽象あり。
  - ただしスキャン・状態配信・コマンド処理の責務が単一クラスに集中。
- `src/runtime/host/cli.ts`
  - stdio + TCP(127.0.0.1) の JSON-RPC サーバー。
  - 既存 API: `project.load`, `runtime.start/stop`, `runtime.state.get`, `runtime.variables.list`, `runtime.writeVar`, `io.setInput`。
- `src/runtime/externalController.ts`
  - VS Code 側から外部ホストを利用する橋渡し。
- `docs/runtime-host-cli.md`
  - マルチクライアント接続や通知仕様が記載済み（今後拡張の土台あり）。

### 2.2 FastMCP（TypeScript）調査結果

現時点の npm 情報（2026-02-21 調査）:

- `fastmcp`: `3.33.0`
- `@modelcontextprotocol/sdk`: `1.26.0`
- `fastmcp` パッケージ更新日時: 2026-02-16（npm `time.modified`）

実装検討上の重要点:

- `httpStream` トランスポートで MCP over HTTP を提供可能（`/mcp`）。
- 同一プロセスで `addRoute` によるカスタム HTTP ルート追加が可能。
  - つまり MCP と REST API を同居できる。
- 認証フック・HTTPS・stateless モードなど運用拡張あり。

### 2.3 MCP 公式仕様（2025-06-18）で守るべき要点

- Streamable HTTP は単一エンドポイントで `POST` + `GET` を扱う。
- `POST` の `Accept` は `application/json` と `text/event-stream` を受理する必要。
- セッション運用時は `Mcp-Session-Id` を初期化応答で返し、後続要求で必須化できる。
- 仕様準拠上、`MCP-Protocol-Version` ヘッダー運用が必要。
- セキュリティ要件:
  - `Origin` 検証を実施
  - ローカル利用時は `127.0.0.1` bind 推奨
  - 認証導入推奨

### 2.4 FastMCP（Python）OpenAPI 統合調査結果

- 公式 docs で `FastMCP.from_openapi()` による REST(OpenAPI) -> MCP 変換を提供。
- `RouteMap` で Tool/Resource/Template/Exclude のマッピング制御が可能。
- ただし本リポジトリは TypeScript 主体なので、実装本線は TS FastMCP を採用する。
- Python FastMCP の OpenAPI 生成系は「外部 API 取り込みの将来オプション」として扱う。

## 3. 方針（結論）

### 3.1 採用方針

1. ランタイムは「アプリケーション層」と「トランスポート層」を分離する。
2. 既存 JSON-RPC は後方互換維持しつつ、FastMCP ベースの MCP/REST を追加する。
3. MCP と REST は同一プロセス・同一ランタイム状態を共有する。
4. Agent 制御は MCP Tool を第一級インターフェースとする。
5. Agent Skill は `skill-creator` 手順で作成し、運用可能なスクリプト/参照資料を同梱する。

### 3.2 非採用（現フェーズ）

- 既存 VS Code UI を即時 MCP クライアントへ全面移行すること（段階移行にする）。
- gRPC/WebSocket を初期実装で同時追加すること（将来フェーズへ分離）。

## 4. 目標アーキテクチャ

## 4.1 レイヤ構成

1. `RuntimeEngine`（純粋実行コア）
   - スキャン、ST/LD 実行、IO 反映、状態管理。
2. `RuntimeApplicationService`（ユースケース層）
   - `start/stop/step/reset/loadProject/write/read/subscribe` を提供。
3. `Transport Adapters`
   - JSON-RPC Adapter（既存互換）
   - MCP Adapter（FastMCP tools/resources/prompts）
   - REST Adapter（FastMCP addRoute）
4. `RuntimeHost`（起動と依存注入）
   - standalone CLI とライブラリ API の両方を提供。

## 4.2 追加予定 API（アプリ層）

- `project.load(model)`
- `runtime.start({ scanTimeMs })`
- `runtime.stop()`
- `runtime.step({ cycles })`
- `runtime.reset()`
- `runtime.state.get({ includeIo, sinceSequence? })`
- `runtime.variables.list()`
- `runtime.writeVar({ identifier, value })`
- `runtime.writeVars({ updates[] })`
- `io.setInput({ identifier, value })`
- `io.setInputs({ updates[] })`
- `runtime.metrics.get()`
- `runtime.events.subscribe({ topics, fromSequence? })`

## 4.3 MCP Tool 設計（初期案）

- `plc_runtime_start`
- `plc_runtime_stop`
- `plc_runtime_step`
- `plc_runtime_get_state`
- `plc_runtime_list_variables`
- `plc_runtime_write_variable`
- `plc_runtime_set_input`
- `plc_runtime_load_project`
- `plc_runtime_get_diagnostics`
- `plc_runtime_wait_for_condition`（ポーリング/タイムアウト付き）

補足:
- Tool 入出力は Zod スキーマで厳密定義。
- エラーはエージェントが扱いやすい構造化形式で返却。

## 4.4 REST API 設計（初期案）

- `GET /api/v1/runtime/state`
- `POST /api/v1/runtime/start`
- `POST /api/v1/runtime/stop`
- `POST /api/v1/runtime/step`
- `POST /api/v1/runtime/reset`
- `GET /api/v1/runtime/variables`
- `POST /api/v1/runtime/variables/write`
- `POST /api/v1/io/inputs/set`
- `GET /api/v1/runtime/metrics`
- `GET /api/v1/runtime/events`（SSE）

## 4.5 互換性

- 既存 JSON-RPC 名は残す（`runtime.start`, `runtime.stop`, ...）。
- 内部的には新 `RuntimeApplicationService` に委譲し重複ロジックを排除。

## 5. 高速化設計

## 5.1 スキャンループ改善

- `setInterval` 依存から、ドリフト補正付きスケジューラへ移行。
- スキャン超過時の overrun 計測を実装（`runtime.metrics` で可視化）。

## 5.2 状態配信最適化

- フル snapshot + diff の併用。
- イベントリングバッファ（例: 1,000〜10,000 件）を保持し再接続補完に利用。
- 高頻度書き込み時に不要な JSON 生成を抑制（差分のみ送信可能に）。

## 5.3 メモリ・GC 対策

- ホットパスでの一時オブジェクト生成を削減。
- ブロードキャストの backpressure 制御（遅い購読者を分離）。

## 6. セキュリティ/運用設計

- デフォルト bind: `127.0.0.1` 固定（現行方針維持）。
- `Origin` 検証を追加（MCP HTTP transport 側）。
- 認証は初期段階で API トークン方式（HTTP ヘッダー）を導入可能な形に。
- `health/ready` エンドポイントを追加し監視容易化。

## 7. 実装フェーズ

## フェーズ0: 設計固定（短期）

- 追加:
  - `/plan` の本計画
  - API 命名規約・後方互換方針
- 完了条件:
  - 既存呼び出し点（VS Code/CLI）への影響が整理済み。

## フェーズ1: コア分離と API 拡張

- `RuntimeApplicationService` 新設。
- `runtime.step/reset/writeVars/setInputs/metrics` を追加。
- 既存 `RuntimeCore` は実行責務へ集中。
- テスト追加:
  - 単体: 新 API の入力検証・状態遷移
  - 回帰: 既存 `emulator.test.ts` 系が維持される

## フェーズ2: FastMCP サーバー追加（MCP + REST 同居）

- 依存追加:
  - `fastmcp`
  - `@modelcontextprotocol/sdk`（必要に応じて明示）
  - `zod`
- 新規モジュール例:
  - `src/runtime/mcp/server.ts`
  - `src/runtime/mcp/tools/*.ts`
  - `src/runtime/http/restRoutes.ts`
- `transportType: "httpStream"` で MCP エンドポイントを起動。
- `addRoute` で REST API 追加。
- 完了条件:
  - MCP クライアントから run/stop/state/write が可能。
  - REST 経由でも同一状態を参照・制御可能。

## フェーズ3: JSON-RPC 互換層の再配線

- `src/runtime/host/cli.ts` の処理をアプリ層へ委譲。
- JSON-RPC/TCP/stdio は残し、移行期間の互換を保証。
- 完了条件:
  - 既存 `npm run host` + `npm run plcrun` が破壊されない。

## フェーズ4: 仕様準拠と耐障害性

- MCP Streamable HTTP 準拠テスト:
  - `Mcp-Session-Id`
  - `MCP-Protocol-Version`
  - `Accept` ヘッダー
- 接続断からの再購読/再取得テスト。
- メトリクス/ヘルス確認。

## フェーズ5: Agent Skill 実装（skill-creator）

- スキル名（案）: `plc-runtime-mcp-control`
- 作成場所（案）: `$CODEX_HOME/skills/plc-runtime-mcp-control`

作業手順（`skill-creator` 準拠）:

1. 利用シナリオ定義
   - 例: 「ランタイム起動→入力操作→状態検証→停止」を自動実行。
2. 再利用リソース設計
   - `scripts/`: MCP 経由制御の smoke/e2e 実行スクリプト
   - `references/`: ツール一覧、失敗時の復旧手順、運用ルール
3. スキル初期化
   - `init_skill.py` で雛形生成
4. `SKILL.md` 実装
   - トリガー条件、実行手順、異常時ハンドリングを明記
5. 検証
   - `quick_validate.py` 実行
   - 実際に MCP でランタイム制御タスクを流して確認

注意:

- 現環境では `PyYAML` 未導入のため `init_skill.py`/`quick_validate.py` 実行前に依存導入が必要。
  - 例: `python3 -m pip install pyyaml`

## フェーズ6: ドキュメント/導入整備

- 追加/更新候補:
  - `docs/runtime-host-cli.md`（MCP/REST 追記）
  - `README.md`（standalone 起動、MCP 接続例）
  - `docs/agent-skill-runtime-control.md`（運用例）
- `package.json` scripts 追加候補:
  - `host:mcp`
  - `host:all`（json-rpc + mcp + rest）

## 8. テスト計画

1. 単体テスト
   - アプリ層 API の状態遷移/入力検証
2. 統合テスト
   - JSON-RPC, MCP, REST が同一状態を参照すること
3. 仕様テスト
   - MCP Streamable HTTP ヘッダー・セッション挙動
4. 負荷テスト
   - 100ms 以下スキャンでの CPU/遅延/欠落イベント測定
5. 回帰テスト
   - `npm run verify`（compile + vitest）

## 9. 受け入れ基準（DoD）

1. ランタイムは VS Code なしで起動し、モデルロード〜実行制御が可能。
2. MCP クライアントから run/stop/state/write/input が実行可能。
3. REST API から同等操作が可能（MCP と状態一致）。
4. 既存 JSON-RPC クライアント（`plcrun`）が継続動作。
5. Agent Skill が作成され、最低 1 本の自動制御シナリオを成功させる。
6. `npm run verify` をパスし、主要追加機能のテストが実装済み。

## 10. 想定リスクと対策

- リスク: トランスポート増加で実装が分岐し保守性低下
  - 対策: アプリ層を単一責務にし、各 transport は薄い adapter に限定
- リスク: 高頻度スキャン時の通知負荷
  - 対策: diff 配信、バッファ、購読者ごとの backpressure
- リスク: MCP 仕様追随コスト
  - 対策: 仕様依存部分を adapter 隔離 + conformance テスト常設
- リスク: Skill の再現性不足
  - 対策: スクリプト化 + 失敗時分岐を `SKILL.md` に明記

## 11. 参考リンク（調査元）

- MCP 仕様（Transports, 2025-06-18）  
  https://raw.githubusercontent.com/modelcontextprotocol/specification/main/docs/specification/2025-06-18/basic/transports.mdx
- FastMCP TypeScript README（HTTP Stream, addRoute など）  
  https://github.com/punkpeye/fastmcp
- FastMCP npm（version/time）  
  https://www.npmjs.com/package/fastmcp
- FastMCP Python OpenAPI Integration  
  https://docs.gofastmcp.com/integrations/openapi
- skill-creator（ローカル）  
  `/Users/spirithere/.codex/skills/.system/skill-creator/SKILL.md`

