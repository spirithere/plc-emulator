# IO マッピングと IEC 準拠強化 作業計画 (2025-11-20)

進行はチェックボックスで管理します。完了したら `[x]` に更新します。

- [x] 1. 仕様整理と設計  
  - IEC61131-3 / PLCopen TC6 (Codesys エクスポート基準) の変数・I/O・タスク構造を再確認し、必要な拡張点を決める。  
  - OPC UA 連携を見据えたメタデータ（NodeId 等）の持ち方を決定。
- [x] 2. データモデル拡張  
  - `PLCProjectModel` に構成/リソース/タスク/グローバル変数/IOマッピング/OPC UA 拡張メタを追加。  
  - 既存モデルとの後方互換の落とし込み方針を固める。
- [x] 3. PLCopen XML 読み書き強化  
  - `PLCopenService` のパーサ/シリアライザを IEC 近似の配置（types/pous + instances/configurations/resources/...）で入出力できるよう拡張。  
  - 変数の `address` / `initialValue` / `constant` / `retain` / `persistent` / `documentation` / ベンダ拡張属性を保持。
- [x] 4. ST 変数定義・型サポート拡充  
  - ST パーサに `VAR_GLOBAL`/`VAR_EXTERNAL`/`VAR_TEMP`/`VAR_RETAIN` 等のキーワード、`AT %IX...` アドレス指定、定数/保持指定を追加。  
  - ランタイムで初期化・型強制・IO/OPC UA マッピングへ反映。
- [x] 5. IO シミュレータ & ラダー実行のマッピング統合  
  - グローバル変数の I/O アドレスとラダー要素のアドレスから入出力チャネルを生成・同期。  
  - OPC UA メタ（NodeId）を保持する拡張ポイントを用意。
- [x] 6. サンプル/テスト更新  
  - 例示 XML を IEC 仕様寄りに全面更新（Config/Task/Program/GlobalVars/IO アドレス）。  
  - 単体テストを新構造に合わせて修正し、必要なら追加。

メモ: 実装完了後、このファイルのチェックを更新し、差分に残します。
