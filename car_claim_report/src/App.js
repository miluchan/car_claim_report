import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ⚡ 沿用舊報價系統的 Supabase 專案（該專案已規劃轉型為理賠系統資料庫）
const SUPABASE_URL = "https://smrywtpsfrybqslypttj.supabase.co";
const SUPABASE_KEY = "sb_publishable_X_T4spfQy204iLHFgjd7NA_d4yQ-3Bz";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const REQUIRED_DOC_OPTIONS = ["行照", "駕照", "理賠申請書", "和解書", "估價單", "診斷證明", "醫療費用單據"];

function getTodayMinguo() {
  const d = new Date();
  const y = d.getFullYear() - 1911;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function getTodayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function getNowHms() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}`;
}

export default function App() {
  // ================================================================
  // 主畫面：車號查詢／受理紅綠燈／立案編號／通報時間
  // ================================================================
  const [plateNo, setPlateNo] = useState("");
  const [policyLookupLoading, setPolicyLookupLoading] = useState(false);
  const [policyRecord, setPolicyRecord] = useState(null);
  const [policyValid, setPolicyValid] = useState(null); // null=尚未查詢, true=綠燈, false=紅燈
  const [claimNo, setClaimNo] = useState("");
  const [reportTime, setReportTime] = useState("");
  const [reportTimeIso, setReportTimeIso] = useState(""); // 通報當下的完整時間戳，寫入DB用，儲存立案資料時不會被覆蓋
  const [claimId, setClaimId] = useState(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  const loadExistingClaim = async (row) => {
    setClaimId(row.id);
    setClaimNo(row.claim_no);
    setReportTime(row.report_time ? new Date(row.report_time).toLocaleTimeString("zh-TW", { hour12: false }) : getNowHms());
    setReportTimeIso(row.report_time || "");
    setQuotationNo(row.quotation_no || "");
    setInsuredName(row.insured_name || "");
    setInsuredGender(row.insured_gender || "");
    setInsuredPhone(row.insured_phone || "");
    setInsuredIdNumber(row.insured_id_number || "");
    setInsuredAddress(row.insured_address || "");
    setInsuredEmail(row.insured_email || "");
    setVehicleType(row.vehicle_type || "");
    setBrandSeries(row.brand_series || "");
    setPolicyCoverageTypes(Array.isArray(row.policy_coverage_types) ? row.policy_coverage_types : []);
    setDriverName(row.driver_name || "");
    setDriverGender(row.driver_gender || "");
    setDriverPhone(row.driver_phone || "");
    setDriverIdNumber(row.driver_id_number || "");
    setReporterPhone(row.reporter_phone || "");
    setAccidentTime(row.accident_time || "");
    setAccidentLocation(row.accident_location || "");
    setPoliceCalled(!!row.police_called);
    setPoliceUnit(row.police_unit || "");
    setComplexityTier(row.complexity_tier || null);
    setComplexityOverridden(!!row.complexity_overridden);
    setEstimatedClaimAmount(row.estimated_claim_amount != null ? String(row.estimated_claim_amount) : "");
    setFinalSettlementAmount(row.final_settlement_amount != null ? String(row.final_settlement_amount) : "");
    setCaseClosed(!!row.case_closed);
    setPaymentCompleted(!!row.payment_completed);

    const selection = Array.isArray(row.required_documents) ? row.required_documents.map((d) => d.name) : [];
    setRequiredDocSelection(selection);
    const checks = {};
    (row.required_documents || []).forEach((d) => {
      checks[d.name] = !!d.checked;
    });
    setRequiredDocChecks(checks);

    // 對方車明細（依原有順序重新編號，全部視為顯示中）
    const { data: ovRows } = await supabaseClient.from("claim_other_vehicles").select("*").eq("claim_id", row.id);
    if (ovRows && ovRows.length > 0) {
      setOtherVehicles(
        ovRows.map((r, idx) => ({
          seq: idx + 1,
          visible: true,
          otherPlateNo: r.other_plate_no || "",
          otherDriverName: r.other_driver_name || "",
          otherDriverGender: r.other_driver_gender || "",
          otherDriverPhone: r.other_driver_phone || "",
          injuryFlag: !!r.injury_flag,
          hospitalizedFlag: !!r.hospitalized_flag,
          towedFlag: !!r.towed_flag,
          ownVehicleRepairFlag: !!r.own_vehicle_repair_flag,
          ownVehicleDrivableFlag: !!r.own_vehicle_drivable_flag,
        }))
      );
    } else {
      setOtherVehicles([emptyOtherVehicle(1)]);
    }
    setHiddenSeqStack([]);

    // 帶回先前已上傳的文件紀錄
    const { data: docRows } = await supabaseClient.from("claim_documents").select("*").eq("claim_id", row.id);
    const mapDoc = (r) => ({
      id: r.id,
      fileName: r.file_name,
      fileUrl: r.file_url,
      fileType: r.file_type,
      category: r.document_category,
      uploadedAt: r.uploaded_at,
    });
    setAccidentDocuments((docRows || []).filter((r) => r.document_category === "accident_evidence").map(mapDoc));
    setRepairDocuments((docRows || []).filter((r) => r.document_category === "repair_estimate").map(mapDoc));

    await refreshSignStatus(row.id);
    alert("ℹ️ 此車號有一筆進行中的案件（" + row.claim_no + "），已為您帶出目前進度繼續處理。");
  };

  // 2. 立案編號改成「直接寫進資料庫」來搶號，不是只在畫面上算一個數字放著——
  // 這樣才能真正避免「兩人同時受理，算出來的號碼一樣，後面存檔就會撞號失敗」的問題。
  // 如果寫入時發現號碼被別人搶先用掉（唯一性衝突），就自動往下一號重試。
  const createClaimStub = async (basePayload) => {
    const ymd = getTodayYmd();
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: todayClaims } = await supabaseClient
        .from("claims")
        .select("claim_no")
        .like("claim_no", `${ymd}-%`);
      const seq = (todayClaims || []).length + 1 + attempt;
      const candidateNo = `${ymd}-${String(seq).padStart(3, "0")}`;
      const { data, error } = await supabaseClient
        .from("claims")
        .insert([{ ...basePayload, claim_no: candidateNo }])
        .select()
        .single();
      if (!error) {
        return { data, claimNo: candidateNo };
      }
      lastError = error;
      // 23505 = Postgres的唯一性衝突錯誤代碼，代表號碼被搶走了，換下一號重試；其他錯誤直接中止不要一直重試
      if (error.code !== "23505") {
        throw error;
      }
    }
    throw lastError || new Error("多次嘗試仍無法產生唯一立案編號，請稍後再試。");
  };

  const lookupPolicy = async () => {
    if (!plateNo.trim()) {
      alert("⚠️ 請輸入車號");
      return;
    }
    setPolicyLookupLoading(true);
    setPolicyRecord(null);
    setPolicyValid(null);
    // 4. 不管這次查詢結果通不通過，先把上一筆殘留的畫面清空，避免混淆
    resetClaimFieldsKeepPlate();

    try {
      // 3. 找「已出單」的那一筆，而不是單純抓最新一筆——避免抓到未出單、或已作廢／被新紀錄取代的舊資料
      const { data: allRecords, error } = await supabaseClient
        .from("quote_full_records")
        .select("*")
        .eq("plate_no", plateNo.trim())
        .order("id", { ascending: false });

      if (error || !allRecords || allRecords.length === 0) {
        setPolicyValid(false);
        alert("⚠️ 查無此車號的投保紀錄，無法確認保單狀態。");
        setPolicyLookupLoading(false);
        return;
      }

      const issuedRecord = allRecords.find((r) => r.payment_status === "已出單");
      const data = issuedRecord || allRecords[0]; // 找不到已出單的，仍抓最新一筆只是為了判斷/提示原因，不會真的放行

      const today = parseInt(getTodayMinguo(), 10);
      const cStart = parseInt(data.compulsory_start_date || "0", 10);
      const cEnd = parseInt(data.compulsory_end_date || "0", 10);
      const aStart = parseInt(data.arbitrary_start_date || "0", 10);
      const aEnd = parseInt(data.arbitrary_end_date || "0", 10);
      const inCompulsory = today >= cStart && today <= cEnd;
      const inArbitrary = aStart && aEnd ? today >= aStart && today <= aEnd : true;
      const isIssued = data.payment_status === "已出單";
      const valid = inCompulsory && inArbitrary && isIssued;
      setPolicyValid(valid);

      if (!valid) {
        // 1. 沒通過受理就整個停在這裡：不設定 policyRecord，投保內容按鈕就不會有資料可以帶出來
        setPolicyRecord(null);
        if (!isIssued) {
          alert("⚠️ 此保單尚未完成線上出單繳費，依規定無法受理報案。");
        } else {
          alert("⚠️ 此保單不在有效保險期間內，無法受理報案。");
        }
        setPolicyLookupLoading(false);
        return;
      }

      setPolicyRecord(data);

      // 🔁 先查這台車有沒有尚未結案的案件：有→帶出目前進度繼續處理；沒有→視為全新報案
      const { data: openClaims } = await supabaseClient
        .from("claims")
        .select("*")
        .eq("plate_no", plateNo.trim())
        .eq("case_closed", false)
        .order("id", { ascending: false })
        .limit(1);

      if (openClaims && openClaims.length > 0) {
        await loadExistingClaim(openClaims[0]);
        setPolicyLookupLoading(false);
        return;
      }

      // 6. 立案當下就直接把案件寫進資料庫（不是等按「儲存立案資料」才存），
      // 這樣接下來上傳文件／AI引導拍照才有 claimId 可以用，不用被擋著要求先儲存
      const nowIso = new Date().toISOString();
      const coverageTypes = Array.isArray(data.coverage_items) ? data.coverage_items : [];
      const stub = await createClaimStub({
        plate_no: plateNo.trim(),
        policy_valid: true,
        quotation_no: data.quotation_no || "",
        insured_name: data.client_name || "",
        insured_gender: data.gender || "",
        insured_phone: data.phone || "",
        insured_id_number: data.id_number || "",
        insured_address: data.client_address || "",
        insured_email: data.client_email || "",
        vehicle_type: data.vehicle_type_display || "",
        brand_series: data.brand_series || "",
        policy_coverage_types: coverageTypes,
        report_time: nowIso,
      });

      setClaimId(stub.data.id);
      setClaimNo(stub.claimNo);
      setReportTime(getNowHms());
      setReportTimeIso(nowIso); // 寫入資料庫用，儲存立案資料時不會被後續的按「儲存」動作覆蓋

      // 被保險人／車籍資料快照帶入
      setInsuredName(data.client_name || "");
      setInsuredGender(data.gender || "");
      setInsuredPhone(data.phone || "");
      setInsuredIdNumber(data.id_number || "");
      setInsuredAddress(data.client_address || "");
      setVehicleType(data.vehicle_type_display || "");
      setBrandSeries(data.brand_series || "");
      setQuotationNo(data.quotation_no || "");
      setInsuredEmail(data.client_email || "");
      setPolicyCoverageTypes(coverageTypes);
    } catch (e) {
      setPolicyValid(false);
      alert("⚠️ 查詢過程發生錯誤，請稍後再試。" + (e && e.message ? "（" + e.message + "）" : ""));
    }
    setPolicyLookupLoading(false);
  };

  // ================================================================
  // 1. 被保險人區塊
  // ================================================================
  const [insuredName, setInsuredName] = useState("");
  const [insuredGender, setInsuredGender] = useState("");
  const [insuredPhone, setInsuredPhone] = useState("");
  const [insuredIdNumber, setInsuredIdNumber] = useState("");
  const [insuredAddress, setInsuredAddress] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [brandSeries, setBrandSeries] = useState("");
  const [quotationNo, setQuotationNo] = useState("");
  const [insuredEmail, setInsuredEmail] = useState("");
  const [policyCoverageTypes, setPolicyCoverageTypes] = useState([]); // 投保代號及險種

  // ================================================================
  // 2. 駕駛人區塊
  // ================================================================
  const [driverName, setDriverName] = useState("");
  const [driverGender, setDriverGender] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverIdNumber, setDriverIdNumber] = useState("");

  // ================================================================
  // 3. 對方車及事故狀況區塊（一案多筆）
  // ================================================================
  // 9. seq不能再用一個外部ref邊算邊加——因為 useState(初始值) 這種寫法在React渲染時可能被呼叫不只一次
  // （尤其StrictMode下開發環境會重複執行一次來抓bug），導致ref被多加好幾次、編號跳號不規則。
  // 改成：seq永遠是「目前陣列裡最大的seq + 1」，單純從現有資料算出來，不依賴任何外部可變狀態。
  const emptyOtherVehicle = (seq) => ({
    seq,
    visible: true,
    otherPlateNo: "",
    otherDriverName: "",
    otherDriverGender: "",
    otherDriverPhone: "",
    injuryFlag: false,
    hospitalizedFlag: false,
    towedFlag: false,
    ownVehicleRepairFlag: false,
    ownVehicleDrivableFlag: false,
  });
  const [otherVehicles, setOtherVehicles] = useState(() => [emptyOtherVehicle(1)]);
  const [hiddenSeqStack, setHiddenSeqStack] = useState([]); // 記錄隱藏順序（後進先出），新增時依序打開
  const [accidentTime, setAccidentTime] = useState("");
  const [accidentLocation, setAccidentLocation] = useState("");
  const [policeCalled, setPoliceCalled] = useState(false); // 7. 警方處理改為案件層級，不分對方車
  const [policeUnit, setPoliceUnit] = useState("");
  const [reporterPhone, setReporterPhone] = useState(""); // 6. 報案人電話

  // 依 seq（固定編號）更新／隱藏，不是依畫面顯示的index，避免隱藏後編號跟資料對不起來
  const updateOtherVehicle = (seq, field, value) => {
    setOtherVehicles((prev) => prev.map((v) => (v.seq === seq ? { ...v, [field]: value } : v)));
  };

  // 打X = 暫時隱藏，不是刪除資料
  const removeOtherVehicle = (seq) => {
    setOtherVehicles((prev) => prev.map((v) => (v.seq === seq ? { ...v, visible: false } : v)));
    setHiddenSeqStack((prev) => [...prev, seq]);
  };

  // 新增 = 優先依「後進先出」打開先前被隱藏的對方車；沒有隱藏的才建立全新一筆
  const addOtherVehicle = () => {
    if (hiddenSeqStack.length > 0) {
      const restoreSeq = hiddenSeqStack[hiddenSeqStack.length - 1];
      setOtherVehicles((prev) => prev.map((v) => (v.seq === restoreSeq ? { ...v, visible: true } : v)));
      setHiddenSeqStack((prev) => prev.slice(0, -1));
    } else {
      setOtherVehicles((prev) => {
        const maxSeq = prev.reduce((m, v) => Math.max(m, v.seq), 0);
        return [...prev, emptyOtherVehicle(maxSeq + 1)];
      });
    }
  };

  // 8. 真的刪除（跟打X暫時隱藏不同），刪除前再次確認
  const deleteOtherVehiclePermanently = (seq) => {
    const confirmed = window.confirm("確定要刪除這筆對方車資料嗎？此動作無法復原。");
    if (!confirmed) return;
    setOtherVehicles((prev) => prev.filter((v) => v.seq !== seq));
    setHiddenSeqStack((prev) => prev.filter((s) => s !== seq));
  };

  // ================================================================
  // 4. 事故處理區塊（文件上傳／調閱／AI辨識）
  // ================================================================
  const [accidentDocuments, setAccidentDocuments] = useState([]);
  const [showAccidentInfoModal, setShowAccidentInfoModal] = useState(false);

  // 🤖 AI引導事故現場處理：先走過拍攝順序（附圖第2點），再提醒可上傳的檔案類型（附圖第1點）
  const AI_GUIDE_SCENE_STEPS = ["事故全景", "碰撞位置", "本車受損", "對方車輛", "對方車牌", "行照／駕照", "道路相關標線／號誌", "其他證據"];
  const [showAiGuideModal, setShowAiGuideModal] = useState(false);
  const [aiGuideStep, setAiGuideStep] = useState(0); // 0 ~ length-1 為拍攝步驟，length 為最後的檔案類型提醒畫面
  const [aiGuideStepPhotoCount, setAiGuideStepPhotoCount] = useState(0); // 5. 這個步驟目前已拍幾張
  const openAiGuide = () => {
    setAiGuideStep(0);
    setAiGuideStepPhotoCount(0);
    setShowAiGuideModal(true);
  };
  const aiGuideNext = () => {
    setAiGuideStep((s) => Math.min(s + 1, AI_GUIDE_SCENE_STEPS.length));
    setAiGuideStepPhotoCount(0);
  };
  const aiGuidePrev = () => {
    setAiGuideStep((s) => Math.max(s - 1, 0));
    setAiGuideStepPhotoCount(0);
  };
  // 5. 點框直接開相機拍照，可連續拍多張，直到按下一步才往下走
  const handleAiGuideCapture = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await handleUploadDocument(files[i], "accident_evidence", setAccidentDocuments);
    }
    setAiGuideStepPhotoCount((c) => c + files.length);
    e.target.value = "";
  };

  // 6. 報案人電話 ＋ 簡訊通知（連結帶到customer自助拍照畫面，跟AI引導處理一樣）
  // 7. 比照當初投保系統的做法：不是串真的簡訊/LINE API（那需要另外申請金流/簡訊商帳號，屬於新的整合決策），
  // 而是直接開啟手機本身的簡訊App／LINE，訊息內容都幫你打好，你只要按下「傳送」就好，等於少打字的捷徑，
  // 不是全自動不用手動送出的真簡訊——如果要做到完全自動發送、不用人手動按送出，需要另外申請簡訊閘道商帳號，
  // 這個之後要不要一起處理，可以再討論。
  const buildGuideMessage = () => {
    const url = `${window.location.origin}${window.location.pathname}?guideClaimId=${claimId}`;
    return `【理賠協助】請點選下方連結，依指示完成事故現場拍照：\n${url}`;
  };
  const sendGuideSms = () => {
    if (!reporterPhone.trim()) {
      alert("⚠️ 請先輸入報案人電話");
      return;
    }
    if (!claimId) {
      alert("⚠️ 請先按下方「儲存立案資料」建立案件，才能產生連結。");
      return;
    }
    const message = buildGuideMessage();
    // sms: 這個網址格式會直接打開手機預設簡訊App，收件人跟內容都先幫你填好
    window.location.href = `sms:${reporterPhone}?body=${encodeURIComponent(message)}`;
  };
  const sendGuideLine = () => {
    if (!claimId) {
      alert("⚠️ 請先按下方「儲存立案資料」建立案件，才能產生連結。");
      return;
    }
    const message = buildGuideMessage();
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(message)}`, "_blank");
  };

  const [showAccidentUploadModal, setShowAccidentUploadModal] = useState(false);
  const [showAccidentViewModal, setShowAccidentViewModal] = useState(false);
  const [showAccidentAiModal, setShowAccidentAiModal] = useState(false);
  const [isDraggingAccidentFile, setIsDraggingAccidentFile] = useState(false);
  const [aiPickedAccidentDoc, setAiPickedAccidentDoc] = useState(null);

  const handleUploadDocument = async (file, category, setList) => {
    if (!file) return;
    if (!claimId) {
      alert("⚠️ 請先按下方「儲存立案資料」建立案件，才能上傳文件。");
      return;
    }
    // 🧪 檔案本體先用本地暫存網址模擬（之後接 Supabase Storage 時，這裡改成真的上傳並取得正式file_url），
    // 但檔案的「紀錄」（誰上傳了什麼檔案）10. 現在會確實寫進 claim_documents，不再只是停留在畫面上
    const fakeUrl = URL.createObjectURL(file);
    const uploadedAt = new Date().toISOString();
    try {
      const { data, error } = await supabaseClient
        .from("claim_documents")
        .insert([
          {
            claim_id: claimId,
            document_category: category,
            file_name: file.name,
            file_url: fakeUrl,
            file_type: file.type,
            uploaded_at: uploadedAt,
          },
        ])
        .select()
        .single();
      if (error) {
        alert("⚠️ 文件紀錄寫入失敗：" + error.message);
        return;
      }
      setList((prev) => [
        ...prev,
        {
          id: data.id,
          fileName: file.name,
          fileUrl: fakeUrl,
          fileType: file.type,
          category,
          uploadedAt,
        },
      ]);
    } catch (e) {
      alert("⚠️ 文件上傳過程發生未預期錯誤。");
    }
  };

  // ================================================================
  // 5. 文件線上簽署區塊（比照汽車險投保出單：文件內容 → OTP驗證＋注意事項 → 簽名框）
  // ================================================================
  const [signDocType, setSignDocType] = useState("理賠申請書");
  const [showSignModal, setShowSignModal] = useState(false);
  const [showSignNoticeModal, setShowSignNoticeModal] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpPhase, setOtpPhase] = useState("send");
  const [otpCode, setOtpCode] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpVerifiedAt, setOtpVerifiedAt] = useState(null);
  const [isSigned, setIsSigned] = useState(false);
  const [claimFormSignedStatus, setClaimFormSignedStatus] = useState(false); // 理賠申請書 是否已簽署
  const [settlementSignedStatus, setSettlementSignedStatus] = useState(false); // 和解書 是否已簽署

  const refreshSignStatus = async (id) => {
    if (!id) return;
    const { data } = await supabaseClient.from("claim_signatures").select("document_type").eq("claim_id", id);
    const types = (data || []).map((r) => r.document_type);
    setClaimFormSignedStatus(types.includes("理賠申請書"));
    setSettlementSignedStatus(types.includes("和解書"));
  };

  useEffect(() => {
    if (claimId) refreshSignStatus(claimId);
  }, [claimId]);

  // 9. 按「開始簽署」前先檢查目前選的文件類型是不是已經簽過了，簽過要再次確認才會真的打開簽署畫面
  const openSignModalWithCheck = () => {
    const alreadySigned = signDocType === "理賠申請書" ? claimFormSignedStatus : settlementSignedStatus;
    if (alreadySigned) {
      const proceed = window.confirm(`${signDocType} 已完成簽署，是否仍要重新簽署？`);
      if (!proceed) return;
    }
    setShowSignModal(true);
  };

  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);

  const sendOtpCode = () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setOtpCode(code);
    setOtpPhase("verify");
    alert(
      "📱（模擬簡訊發送）驗證碼已發送至 " +
        (driverPhone || insuredPhone || "您填寫的手機號碼") +
        "\n\n測試用驗證碼：" +
        code
    );
  };
  const verifyOtpCode = () => {
    if (otpInput === otpCode) {
      setOtpVerified(true);
      setOtpVerifiedAt(new Date().toISOString());
      alert("✅ OTP 身分驗證成功！");
      setShowOtpModal(false);
      setOtpPhase("send");
      setOtpInput("");
    } else {
      alert("❌ 驗證碼錯誤，請重新輸入");
    }
  };

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const startDrawing = (e) => {
    isDrawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const draw = (e) => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCanvasPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1a3d7c";
    ctx.lineWidth = 2;
    ctx.stroke();
    setIsSigned(true);
  };
  const stopDrawing = () => {
    isDrawingRef.current = false;
  };
  const clearSignature = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setIsSigned(false);
  };

  const submitClaimSignature = async () => {
    if (!claimId) {
      alert("⚠️ 請先按下方「儲存立案資料」建立案件，才能進行文件簽署。");
      return;
    }
    if (!isSigned) {
      alert("⚠️ 請先完成簽名。");
      return;
    }
    if (!otpVerified) {
      alert("⚠️ 請先完成OTP身分驗證。");
      return;
    }
    try {
      const signatureImage = canvasRef.current.toDataURL();
      await supabaseClient.from("claim_signatures").insert([
        {
          claim_id: claimId,
          document_type: signDocType,
          otp_verified: true,
          otp_verified_at: otpVerifiedAt,
          signature_image: signatureImage,
          signed_at: new Date().toISOString(),
        },
      ]);
      alert("✅ " + signDocType + " 已完成簽署！");
      setShowSignModal(false);
      clearSignature();
      setOtpVerified(false);
      refreshSignStatus(claimId);
    } catch (e) {
      alert("⚠️ 簽署儲存失敗，請稍後再試。");
    }
  };

  // ================================================================
  // 6. 修車估價區塊
  // ================================================================
  const [repairDocuments, setRepairDocuments] = useState([]);
  const [showRepairInfoModal, setShowRepairInfoModal] = useState(false);
  const [showRepairUploadModal, setShowRepairUploadModal] = useState(false);
  const [showRepairViewModal, setShowRepairViewModal] = useState(false);
  const [showRepairAiModal, setShowRepairAiModal] = useState(false);
  const [isDraggingRepairFile, setIsDraggingRepairFile] = useState(false);
  const [aiPickedRepairDoc, setAiPickedRepairDoc] = useState(null);

  const [requiredDocSelection, setRequiredDocSelection] = useState([]);
  const [requiredDocChecks, setRequiredDocChecks] = useState({});

  const toggleRequiredDocSelected = (name) => {
    setRequiredDocSelection((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      return next;
    });
    setRequiredDocChecks((prev) => ({ ...prev, [name]: prev[name] ?? false }));
  };
  const toggleRequiredDocCheck = (name) => {
    setRequiredDocChecks((prev) => ({ ...prev, [name]: !prev[name] }));
  };
  const allRequiredDocsReady =
    requiredDocSelection.length > 0 && requiredDocSelection.every((n) => requiredDocChecks[n]);

  // 預估理賠金額（修車估價相關欄位你說之後再補，這裡先放一個數字欄位供分流規則使用）
  const [estimatedClaimAmount, setEstimatedClaimAmount] = useState("");
  // 決算金額：跟預估金額分開，是真正決定結案時的金額
  const [finalSettlementAmount, setFinalSettlementAmount] = useState("");

  // ================================================================
  // 案件處理進度／結案流程
  // ================================================================
  const [caseClosed, setCaseClosed] = useState(false);
  const [paymentCompleted, setPaymentCompleted] = useState(false); // 先留狀態欄位，實際付款動作之後再接

  const caseProgressStages = [
    { key: "filed", label: "已立案", done: !!claimId },
    { key: "docsReady", label: "文件完備", done: allRequiredDocsReady },
    { key: "estimated", label: "已預估", done: !!estimatedClaimAmount },
    { key: "closed", label: "已結案", done: caseClosed },
    { key: "paid", label: "已付款", done: paymentCompleted },
  ];

  // 4. 查到新事故案件時，先把上一筆殘留的畫面資料清空（但保留剛查好的車號/保單資料，不要一起清掉）
  const resetClaimFieldsKeepPlate = () => {
    setClaimNo("");
    setReportTime("");
    setReportTimeIso("");
    setClaimId(null);
    setInsuredName("");
    setInsuredGender("");
    setInsuredPhone("");
    setInsuredIdNumber("");
    setInsuredAddress("");
    setInsuredEmail("");
    setVehicleType("");
    setBrandSeries("");
    setQuotationNo("");
    setPolicyCoverageTypes([]);
    setDriverName("");
    setDriverGender("");
    setDriverPhone("");
    setDriverIdNumber("");
    setReporterPhone("");
    setAccidentTime("");
    setAccidentLocation("");
    setPoliceCalled(false);
    setPoliceUnit("");
    setOtherVehicles([emptyOtherVehicle(1)]);
    setHiddenSeqStack([]);
    setAccidentDocuments([]);
    setRepairDocuments([]);
    setRequiredDocSelection([]);
    setRequiredDocChecks({});
    setEstimatedClaimAmount("");
    setFinalSettlementAmount("");
    setComplexityTier(null);
    setComplexityOverridden(false);
    setCaseClosed(false);
    setPaymentCompleted(false);
    setClaimFormSignedStatus(false);
    setSettlementSignedStatus(false);
  };

  const resetClaimForm = () => {
    setPlateNo("");
    setPolicyRecord(null);
    setPolicyValid(null);
    resetClaimFieldsKeepPlate();
  };

  const handleCloseCase = async () => {
    if (!claimId) {
      alert("⚠️ 請先儲存立案資料，才能進行結案。");
      return;
    }
    // 確認不代表結案：這裡是真正決定結案前的最後一道確認
    const confirmed = window.confirm("是否確定結案？結案後畫面將會清空，代表本案已完成決案。");
    if (!confirmed) return; // N：不做任何事，停留在目前畫面繼續處理

    try {
      const { error } = await supabaseClient
        .from("claims")
        .update({
          case_closed: true,
          final_settlement_amount: parseFloat(finalSettlementAmount) || null,
          closed_at: new Date().toISOString(),
        })
        .eq("id", claimId);
      if (error) {
        alert("⚠️ 結案失敗：" + error.message);
        return;
      }
      alert("✅ 案件已結案！立案編號：" + claimNo);
      resetClaimForm(); // Y：清空畫面，代表已決案
    } catch (e) {
      alert("⚠️ 結案過程發生未預期錯誤。");
    }
  };

  // 8. 案件分流（規則式：金額門檻 + 是否有人員受傷）
  // ================================================================
  const [complexityTier, setComplexityTier] = useState(null);
  const [complexityOverridden, setComplexityOverridden] = useState(false);

  const hasAnyInjury = otherVehicles.some((v) => v.injuryFlag);

  const runComplexityTriage = () => {
    const amount = parseFloat(estimatedClaimAmount) || 0;
    let tier;
    if (hasAnyInjury) {
      tier = "高複雜度";
    } else if (amount > 0 && amount <= 30000) {
      tier = "低複雜度";
    } else {
      tier = "中複雜度";
    }
    setComplexityTier(tier);
    setComplexityOverridden(false);
  };

  const overrideComplexity = (tier) => {
    setComplexityTier(tier);
    setComplexityOverridden(true);
  };

  useEffect(() => {
    if (estimatedClaimAmount !== "" || hasAnyInjury) {
      runComplexityTriage();
    }
  }, [estimatedClaimAmount, hasAnyInjury]);

  // ================================================================
  // 儲存立案
  // ================================================================
  const [saving, setSaving] = useState(false);

  const saveClaim = async () => {
    if (!claimNo) {
      alert("⚠️ 請先查詢車號、確認受理狀態，才能建立立案資料。");
      return;
    }
    setSaving(true);
    try {
      // ⚠️ claims.id 是 identity 欄位（自動編號），不能在 insert/upsert 裡帶入 id 值，
      // 否則資料庫會拒絕（cannot insert a non-DEFAULT value into column "id"）。
      // 改成：第一次儲存用 insert，之後同一筆用 update（用 claimId 當條件），完全不碰 id 欄位本身。
      const payload = {
        claim_no: claimNo,
        plate_no: plateNo,
        policy_valid: policyValid,
        quotation_no: quotationNo,
        insured_name: insuredName,
        insured_gender: insuredGender,
        insured_phone: insuredPhone,
        insured_id_number: insuredIdNumber,
        insured_address: insuredAddress,
        insured_email: insuredEmail,
        vehicle_type: vehicleType,
        brand_series: brandSeries,
        policy_coverage_types: policyCoverageTypes,
        driver_name: driverName,
        driver_gender: driverGender,
        driver_phone: driverPhone,
        driver_id_number: driverIdNumber,
        reporter_phone: reporterPhone,
        accident_time: accidentTime,
        accident_location: accidentLocation,
        police_called: policeCalled,
        police_unit: policeUnit,
        complexity_tier: complexityTier,
        complexity_overridden: complexityOverridden,
        required_documents: requiredDocSelection.map((n) => ({ name: n, checked: !!requiredDocChecks[n] })),
        estimated_claim_amount: parseFloat(estimatedClaimAmount) || null,
      };

      let data, error;
      if (claimId) {
        // 2. 更新已存在的案件時，絕對不要再覆蓋 report_time——那是通報當下才該寫入一次的時間
        ({ data, error } = await supabaseClient.from("claims").update(payload).eq("id", claimId).select().single());
      } else {
        // 第一次建立這筆案件，才寫入通報當下的時間戳（reportTimeIso 是查詢受理時就已經產生、鎖定的值）
        ({ data, error } = await supabaseClient
          .from("claims")
          .insert([{ ...payload, report_time: reportTimeIso || new Date().toISOString() }])
          .select()
          .single());
      }

      if (error) {
        alert("⚠️ 儲存失敗：" + error.message);
        setSaving(false);
        return;
      }

      setClaimId(data.id);

      if (data.id) {
        await supabaseClient.from("claim_other_vehicles").delete().eq("claim_id", data.id);
        if (otherVehicles.length > 0) {
          await supabaseClient.from("claim_other_vehicles").insert(
            otherVehicles.map((v) => ({
              claim_id: data.id,
              other_plate_no: v.otherPlateNo,
              other_driver_name: v.otherDriverName,
              other_driver_gender: v.otherDriverGender,
              other_driver_phone: v.otherDriverPhone,
              injury_flag: v.injuryFlag,
              hospitalized_flag: v.hospitalizedFlag,
              towed_flag: v.towedFlag,
              own_vehicle_repair_flag: v.ownVehicleRepairFlag,
              own_vehicle_drivable_flag: v.ownVehicleDrivableFlag,
            }))
          );
        }
      }

      alert("✅ 立案資料已儲存！立案編號：" + claimNo);
    } catch (e) {
      alert("⚠️ 儲存過程發生未預期錯誤。");
    }
    setSaving(false);
  };

  // 6. 客戶自助拍照畫面：簡訊連結帶 ?guideClaimId=xxx 進來，只顯示拍照引導，不顯示整套內部理賠系統
  const urlParams = new URLSearchParams(window.location.search);
  const guideClaimIdParam = urlParams.get("guideClaimId");
  if (guideClaimIdParam) {
    return (
      <div className="container py-4" style={{ maxWidth: "480px" }}>
        <h5 className="fw-bold text-center text-primary mb-4">🤖 事故現場拍照引導</h5>
        {aiGuideStep < AI_GUIDE_SCENE_STEPS.length ? (
          <>
            <div className="d-flex justify-content-between align-items-center mb-2 small text-muted">
              <span>拍攝步驟 {aiGuideStep + 1} / {AI_GUIDE_SCENE_STEPS.length}</span>
            </div>
            <div className="bg-primary bg-opacity-10 border border-primary rounded p-3 text-center mb-2">
              <div className="fw-bold fs-5 mb-2">請拍攝：{AI_GUIDE_SCENE_STEPS[aiGuideStep]}</div>
              <label className="d-block border border-primary rounded p-4 mb-0 bg-white" style={{ borderStyle: "dashed", cursor: "pointer" }}>
                <div className="fs-1 mb-2">📷</div>
                <div className="fw-bold">點此開啟相機拍攝</div>
                <div className="small text-muted">可連續拍攝多張，拍好後按下一步</div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="d-none"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;
                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const fakeUrl = URL.createObjectURL(file);
                      await supabaseClient.from("claim_documents").insert([
                        {
                          claim_id: parseInt(guideClaimIdParam, 10),
                          document_category: "accident_evidence",
                          file_name: file.name,
                          file_url: fakeUrl,
                          file_type: file.type,
                          uploaded_at: new Date().toISOString(),
                        },
                      ]);
                    }
                    setAiGuideStepPhotoCount((c) => c + files.length);
                    e.target.value = "";
                  }}
                />
              </label>
              {aiGuideStepPhotoCount > 0 && (
                <div className="small text-success fw-bold mt-2">✅ 這個步驟已拍攝 {aiGuideStepPhotoCount} 張</div>
              )}
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-secondary flex-fill" onClick={aiGuidePrev} disabled={aiGuideStep === 0}>
                上一步
              </button>
              <button type="button" className="btn btn-primary flex-fill fw-bold" onClick={aiGuideNext}>
                拍好了，下一步
              </button>
            </div>
          </>
        ) : (
          <div className="text-center">
            <div className="fs-1 mb-2">✅</div>
            <div className="fw-bold fs-5 mb-2">感謝您的配合！</div>
            <div className="small text-muted">拍攝內容已送出，理賠人員將會協助後續處理，您可以關閉此頁面。</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: "980px" }}>
      <h4 className="fw-bold text-center text-primary border-bottom pb-2 mb-4">
        🚨 汽車險理賠系統（事故報案處理）
      </h4>

      {/* ==================== 主畫面：車號查詢區 ==================== */}
      <div className="row g-2 align-items-end bg-light border rounded p-3 mb-4">
        <div className="col-md-3">
          車號
          <input
            type="text"
            className="form-control"
            value={plateNo}
            onChange={(e) => setPlateNo(e.target.value)}
            placeholder="例：CCC-333"
          />
        </div>
        <div className="col-md-2">
          <button type="button" className="btn btn-primary w-100 fw-bold" onClick={lookupPolicy} disabled={policyLookupLoading}>
            {policyLookupLoading ? "查詢中..." : "查詢受理"}
          </button>
        </div>
        <div className="col-md-2 text-center">
          <div className="small text-muted">接受報案</div>
          <div
            className="mx-auto mt-1"
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: policyValid === null ? "#ccc" : policyValid ? "#2ecc71" : "#e74c3c",
            }}
            title={policyValid === null ? "尚未查詢" : policyValid ? "保單有效，可受理" : "保單無效或查無資料"}
          ></div>
        </div>
        <div className="col-md-3">
          <button
            type="button"
            className="btn btn-outline-dark w-100"
            onClick={() => setShowPolicyModal(true)}
            disabled={!policyRecord}
          >
            投保內容
          </button>
        </div>
        <div className="col-md-2">
          <div className="small text-muted">立案編號</div>
          <div className="fw-bold">{claimNo || "－"}</div>
        </div>
        <div className="col-12 col-md-auto">
          <div className="small text-muted">通報時間</div>
          <div className="fw-bold">{reportTime || "－"}</div>
        </div>
        <div className="col-12 col-md-auto">
          <button type="button" className="btn btn-outline-primary fw-bold" onClick={openAiGuide}>
            🤖 AI引導事故現場處理
          </button>
        </div>
        <div className="col-12 col-md-3">
          報案人電話
          <input
            type="text"
            className="form-control"
            value={reporterPhone}
            onChange={(e) => setReporterPhone(e.target.value)}
            placeholder="供簡訊通知使用"
          />
        </div>
        <div className="col-12 col-md-auto">
          <button type="button" className="btn btn-outline-success fw-bold" onClick={sendGuideSms}>
            📱 簡訊通知
          </button>
        </div>
        <div className="col-12 col-md-auto">
          <button type="button" className="btn btn-outline-success fw-bold" onClick={sendGuideLine}>
            💬 LINE通知
          </button>
        </div>
      </div>

      {/* ==================== 案件處理進度 ==================== */}
      <div className="d-flex flex-wrap align-items-center gap-2 bg-light border rounded p-3 mb-4">
        {caseProgressStages.map((s, i) => (
          <div key={s.key} className="d-flex align-items-center">
            <span
              className={s.done ? "fw-bold text-dark" : "text-muted"}
              style={s.done ? {} : { opacity: 0.45 }}
            >
              {s.done ? "🟢" : "⚪"} {s.label}
            </span>
            {i < caseProgressStages.length - 1 && <span className="mx-2 text-muted">→</span>}
          </div>
        ))}
      </div>

      {/* ==================== 投保內容彈窗 ==================== */}
      {showPolicyModal && policyRecord && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📋 投保內容</h6>
                <button type="button" className="btn-close" onClick={() => setShowPolicyModal(false)} />
              </div>
              <div className="row small">
                <div className="col-6 mb-2"><span className="text-muted">車號：</span><span className="fw-bold">{plateNo}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">姓名：</span><span className="fw-bold">{insuredName}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">性別：</span><span className="fw-bold">{insuredGender}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">電話：</span><span className="fw-bold">{insuredPhone}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">ID：</span><span className="fw-bold">{insuredIdNumber || "未填"}</span></div>
                <div className="col-12 mb-2"><span className="text-muted">地址：</span><span className="fw-bold">{insuredAddress || "未填"}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">車種：</span><span className="fw-bold">{vehicleType}</span></div>
                <div className="col-6 mb-2"><span className="text-muted">廠牌車系：</span><span className="fw-bold">{brandSeries}</span></div>
                <div className="col-12 mb-2"><span className="text-muted">投保單號：</span><span className="fw-bold">{quotationNo}</span></div>
                <div className="col-12">
                  <span className="text-muted">保單期間：</span>
                  <span className="fw-bold">
                    強制 {policyRecord.compulsory_start_date}~{policyRecord.compulsory_end_date}
                    {policyRecord.arbitrary_start_date ? `／任意 ${policyRecord.arbitrary_start_date}~${policyRecord.arbitrary_end_date}` : ""}
                  </span>
                </div>
                <div className="col-12 mt-2">
                  <span className="text-muted">投保代號及險種：</span>
                  {policyCoverageTypes.length === 0 ? (
                    <span className="fw-bold">未查得明細</span>
                  ) : (
                    <ul className="mb-0 ps-3">
                      {policyCoverageTypes.map((c, i) => {
                        // 5. 大部分險種名稱裡本來就已經帶保額了（例如「第三人體傷險(200萬/400萬)」），不用再重複顯示；
                        // 只有乘客責任險目前沒有把方案內容存進名稱裡，才需要額外解析括號內容補上保額
                        const isPassenger = (c.name || "").includes("乘客");
                        const m = isPassenger ? (c.name || "").match(/\(([^)]+)\)/) : null;
                        const coverageAmount = m ? m[1] : null;
                        return (
                          <li key={i} className="fw-bold">
                            {c.code ? `${c.code} - ` : ""}
                            {c.name}
                            {coverageAmount ? `（保額：${coverageAmount}）` : ""}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 1. 被保險人區塊 ==================== */}
      <h6 className="fw-bold text-dark mb-2">👤 被保險人</h6>
      <div className="row g-3 bg-light p-3 rounded mb-4 border">
        <div className="col-6 col-md-4">保單號碼<input type="text" className="form-control bg-white" value={quotationNo} readOnly /></div>
        <div className="col-6 col-md-4">姓名<input type="text" className="form-control bg-white" value={insuredName} onChange={(e) => setInsuredName(e.target.value)} /></div>
        <div className="col-6 col-md-4">性別<input type="text" className="form-control bg-white" value={insuredGender} onChange={(e) => setInsuredGender(e.target.value)} /></div>
        <div className="col-6 col-md-4">電話<input type="text" className="form-control bg-white" value={insuredPhone} onChange={(e) => setInsuredPhone(e.target.value)} /></div>
        <div className="col-6 col-md-4">ID<input type="text" className="form-control bg-white" value={insuredIdNumber} onChange={(e) => setInsuredIdNumber(e.target.value)} /></div>
        <div className="col-12 col-md-8">地址<input type="text" className="form-control bg-white" value={insuredAddress} onChange={(e) => setInsuredAddress(e.target.value)} /></div>
        <div className="col-6 col-md-4">車種<input type="text" className="form-control bg-white" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} /></div>
        <div className="col-6 col-md-4">廠牌車系<input type="text" className="form-control bg-white" value={brandSeries} onChange={(e) => setBrandSeries(e.target.value)} /></div>
        <div className="col-12 col-md-4">E-mail<input type="text" className="form-control bg-white" value={insuredEmail} onChange={(e) => setInsuredEmail(e.target.value)} /></div>
      </div>

      {/* ==================== 2. 駕駛人區塊 ==================== */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold text-dark mb-0">🧑‍✈️ 駕駛人</h6>
        <button
          type="button"
          className="btn btn-sm btn-outline-primary fw-bold"
          onClick={() => {
            setDriverName(insuredName);
            setDriverGender(insuredGender);
            setDriverPhone(insuredPhone);
            setDriverIdNumber(insuredIdNumber);
          }}
        >
          同被保險人
        </button>
      </div>
      <div className="row g-3 bg-light p-3 rounded mb-4 border">
        <div className="col-6 col-md-3">姓名<input type="text" className="form-control bg-white" value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
        <div className="col-6 col-md-3">性別<input type="text" className="form-control bg-white" value={driverGender} onChange={(e) => setDriverGender(e.target.value)} /></div>
        <div className="col-6 col-md-3">電話<input type="text" className="form-control bg-white" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} /></div>
        <div className="col-6 col-md-3">ID<input type="text" className="form-control bg-white" value={driverIdNumber} onChange={(e) => setDriverIdNumber(e.target.value)} /></div>
      </div>

      {/* ==================== 3. 對方車及事故狀況區塊 ==================== */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-bold text-dark mb-0">🚗 對方車及事故狀況</h6>
        <button type="button" className="btn btn-sm btn-outline-primary fw-bold" onClick={addOtherVehicle}>
          ＋新增對方車
        </button>
      </div>
      <div className="row g-3 bg-light p-3 rounded mb-3 border">
        <div className="col-6 col-md-4">事故時間<input type="text" className="form-control bg-white" placeholder="例：1150902 14:30" value={accidentTime} onChange={(e) => setAccidentTime(e.target.value)} /></div>
        <div className="col-12 col-md-8">事故地點<input type="text" className="form-control bg-white" placeholder="例：台北市信義區忠孝東路五段" value={accidentLocation} onChange={(e) => setAccidentLocation(e.target.value)} /></div>
        <div className="col-6 col-md-4 form-check pt-2">
          <input className="form-check-input" type="checkbox" checked={policeCalled} onChange={(e) => setPoliceCalled(e.target.checked)} id="policeCalled" />
          <label className="form-check-label" htmlFor="policeCalled">報警</label>
        </div>
        <div className="col-6 col-md-8">
          警方單位
          <input type="text" className="form-control bg-white" value={policeUnit} onChange={(e) => setPoliceUnit(e.target.value)} disabled={!policeCalled} />
        </div>
      </div>
      {otherVehicles.filter((v) => v.visible).map((v) => (
        <div key={v.seq} className="bg-light p-3 rounded mb-3 border position-relative">
          <button
            type="button"
            className="btn-close position-absolute"
            style={{ top: 12, right: 12 }}
            onClick={() => removeOtherVehicle(v.seq)}
            title="暫時隱藏這台對方車（資料不會刪除）"
          />
          <div className="fw-bold small text-primary mb-2">對方車 #{v.seq}</div>
          <div className="row g-3 mb-2">
            <div className="col-6 col-md-3">車牌<input type="text" className="form-control bg-white" value={v.otherPlateNo} onChange={(e) => updateOtherVehicle(v.seq, "otherPlateNo", e.target.value)} /></div>
            <div className="col-6 col-md-3">駕駛人姓名<input type="text" className="form-control bg-white" value={v.otherDriverName} onChange={(e) => updateOtherVehicle(v.seq, "otherDriverName", e.target.value)} /></div>
            <div className="col-6 col-md-3">性別<input type="text" className="form-control bg-white" value={v.otherDriverGender} onChange={(e) => updateOtherVehicle(v.seq, "otherDriverGender", e.target.value)} /></div>
            <div className="col-6 col-md-3">電話<input type="text" className="form-control bg-white" value={v.otherDriverPhone} onChange={(e) => updateOtherVehicle(v.seq, "otherDriverPhone", e.target.value)} /></div>
          </div>
          <div className="row g-2 small">
            <div className="col-6 col-md-3 form-check">
              <input className="form-check-input" type="checkbox" checked={v.injuryFlag} onChange={(e) => updateOtherVehicle(v.seq, "injuryFlag", e.target.checked)} id={`injury-${v.seq}`} />
              <label className="form-check-label" htmlFor={`injury-${v.seq}`}>人員受傷</label>
            </div>
            <div className="col-6 col-md-3 form-check">
              <input className="form-check-input" type="checkbox" checked={v.hospitalizedFlag} onChange={(e) => updateOtherVehicle(v.seq, "hospitalizedFlag", e.target.checked)} id={`hosp-${v.seq}`} />
              <label className="form-check-label" htmlFor={`hosp-${v.seq}`}>人員送醫</label>
            </div>
            <div className="col-6 col-md-3 form-check">
              <input className="form-check-input" type="checkbox" checked={v.towedFlag} onChange={(e) => updateOtherVehicle(v.seq, "towedFlag", e.target.checked)} id={`towed-${v.seq}`} />
              <label className="form-check-label" htmlFor={`towed-${v.seq}`}>車輛拖吊</label>
            </div>
            <div className="col-6 col-md-3 form-check">
              <input className="form-check-input" type="checkbox" checked={v.ownVehicleRepairFlag} onChange={(e) => updateOtherVehicle(v.seq, "ownVehicleRepairFlag", e.target.checked)} id={`repair-${v.seq}`} />
              <label className="form-check-label" htmlFor={`repair-${v.seq}`}>本車維修</label>
            </div>
            <div className="col-6 col-md-3 form-check">
              <input className="form-check-input" type="checkbox" checked={v.ownVehicleDrivableFlag} onChange={(e) => updateOtherVehicle(v.seq, "ownVehicleDrivableFlag", e.target.checked)} id={`drivable-${v.seq}`} />
              <label className="form-check-label" htmlFor={`drivable-${v.seq}`}>本車可行駛</label>
            </div>
          </div>
          <div className="d-flex justify-content-end mt-2">
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => deleteOtherVehiclePermanently(v.seq)}>
              🗑️ 刪除這筆對方車資料
            </button>
          </div>
        </div>
      ))}

      {/* ==================== 4. 事故處理區塊 ==================== */}
      <div className="d-flex justify-content-between align-items-center mb-2 mt-2">
        <h6 className="fw-bold text-dark mb-0">📸 事故處理</h6>
        <button type="button" className="btn btn-sm btn-outline-secondary fw-bold" onClick={() => setShowAccidentInfoModal(true)}>
          相關文件內容
        </button>
      </div>
      <div className="row g-2 mb-4">
        <div className="col-3">
          <button type="button" className="btn btn-primary w-100" onClick={() => setShowAccidentUploadModal(true)}>
            📤 上傳文件 ({accidentDocuments.length})
          </button>
        </div>
        <div className="col-3">
          <label className="btn btn-success w-100 mb-0">
            📸 即拍即傳
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="d-none"
              onChange={async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                for (let i = 0; i < files.length; i++) {
                  await handleUploadDocument(files[i], "accident_evidence", setAccidentDocuments);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="col-3">
          <button type="button" className="btn btn-outline-dark w-100" onClick={() => setShowAccidentViewModal(true)}>
            🔍 上傳文件調閱
          </button>
        </div>
        <div className="col-3">
          <button type="button" className="btn btn-outline-primary w-100" onClick={() => setShowAccidentAiModal(true)}>
            🤖 AI文件辨識
          </button>
        </div>
      </div>

      {/* ==================== 5. 文件線上簽署區塊 ==================== */}
      <h6 className="fw-bold text-dark mb-2">✍️ 文件線上簽署</h6>
      <div className="row g-2 align-items-end bg-light border rounded p-3 mb-4">
        <div className="col-8">
          文件類型
          <select className="form-select bg-white" value={signDocType} onChange={(e) => setSignDocType(e.target.value)}>
            <option value="理賠申請書">理賠申請書</option>
            <option value="和解書">和解書</option>
          </select>
        </div>
        <div className="col-4">
          <button type="button" className="btn btn-success w-100 fw-bold" onClick={openSignModalWithCheck}>
            開始簽署
          </button>
        </div>
        <div className="col-12 d-flex gap-3 mt-2">
          <span className={`badge ${claimFormSignedStatus ? "bg-success" : "bg-secondary"}`}>
            理賠申請書：{claimFormSignedStatus ? "已簽署" : "未簽署"}
          </span>
          <span className={`badge ${settlementSignedStatus ? "bg-success" : "bg-secondary"}`}>
            和解書：{settlementSignedStatus ? "已簽署" : "未簽署"}
          </span>
        </div>
      </div>

      {/* ==================== 6. 修車估價區塊 ==================== */}
      <div className="d-flex justify-content-between align-items-center mb-2 mt-2">
        <h6 className="fw-bold text-dark mb-0">🔧 修車估價</h6>
        <button type="button" className="btn btn-sm btn-outline-secondary fw-bold" onClick={() => setShowRepairInfoModal(true)}>
          請備妥相關文件
        </button>
      </div>
      <div className="row g-2 mb-3">
        <div className="col-4">
          <button type="button" className="btn btn-primary w-100" onClick={() => setShowRepairUploadModal(true)}>
            📤 上傳文件 ({repairDocuments.length})
          </button>
        </div>
        <div className="col-4">
          <button type="button" className="btn btn-outline-dark w-100" onClick={() => setShowRepairViewModal(true)}>
            🔍 上傳文件調閱
          </button>
        </div>
        <div className="col-4">
          <button type="button" className="btn btn-outline-primary w-100" onClick={() => setShowRepairAiModal(true)}>
            🤖 AI文件辨識
          </button>
        </div>
      </div>

      <div className="row g-3 mb-2 align-items-end">
        <div className="col-md-4">
          預估理賠金額（元）
          <input
            type="number"
            className="form-control bg-white"
            value={estimatedClaimAmount}
            onChange={(e) => setEstimatedClaimAmount(e.target.value)}
            placeholder="供案件分流規則使用"
          />
        </div>
        <div className="col-md-4">
          決算金額（元）
          <input
            type="number"
            className="form-control bg-white"
            value={finalSettlementAmount}
            onChange={(e) => setFinalSettlementAmount(e.target.value)}
            placeholder="結案時的正式金額"
          />
        </div>
        <div className="col-md-4">
          <button type="button" className="btn btn-danger w-100 fw-bold" onClick={handleCloseCase}>
            結案
          </button>
          <div className="small text-muted mt-1">※ 預估／決算金額本身不代表結案，需按此鈕再次確認</div>
        </div>
      </div>

      <div className="bg-light border rounded p-3 mb-4">
        <div className="fw-bold small mb-2">本案件應提供文件清單</div>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {REQUIRED_DOC_OPTIONS.map((name) => (
            <button
              key={name}
              type="button"
              className={`btn btn-sm ${requiredDocSelection.includes(name) ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => toggleRequiredDocSelected(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {requiredDocSelection.length > 0 && (
          <div className="d-flex flex-wrap gap-3 align-items-center">
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: allRequiredDocsReady ? "#2ecc71" : "#e74c3c",
              }}
              title={allRequiredDocsReady ? "文件已備齊" : "文件尚未備齊"}
            ></div>
            {requiredDocSelection.map((name) => (
              <div key={name} className="d-flex align-items-center gap-1 border rounded px-2 py-1 bg-white">
                <input
                  type="checkbox"
                  className="form-check-input mt-0"
                  checked={!!requiredDocChecks[name]}
                  onChange={() => toggleRequiredDocCheck(name)}
                />
                <span className="small">{name}</span>
                <span className={`small fw-bold ${requiredDocChecks[name] ? "text-success" : "text-danger"}`}>
                  {requiredDocChecks[name] ? "V" : "X"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ==================== 8. 案件分流 ==================== */}
      <h6 className="fw-bold text-dark mb-2">🚦 案件分流</h6>
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <button
            type="button"
            className={`w-100 p-3 rounded border text-start ${complexityTier === "低複雜度" ? "border-success border-3 bg-success bg-opacity-10" : "bg-light"}`}
            onClick={() => overrideComplexity("低複雜度")}
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: complexityTier === "低複雜度" ? "#2ecc71" : "#ccc" }}></div>
              <span className="fw-bold">低複雜度・全線上</span>
            </div>
            <div className="small text-muted">3萬元以下小額案件</div>
            <div className="small text-muted">電子收案→OCR自動立案→線上理算/審核→付款</div>
          </button>
        </div>
        <div className="col-md-4">
          <button
            type="button"
            className={`w-100 p-3 rounded border text-start ${complexityTier === "中複雜度" ? "border-warning border-3 bg-warning bg-opacity-10" : "bg-light"}`}
            onClick={() => overrideComplexity("中複雜度")}
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: complexityTier === "中複雜度" ? "#f1c40f" : "#ccc" }}></div>
              <span className="fw-bold">中複雜度・數位優先</span>
            </div>
            <div className="small text-muted">一般理賠案件</div>
            <div className="small text-muted">電子收案→線上點核→理算→必要紙本→付款</div>
          </button>
        </div>
        <div className="col-md-4">
          <button
            type="button"
            className={`w-100 p-3 rounded border text-start ${complexityTier === "高複雜度" ? "border-danger border-3 bg-danger bg-opacity-10" : "bg-light"}`}
            onClick={() => overrideComplexity("高複雜度")}
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: complexityTier === "高複雜度" ? "#e74c3c" : "#ccc" }}></div>
              <span className="fw-bold">高複雜度・專業審查</span>
            </div>
            <div className="small text-muted">體傷／強制／特殊案件</div>
            <div className="small text-muted">電子收案→專業判斷→查證→文件→審核→付款</div>
          </button>
        </div>
      </div>
      {complexityTier && (
        <div className="small text-muted mb-4">
          {complexityOverridden ? "⚠️ 此分流已由理賠員手動覆蓋系統建議" : "✅ 系統依規則自動建議"}
        </div>
      )}

      <button type="button" className="btn btn-primary btn-lg w-100 fw-bold mb-5" onClick={saveClaim} disabled={saving}>
        {saving ? "儲存中..." : "💾 儲存立案資料"}
      </button>

      {/* ==================== 事故處理：相關文件內容說明 ==================== */}
      {showAccidentInfoModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📸 相關文件內容</h6>
                <button type="button" className="btn-close" onClick={() => setShowAccidentInfoModal(false)} />
              </div>
              <div className="small mb-3">
                <div className="fw-bold mb-1">1. 請上傳：</div>
                <div className="text-muted">事故照片、影像、GPS定位圖、事故描述錄音、其他相關文件等</div>
              </div>
              <div className="small">
                <div className="fw-bold mb-1">2. 事故現場拍攝建議順序：</div>
                <ol className="text-muted ps-3 mb-0">
                  <li>事故全景</li>
                  <li>碰撞位置</li>
                  <li>本車受損</li>
                  <li>對方車輛</li>
                  <li>對方車牌</li>
                  <li>行照／駕照</li>
                  <li>道路相關標線／號誌</li>
                  <li>其他證據</li>
                </ol>
              </div>
              <button type="button" className="btn btn-outline-secondary w-100 fw-bold mt-3" onClick={() => setShowAccidentInfoModal(false)}>
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 🤖 AI引導事故現場處理 ==================== */}
      {showAiGuideModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100060, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "440px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🤖 AI引導事故現場處理</h6>
                <button type="button" className="btn-close" onClick={() => setShowAiGuideModal(false)} />
              </div>

              {aiGuideStep < AI_GUIDE_SCENE_STEPS.length ? (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-2 small text-muted">
                    <span>拍攝步驟 {aiGuideStep + 1} / {AI_GUIDE_SCENE_STEPS.length}</span>
                  </div>
                  <div className="bg-primary bg-opacity-10 border border-primary rounded p-3 text-center mb-2">
                    <div className="fw-bold fs-5 mb-2">請拍攝：{AI_GUIDE_SCENE_STEPS[aiGuideStep]}</div>
                    <label
                      className="d-block border border-primary rounded p-4 mb-0 bg-white"
                      style={{ borderStyle: "dashed", cursor: "pointer" }}
                    >
                      <div className="fs-1 mb-2">📷</div>
                      <div className="fw-bold">點此開啟相機拍攝</div>
                      <div className="small text-muted">可連續拍攝多張，拍好後按下一步</div>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="d-none"
                        onChange={handleAiGuideCapture}
                      />
                    </label>
                    {aiGuideStepPhotoCount > 0 && (
                      <div className="small text-success fw-bold mt-2">✅ 這個步驟已拍攝 {aiGuideStepPhotoCount} 張</div>
                    )}
                  </div>
                  <div className="d-flex gap-2">
                    <button type="button" className="btn btn-outline-secondary flex-fill" onClick={aiGuidePrev} disabled={aiGuideStep === 0}>
                      上一步
                    </button>
                    <button type="button" className="btn btn-primary flex-fill fw-bold" onClick={aiGuideNext}>
                      拍好了，下一步
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="fw-bold mb-2">✅ 現場拍攝步驟已走完！</div>
                  <div className="small text-muted mb-3" style={{ lineHeight: 1.8 }}>
                    別忘了，以下這些類型的證據也可以一併上傳：
                    <br />
                    事故照片、影像、GPS定位圖、事故描述錄音、其他相關文件等。
                  </div>
                  <div className="d-flex gap-2">
                    <button type="button" className="btn btn-outline-secondary flex-fill" onClick={aiGuidePrev}>
                      上一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary flex-fill fw-bold"
                      onClick={() => {
                        setShowAiGuideModal(false);
                        setShowAccidentUploadModal(true);
                      }}
                    >
                      前往上傳
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}


      {/* ==================== 事故處理：上傳文件 ==================== */}
      {showAccidentUploadModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📤 上傳事故處理文件</h6>
                <button type="button" className="btn-close" onClick={() => setShowAccidentUploadModal(false)} />
              </div>
              <label
                onDragOver={(e) => { e.preventDefault(); setIsDraggingAccidentFile(true); }}
                onDragLeave={() => setIsDraggingAccidentFile(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingAccidentFile(false);
                  const file = e.dataTransfer.files && e.dataTransfer.files[0];
                  handleUploadDocument(file, "accident_evidence", setAccidentDocuments);
                }}
                className={`d-flex flex-column align-items-center justify-content-center text-center rounded-3 p-4 ${isDraggingAccidentFile ? "border border-primary bg-primary bg-opacity-10" : "border border-secondary-subtle bg-light"}`}
                style={{ borderStyle: "dashed", borderWidth: "2px", minHeight: "140px", cursor: "pointer" }}
              >
                <div className="fs-1 mb-2">📁</div>
                <div className="fw-bold text-muted">拖拉檔案到此處，或點擊選擇檔案</div>
                <input
                  type="file"
                  className="d-none"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    handleUploadDocument(file, "accident_evidence", setAccidentDocuments);
                    e.target.value = "";
                  }}
                />
              </label>
              {accidentDocuments.length > 0 && (
                <div className="mt-3 small">
                  <div className="fw-bold mb-1">已上傳 {accidentDocuments.length} 筆：</div>
                  {accidentDocuments.map((d, i) => (
                    <div key={i} className="text-muted">📎 {d.fileName}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 事故處理：上傳文件調閱 ==================== */}
      {showAccidentViewModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🔍 上傳文件調閱</h6>
                <button type="button" className="btn-close" onClick={() => setShowAccidentViewModal(false)} />
              </div>
              {accidentDocuments.length === 0 ? (
                <div className="text-muted small">尚無已上傳文件。</div>
              ) : (
                accidentDocuments.map((d, i) => (
                  <a key={i} href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="d-block border rounded p-2 mb-2 text-decoration-none">
                    📎 {d.fileName}
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 事故處理：AI文件辨識 ==================== */}
      {showAccidentAiModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🤖 AI文件辨識</h6>
                <button type="button" className="btn-close" onClick={() => { setShowAccidentAiModal(false); setAiPickedAccidentDoc(null); }} />
              </div>
              {accidentDocuments.length === 0 ? (
                <div className="text-muted small">尚無已上傳文件可供辨識。</div>
              ) : (
                <>
                  <div className="small text-muted mb-2">點選或拖拉文件進行辨識：</div>
                  {accidentDocuments.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`d-block w-100 text-start border rounded p-2 mb-2 ${aiPickedAccidentDoc === i ? "border-primary bg-primary bg-opacity-10" : ""}`}
                      onClick={() => setAiPickedAccidentDoc(i)}
                    >
                      📎 {d.fileName}
                    </button>
                  ))}
                  {aiPickedAccidentDoc !== null && (
                    <div className="alert alert-warning small mt-2 mb-0">
                      ⚠️ AI文件辨識功能尚未開通，目前為介面預留接口，功能上線後會自動把辨識結果寫入對應欄位。
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 修車估價：請備妥相關文件說明 ==================== */}
      {showRepairInfoModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "460px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🔧 請備妥相關文件</h6>
                <button type="button" className="btn-close" onClick={() => setShowRepairInfoModal(false)} />
              </div>
              <div className="small text-muted">本車及對方車估價／維修資料、體傷診斷證明、醫療費用單據等。</div>
              <button type="button" className="btn btn-outline-secondary w-100 fw-bold mt-3" onClick={() => setShowRepairInfoModal(false)}>
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 修車估價：上傳文件 ==================== */}
      {showRepairUploadModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📤 上傳修車估價文件</h6>
                <button type="button" className="btn-close" onClick={() => setShowRepairUploadModal(false)} />
              </div>
              <label
                onDragOver={(e) => { e.preventDefault(); setIsDraggingRepairFile(true); }}
                onDragLeave={() => setIsDraggingRepairFile(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingRepairFile(false);
                  const file = e.dataTransfer.files && e.dataTransfer.files[0];
                  handleUploadDocument(file, "repair_estimate", setRepairDocuments);
                }}
                className={`d-flex flex-column align-items-center justify-content-center text-center rounded-3 p-4 ${isDraggingRepairFile ? "border border-primary bg-primary bg-opacity-10" : "border border-secondary-subtle bg-light"}`}
                style={{ borderStyle: "dashed", borderWidth: "2px", minHeight: "140px", cursor: "pointer" }}
              >
                <div className="fs-1 mb-2">📁</div>
                <div className="fw-bold text-muted">拖拉檔案到此處，或點擊選擇檔案</div>
                <input
                  type="file"
                  className="d-none"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    handleUploadDocument(file, "repair_estimate", setRepairDocuments);
                    e.target.value = "";
                  }}
                />
              </label>
              {repairDocuments.length > 0 && (
                <div className="mt-3 small">
                  <div className="fw-bold mb-1">已上傳 {repairDocuments.length} 筆：</div>
                  {repairDocuments.map((d, i) => (
                    <div key={i} className="text-muted">📎 {d.fileName}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 修車估價：上傳文件調閱 ==================== */}
      {showRepairViewModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🔍 上傳文件調閱</h6>
                <button type="button" className="btn-close" onClick={() => setShowRepairViewModal(false)} />
              </div>
              {repairDocuments.length === 0 ? (
                <div className="text-muted small">尚無已上傳文件。</div>
              ) : (
                repairDocuments.map((d, i) => (
                  <a key={i} href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="d-block border rounded p-2 mb-2 text-decoration-none">
                    📎 {d.fileName}
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 修車估價：AI文件辨識 ==================== */}
      {showRepairAiModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100050, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "480px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">🤖 AI文件辨識</h6>
                <button type="button" className="btn-close" onClick={() => { setShowRepairAiModal(false); setAiPickedRepairDoc(null); }} />
              </div>
              {repairDocuments.length === 0 ? (
                <div className="text-muted small">尚無已上傳文件可供辨識。</div>
              ) : (
                <>
                  <div className="small text-muted mb-2">點選或拖拉文件進行辨識：</div>
                  {repairDocuments.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`d-block w-100 text-start border rounded p-2 mb-2 ${aiPickedRepairDoc === i ? "border-primary bg-primary bg-opacity-10" : ""}`}
                      onClick={() => setAiPickedRepairDoc(i)}
                    >
                      📎 {d.fileName}
                    </button>
                  ))}
                  {aiPickedRepairDoc !== null && (
                    <div className="alert alert-warning small mt-2 mb-0">
                      ⚠️ AI文件辨識功能尚未開通，目前為介面預留接口，功能上線後會自動把辨識結果寫入對應欄位。
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 5. 文件線上簽署：上-文件內容 / 中-OTP驗證+注意事項 / 下-簽名框 ==================== */}
      {showSignModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100055, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "520px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">✍️ {signDocType}</h6>
                <button type="button" className="btn-close" onClick={() => setShowSignModal(false)} />
              </div>

              {/* 上：文件內容（依實際理賠申請書／和解書格式呈現） */}
              <div className="border rounded p-3 mb-3 bg-light" style={{ maxHeight: "260px", overflowY: "auto" }}>
                {signDocType === "理賠申請書" ? (
                  <div className="small" style={{ lineHeight: 1.9 }}>
                    <div className="fw-bold mb-1">汽車保險理賠申請書</div>
                    <div>保險單號碼：{quotationNo || "未填"}</div>
                    <div>
                      保險期間：{policyRecord?.compulsory_start_date}~{policyRecord?.compulsory_end_date}
                      {policyRecord?.arbitrary_start_date ? `／${policyRecord.arbitrary_start_date}~${policyRecord.arbitrary_end_date}` : ""}
                    </div>
                    <div>賠案號碼：{claimNo}</div>
                    <hr className="my-1" />
                    <div className="fw-bold">被保險人</div>
                    <div>姓名：{insuredName || "未填"}　性別：{insuredGender || "未填"}</div>
                    <div>廠牌型式：{brandSeries || "未填"}　牌照號碼：{plateNo || "未填"}</div>
                    <div>行動電話：{insuredPhone || "未填"}　E-mail：{insuredEmail || "未填"}</div>
                    <div>地址：{insuredAddress || "未填"}</div>
                    <div className="fw-bold mt-2">駕駛人</div>
                    <div>姓名：{driverName || "未填"}　性別：{driverGender || "未填"}</div>
                    <div>行動電話：{driverPhone || "未填"}　身分證/駕照號碼：{driverIdNumber || "未填"}</div>
                    <div className="fw-bold mt-2">事故資料</div>
                    <div>事故時間：{accidentTime || "未填"}</div>
                    <div>事故地點：{accidentLocation || "未填"}</div>
                    <div>
                      警方處理：{policeCalled ? `已報警（${policeUnit || "單位未填"}）` : "未報警／未填"}
                    </div>
                    <div>
                      出險情形：{hasAnyInjury ? "人員傷亡" : "無人員傷亡"}
                      {otherVehicles.some((v) => v.ownVehicleRepairFlag) ? "、本車需維修" : ""}
                    </div>
                    <div className="fw-bold mt-2">對方資料</div>
                    {otherVehicles.map((v, i) => (
                      <div key={i}>
                        {i + 1}. 駕駛：{v.otherDriverName || "未填"}／牌照：{v.otherPlateNo || "未填"}／電話：{v.otherDriverPhone || "未填"}
                        {v.injuryFlag ? "／有人員受傷" : ""}
                      </div>
                    ))}
                    <div className="text-muted mt-2" style={{ fontSize: "0.75rem" }}>
                      聲明事項：本申請書所填寫各項均為真實情形，否則自願放棄保險單之一切權利。
                    </div>
                  </div>
                ) : (
                  <div className="small" style={{ lineHeight: 1.9 }}>
                    <div className="fw-bold mb-1">和解書</div>
                    <div>簽具日期：{getTodayMinguo()}</div>
                    <div>和解地點：{accidentLocation || "未填"}</div>
                    <hr className="my-1" />
                    <div className="fw-bold">甲方（被保險人）</div>
                    <div>姓名：{insuredName || "未填"}　身分證統一編號：{insuredIdNumber || "未填"}</div>
                    <div>住址：{insuredAddress || "未填"}</div>
                    <div className="fw-bold mt-2">乙方（對方）</div>
                    {otherVehicles.map((v, i) => (
                      <div key={i}>
                        姓名：{v.otherDriverName || "未填"}　聯絡電話：{v.otherDriverPhone || "未填"}
                      </div>
                    ))}
                    <div className="fw-bold mt-2">肇事情形</div>
                    <div>
                      {accidentTime || "時間未填"}，甲方所駕 {plateNo || "車號未填"} 號車，在 {accidentLocation || "地點未填"} 發生車禍。
                    </div>
                    <div className="fw-bold mt-2">和解條件</div>
                    <div>和解金額：NT$ {estimatedClaimAmount ? Number(estimatedClaimAmount).toLocaleString() : "未填"}</div>
                    <div className="text-muted mt-2" style={{ fontSize: "0.75rem" }}>
                      本和解金額是否含強制汽車責任保險給付金額，請於正式文件中確認勾選。
                    </div>
                  </div>
                )}
              </div>

              {/* 中：OTP驗證 + 注意事項 */}
              <div className="d-flex justify-content-between align-items-start mb-2 gap-2">
                <div className="text-danger fw-bold small">⚠️ 簽名前請先完成OTP身分驗證</div>
                <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" onClick={() => setShowSignNoticeModal(true)}>
                  注意事項
                </button>
              </div>
              <div className={`d-flex justify-content-between align-items-center rounded-2 p-2 mb-3 ${otpVerified ? "bg-success bg-opacity-10" : "bg-warning bg-opacity-10"}`}>
                <span className="small fw-bold">{otpVerified ? "✅ OTP驗證已通過" : "未驗證"}</span>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setShowOtpModal(true)} disabled={otpVerified}>
                  {otpVerified ? "已驗證" : "OTP驗證"}
                </button>
              </div>

              {/* 下：簽名框 */}
              <div className="small text-muted mb-1">請在藍色虛線框內用手指或滑鼠手寫簽名：</div>
              <canvas
                ref={canvasRef}
                width={460}
                height={160}
                className="border border-primary rounded w-100 mb-3"
                style={{ borderStyle: "dashed", touchAction: "none" }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
              <div className="row g-2">
                <div className="col-6">
                  <button type="button" className="btn btn-outline-secondary w-100 fw-bold" onClick={clearSignature}>
                    清除重簽
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-primary w-100 fw-bold" onClick={submitClaimSignature}>
                    確認送出
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 簽署注意事項 ==================== */}
      {showSignNoticeModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100065, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "460px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📌 簽署注意事項</h6>
                <button type="button" className="btn-close" onClick={() => setShowSignNoticeModal(false)} />
              </div>
              <ol className="small ps-3" style={{ lineHeight: 1.8 }}>
                <li className="mb-2">
                  完成線上身分驗證：透過「簡訊OTP動態密碼」確定是本人操作，才能進行文件簽署。
                </li>
                <li>
                  簽署人須為理賠案件本人（被保險人或駕駛人），不可代理他人完成線上簽署。
                </li>
              </ol>
              <button type="button" className="btn btn-outline-secondary w-100 fw-bold mt-2" onClick={() => setShowSignNoticeModal(false)}>
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== OTP 身分驗證 ==================== */}
      {showOtpModal && (
        <div className="modal d-block show bg-black bg-opacity-75" style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 100080, overflowY: "auto" }}>
          <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
            <div className="bg-white rounded-3 p-4 shadow-lg" style={{ maxWidth: "400px", width: "100%" }}>
              <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <h6 className="fw-bold text-primary mb-0">📱 OTP 身分驗證</h6>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowOtpModal(false);
                    setOtpPhase("send");
                    setOtpInput("");
                  }}
                />
              </div>
              {otpPhase === "send" && (
                <>
                  <p className="small text-muted">
                    將發送驗證碼至：
                    <span className="fw-bold text-dark">{driverPhone || insuredPhone || "（尚未填寫電話）"}</span>
                  </p>
                  <button type="button" className="btn btn-primary w-100 fw-bold" disabled={!driverPhone && !insuredPhone} onClick={sendOtpCode}>
                    發送驗證碼
                  </button>
                </>
              )}
              {otpPhase === "verify" && (
                <>
                  <p className="small text-muted">請輸入您收到的 6 位數驗證碼：</p>
                  <input
                    type="text"
                    maxLength={6}
                    className="form-control mb-3 text-center fs-4 font-monospace"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="------"
                  />
                  <button type="button" className="btn btn-primary w-100 fw-bold mb-2" onClick={verifyOtpCode}>
                    確認驗證
                  </button>
                  <button type="button" className="btn btn-link w-100 btn-sm" onClick={sendOtpCode}>
                    重新發送驗證碼
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
