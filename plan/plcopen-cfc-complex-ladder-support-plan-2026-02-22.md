# PLCopen CFC/複雑LD 完全ロード対応 計画

作成日: 2026-02-22  
対象: `/Users/spirithere/Projects/vibe/plc-emu`  
対象サンプル: `/Users/spirithere/Projects/vibe/plc-emu/examples/refrigerator-control/refrigerator-control.xml`

## 1. 目的

`refrigerator-control.xml` を「部分表示や欠落なく」開ける状態を実現する。  
具体的には CFC（`PLC_PRG`）と複雑LD（`Signals`）を含む POUs を正しく読み込み、表示し、必要に応じて実行可能にする。

## 2. 完了条件（Definition of Done）

以下をすべて満たした時点を「完全に開ける」と定義する。

1. プロジェクトオープン時にデフォルト POU (`MainProgram`) へフォールバックしない。
2. POU 一覧に `PLC_PRG` / `Signals` / `Simulation` が表示される。
3. `PLC_PRG` は CFC 構造（ノード・接続）として閲覧可能。
4. `Signals` は LD の全構成要素（contact/coil/block/inVariable/jump/label 等）を欠落なく閲覧可能。
5. 未対応要素が残る場合は、静かに欠落せず、要素名付き診断を表示する。
6. 保存時に入力XMLの CFC/LD 情報を破壊しない（少なくとも未編集部分はロスレス）。
7. 回帰テストで当該 fixture が常時通過する。

## 3. 現状ギャップ

1. 型表現が不足している  
   - `src/types.ts` は ST と単純 `LadderRung` 中心で、CFC グラフや高度LD要素を保持できない。
2. パーサが簡略化されている  
   - `src/services/plcopenService.ts` は LD を `contact/coil/parallel` へ射影しており、`block/inVariable/jump/label` を落とす。
   - CFC は `addData` 内構造を実質未解釈。
3. エディタが単純LD前提  
   - `media/ladder/main.js` はシンプルな接点/コイルUIで、グラフ系要素を表現できない。
4. 実行エンジンが単純LD前提  
   - `src/runtime/runtimeCore.ts` は接点/コイル列+分岐実行モデルで、FB呼び出し付きLD/CFCを扱えない。
5. 直列化がロッシー  
   - `serializeModel()` は単純化した `types.pous.pou` を再生成するため、元XML詳細を失う可能性が高い。

## 4. 方針

1. 読み込みの忠実性（lossless import）を最優先で確立する。
2. 表示（閲覧）と実行（セマンティクス）を分離し、段階的に拡張する。
3. 未対応を隠蔽しない。診断をUI/APIへ必ず露出する。
4. 保存は「未編集領域を保持するマージ戦略」を採用し、先にデータ破壊を止める。

## 5. 実装フェーズ

## フェーズ0: 要件固定と受け入れテスト雛形

目的: ブレない受け入れ基準を先に固定する。

1. `refrigerator-control.xml` 用の期待値を文書化  
   - POU名、タスク、プログラムインスタンス数、CFC/LD要素数（最小）を固定。
2. 受け入れテスト追加（最初は `todo`/`skip` 可）
   - 「完全ロード時に満たすべき検証」をテストケースとして先置き。

成果物:
- `/Users/spirithere/Projects/vibe/plc-emu/test/codesysSamples.test.ts` 拡張
- `/Users/spirithere/Projects/vibe/plc-emu/docs/` または `/plan` に受け入れ定義追記

## フェーズ1: ドメインモデル拡張（CFC/高度LD保持）

目的: 失わず保持できる内部モデルを導入する。

1. `src/types.ts` を拡張
   - `PouBodyKind`（`ST`/`LD`/`CFC`/`Mixed`）
   - `GraphNode` / `GraphEdge` / `GraphProgram`（CFC/LD共通）
   - `PouDiagnostics`（`severity`, `code`, `message`, `path`）
   - 既存 `StructuredTextBlock` 互換フィールドは維持（段階移行）
2. 既存利用箇所を最小破壊で更新
   - `POUTree`, runtime連携、MCP出力の型互換レイヤを追加。

注意:
- ここでは実行は実装しない。保持・受け渡しの整備まで。

## フェーズ2: PLCopen パーサの忠実化

目的: CFC/複雑LDを欠落なく抽出する。

1. CFC抽出器実装（`plcopenService.ts`）
   - `body.addData.data[name*=cfc]` の `CFC` ノードを解析。
   - `inVariable/outVariable/block/connector` と接続情報をグラフ化。
2. 複雑LD抽出器実装
   - `LD` 直下および `network` 配下を統一抽出。
   - `contact/coil/block/inVariable/jump/label/comment/vendorElement/rails` をノード化。
3. 診断生成
   - 未知タグを `PouDiagnostics` として保持。
   - 既存の「throwで停止」モードは設定で切替可能にする（strict/lenient）。
4. プログラム/タスク束縛の精度向上
   - `pouInstance typeName=""` など空値補完を継続し、名前解決を安定化。

成果物:
- `/Users/spirithere/Projects/vibe/plc-emu/src/services/plcopenService.ts`
- 新規補助モジュール例: `src/services/plcopen/cfcParser.ts`, `src/services/plcopen/ldParser.ts`

