# HMI 実装計画（PLC Emulator 拡張）

本書は、PLC エミュレータに対する HMI（Human Machine Interface）表示・編集機能の設計と段階的実装計画です。IDE らしい UI 作成体験（ドラッグ＆ドロップ、配置、サイズ変更、プロパティ編集、入出力の割り当て）を VS Code 拡張の Webview で提供します。HMI 構成は PLCopen XML とは別ファイル（JSON）で管理します。

## ゴール
- HMI デザイナ（編集モード）と HMI ランタイム（表示/操作モード）を提供
- ウィジェットの追加・移動・リサイズ・プロパティ編集・削除が可能
- ウィジェットごとに適切な I/O/内部変数へのバインディングを設定
- JSON ファイルに HMI 構造を保存/読み込み（ワークスペース配下）
- サイドバーに HMI 入口を追加（Designer/Runtime をワンクリック起動）

## スコープ（MVP）
- 対応ウィジェット（最小）
  - 入力系: モーメンタリ押しボタン、トグルスイッチ、数値入力、スライダー
  - 表示系: ランプ（LED）、数値表示、テキスト
  - アクチュエータ表現: モーター、エアシリンダ（状態表示の簡易アニメ）
- キャンバス: グリッド・スナップ、ドラッグ＆ドロップ配置、リサイズ
- プロパティパネル: サイズ、座標、表示名、色、バインディング等
- I/O/内部変数のバインディング:
  - 入力ウィジェット → `inputs` または 内部変数（boolean/number）へ書き込み
  - 表示/アクチュエータ → `outputs` または 内部変数（boolean/number）を監視
- JSON 保存/読み込み、オートセーブ（VS Code のファイル API）

## アーキテクチャ概要
- Extension Host（TypeScript）
  - `HmiService`（新規）: HMI JSON の読み書き、スキーマ検証、変更イベント
  - 既存 `IOSimService`/`EmulatorController` と連携し、値の読書きを仲介
  - `HmiDesignerPanel`/`HmiRuntimeView` を作成・管理
- Webview（フロントエンド）
  - `media/hmi-designer/*`（Designer）: キャンバス、パレット、プロパティ、アウトライン
  - `media/hmi-runtime/*`（Runtime）: 描画最適化、入力イベント送出
  - 双方向メッセージ: load/save/ioState/write/broadcast（CSP 対応、nonce）
- データ永続化
  - 既定保存先: `.plc/hmi.json`（設定 `plcEmu.hmiFile` で変更可）
  - JSON Schema による検証（拡張内バンドル）

## データモデル（JSON）
- ファイル例: `.plc/hmi.json`
```json
{
  "version": 1,
  "canvas": { "width": 1280, "height": 720, "grid": 10, "background": "#1e1e1e" },
  "pages": [
    {
      "id": "main",
      "title": "Main",
      "widgets": [
        {
          "id": "btnStart",
          "type": "button",
          "variant": "momentary", // momentary | toggle
          "x": 40, "y": 60, "width": 120, "height": 40,
          "label": "Start",
          "binding": { "target": "input", "symbol": "I0" }
        },
        {
          "id": "lampMotor",
          "type": "lamp",
          "x": 200, "y": 60, "width": 24, "height": 24,
          "label": "Motor",
          "binding": { "target": "output", "symbol": "Q0" },
          "style": { "onColor": "#00ff88", "offColor": "#335" }
        },
        {
          "id": "motor",
          "type": "motor",
          "x": 260, "y": 40, "width": 64, "height": 64,
          "binding": { "target": "output", "symbol": "Q0" }
        }
      ]
    }
  ]
}
```

