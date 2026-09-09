# 汽車險理賠系統 — Table Schema 中英文對照表

版本：v2.0　　資料庫：Supabase PostgreSQL（沿用既有車險報價系統專案）
本文件反映目前資料庫的**實際最終結構**（含歷次 `ALTER TABLE` 增補後的結果）。

---

## 1. `claims`（立案主檔 Claim Master）

| 欄位名稱 (Column) | 中文說明 | 資料型別 (Type) | 備註 |
|---|---|---|---|
| `id` | 主鍵，系統自動編號 | `bigint` (identity, PK) | 不可手動指定數值 |
| `claim_no` | 立案編號 | `text`，唯一 | 格式 `yyyymmdd-001`，受理當下即寫入 |
| `report_time` | 通報時間 | `timestamptz` | 立案當下鎖定，之後儲存不覆蓋 |
| `plate_no` | 車號 | `text` | |
| `policy_valid` | 受理當下保單是否有效 | `boolean` | 紅綠燈判斷結果 |
| `quotation_no` | 保單／投保單號 | `text` | 連結車險系統，查詢用途 |
| `insured_name` | 被保險人姓名 | `text` | 投保快照，畫面唯讀 |
| `insured_gender` | 被保險人性別 | `text` | 投保快照，畫面唯讀 |
| `insured_phone` | 被保險人電話 | `text` | 投保快照，畫面唯讀 |
| `insured_id_number` | 被保險人身分證號 | `text` | 投保快照，畫面唯讀 |
| `insured_address` | 被保險人地址 | `text` | 投保快照，畫面唯讀 |
| `insured_email` | 被保險人 Email | `text` | 投保快照，畫面唯讀 |
| `vehicle_type` | 車種 | `text` | 投保快照，畫面唯讀 |
| `brand_series` | 廠牌車系 | `text` | 投保快照，畫面唯讀 |
| `policy_coverage_types` | 投保代號及險種 | `jsonb` | 例：`[{"code":"31","name":"第三人責任險(200萬/400萬)"}]` |
| `accident_time` | 事故時間 | `text` | 案件層級 |
| `accident_location` | 事故地點 | `text` | 案件層級 |
| `driver_name` | 駕駛人姓名 | `text` | 可手動填寫或用「同被保險人」帶入 |
| `driver_gender` | 駕駛人性別 | `text` | |
| `driver_phone` | 駕駛人電話 | `text` | |
| `driver_id_number` | 駕駛人身分證號 | `text` | |
| `reporter_phone` | 報案人電話 | `text` | 供簡訊/LINE通知使用 |
| `police_called` | 是否報警 | `boolean` | 案件層級 |
| `police_unit` | 警方處理單位 | `text` | 案件層級 |
| `complexity_tier` | 案件複雜度分流結果 | `text` | 值：`低複雜度` / `中複雜度` / `高複雜度` |
| `complexity_overridden` | 分流是否被人工覆蓋 | `boolean` | |
| `required_documents` | 應備文件清單與核對狀態 | `jsonb` | 例：`[{"name":"行照","checked":true}]` |
| `status` | 案件狀態 | `text` | 預設 `受理中`，保留供未來流程擴充 |
| `case_closed` | 是否已結案 | `boolean` | |
| `final_settlement_amount` | 決算金額 | `numeric` | 結案前必填 |
| `closed_at` | 結案時間 | `timestamptz` | |
| `payment_completed` | 是否已付款 | `boolean` | 狀態欄位，尚未串接實際付款動作 |
| `estimated_claim_amount` | 預估理賠金額 | `numeric` | 與決算金額為不同欄位 |
| `voided` | 是否已註銷 | `boolean` | 註銷不刪除資料，僅標記 |
| `voided_at` | 註銷時間 | `timestamptz` | |
| `updated_at` | 最後更新時間 | `timestamptz` | **樂觀鎖版本比對用**：儲存前會比對此欄位，不一致則擋下儲存 |
| `created_at` | 建立時間 | `timestamptz` | |

**索引與限制**：
- `idx_claims_plate_no`：`plate_no` 一般索引。
- `idx_claims_claim_no`：`claim_no` 一般索引。
- `idx_claims_plate_open`：`(plate_no, case_closed)` 複合索引。
- `idx_claims_one_open_per_plate`：**部分唯一索引**，條件 `case_closed = false and voided = false`，確保同一車號只能有一筆進行中案件（防止兩人同時受理同一台車）。

---

## 2. `claim_other_vehicles`（對方車及事故狀況 Other Vehicles）