## フェーズ3: 表示対応（完全閲覧）

目的: 「開いたら内容が見える」を実現する。

1. POUツリー表示の拡張
   - POUごとに `ST/LD/CFC/Mixed` バッジ表示。
   - 診断件数と重大度を表示。
2. CFC/LDグラフビューア追加（読み取り中心）
   - 既存 `LadderPanel` を拡張するか、新規 `GraphPanel` を追加。
   - ノード接続を可視化し、要素属性（instanceName/formalParameter等）をカード表示。
3. 既存の単純LD編集画面との共存
   - 単純LDは従来エディタで編集可。
   - 複雑LD/CFCは当面 read-only（誤編集防止）。

成果物:
- `/Users/spirithere/Projects/vibe/plc-emu/src/views/pouTree.ts`
- `/Users/spirithere/Projects/vibe/plc-emu/src/ladder/ladderPanel.ts` または新規 `src/views/graphView.ts`
- `/Users/spirithere/Projects/vibe/plc-emu/media/ladder/main.js`（または新規 `media/graph/*`）

## フェーズ4: 保存ロスレス化（ラウンドトリップ保証）

目的: 開いて保存しても CFC/複雑LD が壊れないようにする。

1. AST保持戦略の導入
   - 読み込み時に元ASTを保持し、編集対象のみ差分更新。
2. マージシリアライザ実装
   - ST編集時は該当POUだけ更新し、他POUの `addData/CFC/LD詳細` を保持。
3. 検証
   - fixtureを load→save→load して要素数・主要属性が維持されることを確認。

成果物:
- `/Users/spirithere/Projects/vibe/plc-emu/src/services/plcopenService.ts`（serialize系再設計）
- 必要に応じて `src/services/plcopen/astMerge.ts`

## フェーズ5: 実行対応（CFC/複雑LD）

目的: 表示だけでなくランタイム実行を可能にする。

1. 実行IRの定義
   - CFC/LD共通の実行グラフIR（ノード評価順、接続伝播、FB呼び出し）
2. `runtimeCore` 拡張
   - 現行 `executeRung` に加え、グラフ実行器を導入。
3. FB/標準関数呼び出しの連携
   - 既存ST Runtime の FB実行能力を再利用し、グラフノードから呼ぶ。
4. 検証
   - `refrigerator-control` の主要シナリオ（Compressor/Signal/Lamp）を再現する統合テスト。

成果物:
- `/Users/spirithere/Projects/vibe/plc-emu/src/runtime/runtimeCore.ts`
- 新規モジュール例: `src/runtime/graph/graphExecutor.ts`

## フェーズ6: API/MCP整合・運用仕上げ

目的: 既存APIでも新構造を扱えるようにする。

1. Runtime/MCP APIの拡張
   - `project.load` が新POU構造を受け取れるよう schema 更新。
2. 診断公開
   - MCP/REST で `project.diagnostics` を返せるようにする。
3. ドキュメント更新
   - 対応言語（ST/LD/CFC）と制約、編集可否、互換性を明記。

## 6. テスト戦略

## 6.1 単体テスト

1. CFC抽出器: ノード数・エッジ数・主要属性検証
2. 複雑LD抽出器: `block/jump/label/inVariable` の抽出検証
3. 診断: 未知ノード検出とメッセージ整形

## 6.2 統合テスト

1. `refrigerator-control.xml` load 成功
2. POUツリーに 3 POU が出る
3. CFC/LDビューのJSONモデルが期待キーを持つ
4. load→save→load で情報欠落しない

## 6.3 回帰テスト

1. 既存 `simple-latch` / CODESYS最小fixtureが破壊されない
2. `npm run verify` 常時通過

## 7. エラーハンドリング仕様

1. strict モード（CI向け）
   - 未対応要素があればロード失敗 + 詳細エラー
2. lenient モード（通常利用向け）
   - ロード継続 + 診断表示 + 該当POUを read-only 化
3. UI表示
   - 「何が未対応か」「どのPOUか」「代替操作（閲覧のみ）」を明示

## 8. リスクと対策

1. リスク: モデル拡張で既存機能が広範囲に影響  
   対策: 互換アダプタを用意し、`LadderRung`/`StructuredTextBlock` APIを段階廃止
2. リスク: 保存ロスレス化が複雑  
   対策: 先に read-only 方針で破壊的保存を止め、ASTマージは独立実装
3. リスク: 実行セマンティクス差異（CODESYS依存）  
   対策: まず主要FB（TON/SR/BLINK/比較演算）に範囲限定し、診断で未対応を明示

## 9. 実施順（推奨）

1. フェーズ0（受け入れ固定）
2. フェーズ1（型）
3. フェーズ2（抽出）
4. フェーズ3（表示）
5. フェーズ4（ロスレス保存）
6. フェーズ5（実行）
7. フェーズ6（API/ドキュメント）

## 10. 当面の最短マイルストーン

「まず完全に開ける」を最短で達成するため、次の3点を先行実装する。

1. CFC/複雑LDを保持するモデル拡張（実行なし）
2. CFC/複雑LDの read-only ビュー実装
3. ロスレス保存（未編集領域保持）

この3点完了時点で、ユーザーは `refrigerator-control.xml` を欠落なく閲覧でき、保存しても壊れない。