- JSON Schema（抜粋）
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "plc-emu.hmi.schema.json",
  "type": "object",
  "properties": {
    "version": { "type": "integer", "const": 1 },
    "canvas": {
      "type": "object",
      "required": ["width", "height"],
      "properties": {
        "width": { "type": "integer", "minimum": 100 },
        "height": { "type": "integer", "minimum": 100 },
        "grid": { "type": "integer", "minimum": 1 },
        "background": { "type": "string" }
      }
    },
    "pages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "widgets"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "widgets": {
            "type": "array",
            "items": { "$ref": "#/$defs/widget" }
          }
        }
      }
    }
  },
  "$defs": {
    "binding": {
      "type": "object",
      "required": ["target", "symbol"],
      "properties": {
        "target": { "enum": ["input", "output", "variable"] },
        "symbol": { "type": "string" },
        "expression": { "type": "string" }  // 2nd phase: 表示用変換式
      }
    },
    "base": {
      "type": "object",
      "required": ["id", "type", "x", "y", "width", "height"],
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number", "minimum": 4 },
        "height": { "type": "number", "minimum": 4 },
        "rotation": { "type": "number" },
        "zIndex": { "type": "integer" },
        "label": { "type": "string" }
      }
    },
    "widget": {
      "allOf": [
        { "$ref": "#/$defs/base" },
        {
          "oneOf": [
            { "$ref": "#/$defs/w_button" },
            { "$ref": "#/$defs/w_switch" },
            { "$ref": "#/$defs/w_slider" },
            { "$ref": "#/$defs/w_numeric" },
            { "$ref": "#/$defs/w_lamp" },
            { "$ref": "#/$defs/w_text" },
            { "$ref": "#/$defs/w_motor" },
            { "$ref": "#/$defs/w_cylinder" }
          ]
        }
      ]
    },

    "w_button": {
      "type": "object",
      "properties": {
        "type": { "const": "button" },
        "variant": { "enum": ["momentary", "toggle"] },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_switch": {
      "type": "object",
      "properties": {
        "type": { "const": "switch" },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_slider": {
      "type": "object",
      "properties": {
        "type": { "const": "slider" },
        "min": { "type": "number" },
        "max": { "type": "number" },
        "step": { "type": "number" },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_numeric": {
      "type": "object",
      "properties": {
        "type": { "const": "numeric" },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_lamp": {
      "type": "object",
      "properties": {
        "type": { "const": "lamp" },
        "style": {
          "type": "object",
          "properties": {
            "onColor": { "type": "string" },
            "offColor": { "type": "string" }
          }
        },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_text": {
      "type": "object",
      "properties": {
        "type": { "const": "text" },
        "text": { "type": "string" }
      }
    },
    "w_motor": {
      "type": "object",
      "properties": {
        "type": { "const": "motor" },
        "binding": { "$ref": "#/$defs/binding" }
      }
    },
    "w_cylinder": {
      "type": "object",
      "properties": {
        "type": { "const": "cylinder" },
        "binding": { "$ref": "#/$defs/binding" }
      }
    }
  }
}
```

### バインディングの整合性ルール（例）
- 入力系 → `target: "input" | "variable"`（boolean 推奨）
- 表示/アクチュエータ → `target: "output" | "variable"`
- デジタル/アナログ整合性
  - boolean ウィジェット（ボタン、ランプ等）は boolean のみ
  - 数値ウィジェット（スライダー、数値表示）は number へのバインド（MVP は内部変数のみ）
- 不整合はデザイナで警告表示（保存可/適宜自動補正案内）

## UI 仕様
- キャンバス
  - グリッド・スナップ、ドラッグ＆ドロップ、8 ハンドルでリサイズ
  - 複数選択、整列/整列解除、Z オーダー変更、コピー/貼り付け
- パレット
  - 入力、表示、アクチュエータ、コンテナで分類
- プロパティパネル
  - 共通: 位置/サイズ/ラベル/スタイル
  - 型別: 例) ボタンの `variant`、ランプの `on/offColor`、スライダーの `min/max/step`
  - バインディングエディタ: `target` と `symbol` の選択（補完: `IOSimService` と内部変数）
- ランタイム
  - 監視更新: `EmulatorController.onDidUpdateState` と `IOSimService.onDidChangeState`
  - 入力イベント: 押下/変更 → `IOSimService.setInputValue` or 変数書き込み

## 拡張への組み込み（contributes）
- commands
  - `plcEmu.openHmiDesigner`: HMI デザイナを開く
  - `plcEmu.openHmiRuntime`: HMI ランタイムを開く
- views（既存 `plcEmuSidebar` に追加）
  - `plcHmiDesigner`（WebviewView）name: "HMI"
  - または `HmiDesignerPanel`（WebviewPanel）を `plcPouExplorer`/`Runtime` のツールバーから起動
- menus/view/title（両ビューに）
  - HMI Designer / HMI Runtime 起動ボタンを追加

## メッセージプロトコル（抜粋）
- Webview → Extension
  - `requestLoad { fileUri? }`
  - `requestSave { fileUri?, hmi }`
  - `ioWrite { target, symbol, value }`
  - `subscribeRuntime {}` / `unsubscribeRuntime {}`
- Extension → Webview
  - `loaded { hmi }`
  - `saved { ok: boolean, error? }`
  - `ioState { inputs, outputs }`（`IOSimService.getState()`）
  - `runtimeState { variables }`（`EmulatorController.onDidUpdateState`）

## 実装ステップ（MVP）
1) モデル/スキーマ
- `HmiService` 追加（読み書き/検証/イベント）
- 既定パス `.plc/hmi.json` と設定 `plcEmu.hmiFile`

2) デザイナ Webview
- パレット/キャンバス/プロパティの最小 UI
- 追加/移動/リサイズ/削除/Undo-Redo（簡易でも可）
- 保存/読み込み、オートセーブ

3) ランタイム Webview
- 表示更新と入力イベントのブリッジ
- 値購読（IO と内部変数）

4) VS Code 統合
- `package.json` に commands/views/menus を追加
- `src/extension.ts` にコマンド登録と ViewProvider/Panel 管理

5) 整合性/UX
- バインディング整合性チェック
- 補完（`I0..`, `Q0..`, 既存変数）とラベル表示

6) 仕上げ/検証
- サンプル HMI を `examples/` に追加
- 動作確認（自動テストは型・モデル・サービス周りのみ）

## 将来拡張
- 複数ページ/タブ、ナビゲーションボタン
- アナログ計器、トレンド/履歴グラフ、アラームパネル
- 式/スケーリング（例: `value * 10`）と単位
- テーマ/スキン、SVG アセット読込
- グループ/ロック/スナップ高度化、ガイド/整列
- I18N、アクセシビリティ

---

## 進捗チェックリスト（MVP）
- [x] `HmiService`（読み書き・イベント）
- [ ] JSON Schema 定義とバンドル
- [x] `plcEmu.hmiFile` 設定追加
- [x] `plcEmu.openHmiDesigner` コマンド
- [x] `plcEmu.openHmiRuntime` コマンド
- [ ] サイドバーに HMI ビュー（WebviewView）追加（現状はパネル＋サイドバーのボタン起動）
- [x] Designer Webview: パレット/キャンバス/プロパティ
- [x] DnD 配置とリサイズ、グリッド/スナップ
- [x] バインディング編集 UI と簡易整合性チェック
- [x] Runtime Webview: 値購読/反映、入力送出
- [ ] IO/変数の補完（変数は未、IOは候補提示あり）
- [x] サンプル HMI JSON 追加（`examples/`）
- [ ] ドキュメント更新（README への導線）

## 参考（既存コードとの接続ポイント）
- エミュレータ状態購読: `src/runtime/emulator.ts:12` の `onDidUpdateState`
- IO 状態購読: `src/io/ioService.ts:18` の `onDidChangeState`
- サイドバーとビュー: `package.json:70` の `viewsContainers` / `views`
- 既存 Webview 実装例: `src/ladder/ladderPanel.ts:36` / `src/views/runtimeView.ts:25`
