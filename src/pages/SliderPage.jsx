// src/pages/SliderPage.jsx
// スライダー画面
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import PanelHeader from "../components/ui/PanelHeader";
import { getReferenceLotById, TASTEMAP_POINTS_URL } from "../ui/constants";
import { getLotId } from "../utils/lot";

/* ============ 小ユーティリティ ============ */
const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

// 3次元ユークリッド距離^2
const dist2_3d = (x1, y1, z1, x2, y2, z2) => {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dz = z1 - z2;
  return dx * dx + dy * dy + dz * dz;
};

const centerGradient = (val) => {
  const base = "#e9e9e9",
    active = "#b59678";
  const v = Math.max(0, Math.min(100, Number(val)));
  if (v === 50) return base;
  const a = Math.min(50, v),
    b = Math.max(50, v);
  return `linear-gradient(to right, ${base} 0%, ${base} ${a}%, ${active} ${a}%, ${active} ${b}%, ${base} ${b}%, ${base} 100%)`;
};

//////2026.05.以下1セクションを追加
//------------------------------------------------------
// ログ送信関数（関数）
const API_BASE = process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_BASE || "";

const getQrContextForLog = () => {
  try {
    const raw = sessionStorage.getItem("tm_qr_context_v1");
    if (!raw) return { store_id: null, importer_id: null };

    const ctx = JSON.parse(raw);
    const storeId = Number(ctx?.store_id);
    const importerId = Number(ctx?.importer_id);

    return {
      store_id: Number.isFinite(storeId) && storeId > 0 ? storeId : null,
      importer_id: Number.isFinite(importerId) && importerId > 0 ? importerId : null,
    };
  } catch {
    return { store_id: null, importer_id: null };
  }
};

const getSessionId = () => {
  try {
    let sid = sessionStorage.getItem("tm_access_log_session_id");
    if (!sid) {
      sid =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("tm_access_log_session_id", sid);
    }
    return sid;
  } catch {
    return null;
  }
};