| 欄位名稱 (Column) | 中文說明 | 資料型別 (Type) | 備註 |
|---|---|---|---|
| `id` | 主鍵 | `bigint` (identity, PK) | |
| `claim_id` | 對應的立案案件 | `bigint`，外鍵 → `claims.id` | `on delete cascade` |
| `other_plate_no` | 對方車牌 | `text` | |
| `other_driver_name` | 對方駕駛人姓名 | `text` | |
| `other_driver_gender` | 對方駕駛人性別 | `text` | |
| `other_driver_phone` | 對方駕駛人電話 | `text` | |
| `injury_flag` | 是否有人員受傷 | `boolean` | 影響案件分流規則 |
| `hospitalized_flag` | 是否有人員送醫 | `boolean` | |
| ~~`police_called_flag`~~ | ~~是否報警~~ | `boolean` | **⚠️ 已棄用**：改記錄於 `claims.police_called`，欄位保留但不再寫入新資料 |
| ~~`police_unit`~~ | ~~警方單位~~ | `text` | **⚠️ 已棄用**：改記錄於 `claims.police_unit` |
| `towed_flag` | 車輛是否拖吊 | `boolean` | |
| `own_vehicle_repair_flag` | 本車是否需維修 | `boolean` | |
| `own_vehicle_drivable_flag` | 本車是否可行駛 | `boolean` | |
| `created_at` | 建立時間 | `timestamptz` | |

**索引**：`idx_claim_other_vehicles_claim_id`（`claim_id`）。

**前端層級的補充狀態（不寫入資料庫）**：`seq`（顯示編號，依畫面現有資料動態計算，非外部計數器）、`visible`（是否顯示中，用於暫時隱藏功能）。

---

## 3. `claim_documents`（上傳文件明細 Uploaded Documents）

| 欄位名稱 (Column) | 中文說明 | 資料型別 (Type) | 備註 |
|---|---|---|---|
| `id` | 主鍵 | `bigint` (identity, PK) | |
| `claim_id` | 對應的立案案件 | `bigint`，外鍵 → `claims.id` | `on delete cascade` |
| `document_category` | 文件分類 | `text` | 值：`accident_evidence`（事故處理文件）／`repair_estimate`（估價文件） |
| `file_name` | 檔案名稱 | `text` | |
| `file_url` | 檔案網址 | `text`，**可為空值** | ⚠️ 舊欄位，v2.0後不再作為主要內容來源，一律為 `null`；歷史資料若只有此欄位仍可退回顯示 |
| `file_data` | **檔案實際內容** | `text` | **v2.0新增**：base64編碼的完整檔案內容（含data URL前綴），圖片會先壓縮（最長邊≤1600px、JPEG）。這是目前主要的內容來源欄位 |
| `file_type` | 檔案類型 | `text` | 例：`image/jpeg`、`video/webm`；手機環境有時無法取得正確MIME類型，前端會用副檔名輔助判斷 |
| `ai_recognition_result` | AI辨識結果 | `jsonb` | 介面已預留，功能尚未串接前恆為 `null` |
| `ai_recognized_at` | AI辨識時間 | `timestamptz` | 同上，尚未使用 |
| `uploaded_at` | 上傳時間 | `timestamptz` | |

**索引**：`idx_claim_documents_claim_id`（`claim_id`）、`idx_claim_documents_category`（`document_category`）。

**業務規則**：
- 上傳來源包含：一般檔案選擇器（拖拉/選檔案）、即拍即傳（自製相機拍照）、AI引導事故現場處理（8步驟相機，含錄影）、客戶自助遠端拍照連結。四種來源最終都走同一套存檔邏輯，行為一致。
- 影片上限錄製15秒，避免base64編碼後檔案過大導致上傳失敗。
- 刪除文件為**真實刪除**（`delete` 該筆資料列），非邏輯刪除，二次確認後執行，不佔用儲存空間。

---

## 4. `claim_signatures`（線上簽署紀錄 Signatures）

| 欄位名稱 (Column) | 中文說明 | 資料型別 (Type) | 備註 |
|---|---|---|---|
| `id` | 主鍵 | `bigint` (identity, PK) | |
| `claim_id` | 對應的立案案件 | `bigint`，外鍵 → `claims.id` | `on delete cascade` |
| `document_type` | 文件類型 | `text` | 值：`理賠申請書` / `和解書` |
| `otp_verified` | 簽署前是否完成OTP驗證 | `boolean` | |
| `otp_verified_at` | OTP驗證時間 | `timestamptz` | |
| `signature_image` | 簽名圖檔 | `text` | Base64格式的圖片資料，已修正手機觸點偏移問題後產生的簽名 |
| `signed_at` | 簽署完成時間 | `timestamptz` | |
| `created_at` | 建立時間 | `timestamptz` | |

**索引**：`idx_claim_signatures_claim_id`（`claim_id`）。

**業務規則**：同一 `claim_id` + `document_type` 若已存在一筆紀錄，即視為「已簽署」，前端會直接阻擋重複簽署（不會產生第二筆紀錄，也不再詢問是否要重簽）。內部簽署與客戶遠端簽署（`?signClaimId=&signDocType=`）共用同一張表與同一套判斷邏輯。

---

## 附錄：與既有車險系統的資料關聯

理賠系統**不建立獨立的保單資料表**，而是直接查詢既有車險報價系統資料庫中的 `quote_full_records` 資料表，僅在立案當下擷取一份快照寫入 `claims` 的對應欄位，且**優先擷取 `payment_status = 已出單` 的紀錄**（而非單純取最新一筆）。兩個系統共用同一個 Supabase 專案，但邏輯上是各自獨立的資料表，不互相修改。