const postAccessLog = async ({ event_type, jan_code, source }) => {
  if (!event_type || !jan_code) return;

  const ctx = getQrContextForLog();

  const payload = {
    event_type,
    jan_code: String(jan_code),
    session_id: getSessionId(),
    store_id: ctx.store_id,
    importer_id: ctx.importer_id,
    source: event_type === "product_open" ? source || null : null,
  };

  try {
    await fetch(`${API_BASE}/api/app/access-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    console.warn("[access log] failed:", e);
  }
};
//------------------------------------------------------

/**
 * PC → スライダー(0–100)
 * 0   : minPC
 * 50  : basePC（基準ロット）
 * 100 : maxPC
 */
const pcToSliderCenter = (pc, min, base, max) => {
  if (
    !Number.isFinite(pc) ||
    !Number.isFinite(min) ||
    !Number.isFinite(base) ||
    !Number.isFinite(max)
  ) {
    return 50;
  }

  if (pc <= base) {
    const denom = base - min;
    if (denom <= 0) return 50;
    const t = (pc - min) / denom; // 0〜1
    return Math.max(0, Math.min(50, t * 50));
  }

  const denom = max - base;
  if (denom <= 0) return 50;
  const t = (pc - base) / denom; // 0〜1
  return Math.max(50, Math.min(100, 50 + t * 50));
};

/**
 * スライダー(0–100) → PC
 */
const sliderToPCCenter = (sliderVal, min, base, max) => {
  const v = Math.max(0, Math.min(100, Number(sliderVal)));
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(base) ||
    !Number.isFinite(max)
  ) {
    return base || 0;
  }

  if (v <= 50) {
    const denom = 50;
    if (base <= min || denom <= 0) return base;
    const t = v / denom; // 0〜1
    return min + (base - min) * t;
  }

  const denom = 50;
  if (max <= base || denom <= 0) return base;
  const t = (v - 50) / denom; // 0〜1
  return base + (max - base) * t;
};

// (PC1,PC2,PC3) に最も近いワインを rows から探す
const findNearestWineByPC = (rows, px, py, pz) => {
  if (!rows.length) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const d of rows) {
    const d2 = dist2_3d(px, py, pz, d.PC1, d.PC2, d.PC3);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = d;
    }
  }
  return best;
};

export default function SliderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedStore = location.state?.selectedStore;

  // スクロールロック（このページのみ）
  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehaviorY;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehaviorY = "none";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehaviorY = prevOverscroll;
    };
  }, []);

  // 直接来た人は店舗選択へ
  useEffect(() => {
    const saved = localStorage.getItem("selectedStore");
    const cameFromMap = location.state?.from === "map";
    if (!selectedStore && !saved && !cameFromMap) {
      navigate("/store", { replace: true });
    }
  }, [selectedStore, navigate, location.state]);

  /* ---------- UI 状態 ---------- */
  const [acidity, setAcidity] = useState(50);   // PC3
  const [sweetness, setSweetness] = useState(50); // PC2
  const [body, setBody] = useState(50);        // PC1
  const [initializedFromPC, setInitializedFromPC] = useState(false);
  const [initialSliders, setInitialSliders] = useState(null);

  /* ---------- データ読込 & 写像 ---------- */
  const [rows, setRows] = useState([]);
  const [referenceLot, setReferenceLot] = useState(null);
  const [pcMinMax, setPcMinMax] = useState(null);

  // 基準ロットローディング
  useEffect(() => {
    const lotId = getLotId();
    const lot = getReferenceLotById(lotId);

    if (lot) {
      setReferenceLot(lot);
      try {
        localStorage.setItem("referenceLotId", lot.lotId);
      } catch {}
    } else {
      setReferenceLot(null);
    }
  }, []);

  // PCA/UMAP 全体をロード
  useEffect(() => {
    const url = TASTEMAP_POINTS_URL;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;

        const cleaned = (data || [])
          .map((d) => ({
            JAN: String(d.jan_code ?? d.JAN ?? ""),
            // ★ pc1/pc2/pc3 → 無ければ PC1/PC2/PC3
            PC1: num(d.pc1 ?? d.PC1),
            PC2: num(d.pc2 ?? d.PC2),
            PC3: num(d.pc3 ?? d.PC3),
            UMAP1: num(d.umap_x),
            UMAP2: num(d.umap_y),
          }))
          .filter(
            (r) =>
              Number.isFinite(r.PC1) &&
              Number.isFinite(r.PC2) &&
              Number.isFinite(r.PC3) &&
              Number.isFinite(r.UMAP1) &&
              Number.isFinite(r.UMAP2)
          );

        setRows(cleaned);

        if (cleaned.length) {
          const pc1s = cleaned.map((r) => r.PC1);
          const pc2s = cleaned.map((r) => r.PC2);
          const pc3s = cleaned.map((r) => r.PC3);
          setPcMinMax({
            minPC1: Math.min(...pc1s),
            maxPC1: Math.max(...pc1s),
            minPC2: Math.min(...pc2s),
            maxPC2: Math.max(...pc2s),
            minPC3: Math.min(...pc3s),
            maxPC3: Math.max(...pc3s),
          });
        } else {
          setPcMinMax(null);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("SliderPage: umap_coords_c.json の取得に失敗:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 基準ロットの PC を中央50にマッピングしてスライダー初期化
  useEffect(() => {
    if (!referenceLot || !pcMinMax || initializedFromPC) return;

    const { minPC1, maxPC1, minPC2, maxPC2, minPC3, maxPC3 } = pcMinMax;
    const basePC1 = num(referenceLot.pc1);
    const basePC2 = num(referenceLot.pc2);
    const basePC3 = num(referenceLot.pc3);

    const bodySlider = pcToSliderCenter(basePC1, minPC1, basePC1, maxPC1);
    const sweetnessSlider = pcToSliderCenter(basePC2, minPC2, basePC2, maxPC2);
    const aciditySlider = pcToSliderCenter(basePC3, minPC3, basePC3, maxPC3);

    setBody(bodySlider);
    setSweetness(sweetnessSlider);
    setAcidity(aciditySlider);
    setInitialSliders({
      body: bodySlider,
      sweetness: sweetnessSlider,
      acidity: aciditySlider,
    });
    setInitializedFromPC(true);
  }, [referenceLot, pcMinMax, initializedFromPC]);

  const handleGenerate = () => {
    if (!referenceLot || !pcMinMax || !rows.length) return;

    let loggedJan = null;
    const { minPC1, maxPC1, minPC2, maxPC2, minPC3, maxPC3 } = pcMinMax;
    const basePC1 = num(referenceLot.pc1);
    const basePC2 = num(referenceLot.pc2);
    const basePC3 = num(referenceLot.pc3);

    // 初期スライダー位置のままなら、必ず基準ロットのUMAPにピンを立てる
    const isAtInitial =
      initialSliders &&
      acidity === initialSliders.acidity &&
      sweetness === initialSliders.sweetness &&
      body === initialSliders.body;

    if (
      isAtInitial &&
      typeof referenceLot.umap_x === "number" &&
      typeof referenceLot.umap_y === "number"
    ) {
      const umapX = referenceLot.umap_x;
      const umapY = referenceLot.umap_y;

      loggedJan = referenceLot.JAN || null;
      localStorage.setItem(
        "userPinCoords",
        JSON.stringify({
          coordsUMAP: [umapX, umapY],
          version: 3,
          referenceLotId: referenceLot.lotId,
          pcValues: {
            pc1: basePC1,
            pc2: basePC2,
            pc3: basePC3,
          },
          nearestJan: referenceLot.JAN || null,
        })
      );
    } else {
      // 好みを動かした場合は、PC → 最近傍ワイン → そのUMAP
      const pc1Value = sliderToPCCenter(body, minPC1, basePC1, maxPC1);
      const pc2Value = sliderToPCCenter(sweetness, minPC2, basePC2, maxPC2);
      const pc3Value = sliderToPCCenter(acidity, minPC3, basePC3, maxPC3);

      const nearest = findNearestWineByPC(rows, pc1Value, pc2Value, pc3Value);
      if (!nearest) return;

      loggedJan = nearest.JAN || null;
      const umapX = nearest.UMAP1;
      const umapY = nearest.UMAP2;

      localStorage.setItem(
        "userPinCoords",
        JSON.stringify({
          coordsUMAP: [umapX, umapY],
          version: 3,
          referenceLotId: referenceLot.lotId,
          pcValues: {
            pc1: pc1Value,
            pc2: pc2Value,
            pc3: pc3Value,
          },
          nearestJan: nearest.JAN,
        })
      );
    }

    try {
      sessionStorage.setItem("tm_center_on_userpin", "1");
    } catch {}

    if (loggedJan) {
      postAccessLog({
        event_type: "standard_slider",
        jan_code: loggedJan,
      });
    }

    navigate("/map?open=position", { state: { centerOnUserPin: true } });
  };

  /* ---------- スタイル ---------- */
  const pagePad = "16px";
  const cardW = "min(480px, 92svw)";

  const disabled = !referenceLot || !pcMinMax || !rows.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "sans-serif",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PanelHeader
        title="基準のワイン"
        onBack={() => navigate(-1)}
        onClose={() => navigate("/map", { replace: true })}
        icon="bar.svg"
      />

      <div
        style={{
          padding: pagePad,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        {/* 見出し */}
        <p
          style={{
            fontWeight: 700,
            fontSize: 16,
            margin: "8px 0 16px",
            textAlign: "center",
            width: cardW,
          }}
        >
          基準のワインを飲んだ印象は？
        </p>

        {/* 現在のロット表示 */}
        {/*   margin: "8px 0 4px",
        {referenceLot && (
          <p
            style={{
              fontSize: 12,
              color: "#555",
              margin: "0 0 16px",
              textAlign: "center",
              width: cardW,
            }}
          >
            現在のロット：{referenceLot.label}
          </p>
        )}
         */}

        {/* スライダーCSS */}
        <style>{`
          .taste-slider{ appearance:none; -webkit-appearance:none; width:100%; height:6px; background:transparent; margin-top:6px; outline:none; }
          .taste-slider::-webkit-slider-runnable-track{ height:6px; border-radius:9999px; background:var(--range,#e9e9e9); }
          .taste-slider::-moz-range-track{ height:6px; border-radius:9999px; background:var(--range,#e9e9e9); }
          .taste-slider::-webkit-slider-thumb{ -webkit-appearance:none; width:22px; height:22px; border-radius:50%; background:#262626; border:0; box-shadow:0 1px 2px rgba(0,0,0,.25); margin-top:-8px; cursor:pointer; }
          .taste-slider::-moz-range-thumb{ width:22px; height:22px; border-radius:50%; background:#262626; border:0; box-shadow:0 1px 2px rgba(0,0,0,.25); cursor:pointer; }
        `}</style>

        {/* 酸味（PC3） */}
        <div style={{ width: cardW, marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginBottom: 4,
            }}
          >
            <span>← 酸味は控えめが良い</span>
            <span>もっと酸味が欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={acidity}
            onChange={(e) => setAcidity(Number(e.target.value))}
            className="taste-slider"
            style={{ "--range": centerGradient(acidity) }}
          />
        </div>

        {/* 甘み（PC2） */}
        <div style={{ width: cardW, marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginBottom: 4,
            }}
          >
            <span>← こんなに甘味は不要</span>
            <span>もっと甘みが欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={sweetness}
            onChange={(e) => setSweetness(Number(e.target.value))}
            className="taste-slider"
            style={{ "--range": centerGradient(sweetness) }}
          />
        </div>

        {/* コク（ボディ, PC1） */}
        <div style={{ width: cardW, marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              marginBottom: 4,
            }}
          >
            <span>← もっと軽やかが良い</span>
            <span>濃厚なコクが欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={body}
            onChange={(e) => setBody(Number(e.target.value))}
            className="taste-slider"
            style={{ "--range": centerGradient(body) }}
          />
        </div>

        {/* 生成ボタン */}
        <button
          onClick={handleGenerate}
          style={{
            alignSelf: "center",
            marginTop: 40,
            marginBottom: 8,
            width: "min(calc(100svw - 32px), calc(100svh - 34svh))",
            maxWidth: 560,
            padding: "14px 16px",
            lineHeight: 1.2,
            background: "rgb(230,227,219)",
            color: "#000",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: disabled ? "default" : "pointer",
            boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
            WebkitBackdropFilter: "blur(2px)",
            backdropFilter: "blur(2px)",
            opacity: disabled ? 0.6 : 1,
          }}
          disabled={disabled}
        >
          あなたの好みからMAPを生成
        </button>

        {/* 現在のロット表示 */}
        {referenceLot && (
          <p
            style={{
              fontSize: 12,
              color: "#555",
              margin: "20px 0 0",
              textAlign: "center",
              width: cardW,
            }}
          >
            current lot：{referenceLot.label}
          </p>
        )}

      </div>
    </div>
  );
}
