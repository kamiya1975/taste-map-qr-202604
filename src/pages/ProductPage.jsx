// src/pages/ProductPage.jsx
// 商品詳細画面
import React, { useEffect, useMemo, useRef, useState } from "react";
//////import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useParams, useLocation } from "react-router-dom";
import { useSimpleCart } from "../cart/simpleCart";
import { postRating } from "../lib/appRatings";
import {
  fetchWishlistStatus,
  addWishlist,
  removeWishlist,
} from "../lib/appWishlist";
import {
  getClusterRGBA,
  clusterRGBAtoCSS,
  toJapaneseWineType,
  TASTEMAP_POINTS_URL,
  getReferenceLotById,
} from "../ui/constants";
import { getLotId } from "../utils/lot";

const API_BASE = process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_BASE || "";
const PUBLIC_BASE = process.env.PUBLIC_URL || "";

const STORE_CTX_BC = "store_ctx_bus";

/** =========================
 *  ユーティリティ
 * ========================= */
const useJanParam = () => {
  const { jan: routeJan } = useParams();
  const { search, hash } = useLocation();
  return useMemo(() => {
    if (routeJan) return String(routeJan);
    try {
      const params = new URLSearchParams(search);
      const byQuery = params.get("jan");
      if (byQuery) return String(byQuery);
    } catch {}
    const m = (hash || "").match(/#\/products\/([^/?#]+)/);
    return m ? m[1] : "";
  }, [routeJan, search, hash]);
};

const postToParent = (payload) => {
  try {
    window.parent?.postMessage(payload, "*");
  } catch {}
};

//////2026.05.以下1セクション追加
//------------------------------------------------------
// ログ送信関数（共通）
const getQrContextForLog = () => {
  try {
    const searchText =
      window.location.search ||
      (window.location.hash.includes("?")
        ? `?${window.location.hash.split("?")[1]}`
        : "");

    const params = new URLSearchParams(searchText);

    const storeId = Number(params.get("store_id"));
    const importerId = Number(params.get("importer_id"));

    return {
      store_id: Number.isFinite(storeId) && storeId > 0 ? storeId : null,
      importer_id: Number.isFinite(importerId) && importerId > 0 ? importerId : null,
    };
  } catch {
    return { store_id: null, importer_id: null };
  }
};

const postAccessLog = async ({ event_type, jan_code, source }) => {
  if (!event_type || !jan_code) return;

  const ctx = getQrContextForLog();

  const payload = {
    event_type,
    jan_code: String(jan_code),
    session_id: (() => {
      try {
        let sid = sessionStorage.getItem("tm_session_id");
        if (!sid) {
          sid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          sessionStorage.setItem("tm_session_id", sid);
        }
        return sid;
      } catch {
        return null;
      }
    })(),
    store_id: ctx.store_id,
    importer_id: ctx.importer_id,
    source: source || null,
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

// アプリ側ログイン確認（access token 有無）
const isAppLoggedIn = () => {
  try {
    return !!localStorage.getItem("app.access_token");
  } catch {
    return false;
  }
};

const clearScanHints = (jan_code) => {
  const keys = [
    "selectedJAN",
    "lastScannedJAN",
    "scan_last_jan",
    "scanTriggerJAN",
    "scanner_selected_jan",
  ];
  try {
    keys.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch {}
  try {
    localStorage.setItem(
      "product_page_closed",
      JSON.stringify({ jan: jan_code, at: Date.now() })
    );
  } catch {}
};

const notifyParentClosed = (jan_code) => {
  postToParent({ type: "PRODUCT_CLOSED", jan: jan_code, clear: true });
  clearScanHints(jan_code);
  try {
    const bc = new BroadcastChannel("product_bridge");
    bc.postMessage({
      type: "PRODUCT_CLOSED",
      jan: jan_code,
      clear: true,
      at: Date.now(),
    });
    bc.close();
  } catch {}
};

//////2026.05.以下1セクション追加
//------------------------------------------------------
// スライダー追加
const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const dist2_3d = (x1, y1, z1, x2, y2, z2) => {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dz = z1 - z2;
  return dx * dx + dy * dy + dz * dz;
};

const centerGradient = (val) => {
  const base = "#e9e9e9";
  const active = "#b59678";
  const v = Math.max(0, Math.min(100, Number(val)));
  if (v === 50) return base;
  const a = Math.min(50, v);
  const b = Math.max(50, v);
  return `linear-gradient(to right, ${base} 0%, ${base} ${a}%, ${active} ${a}%, ${active} ${b}%, ${base} ${b}%, ${base} 100%)`;
};

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
    const t = (pc - min) / denom;
    return Math.max(0, Math.min(50, t * 50));
  }

  const denom = max - base;
  if (denom <= 0) return 50;
  const t = (pc - base) / denom;
  return Math.max(50, Math.min(100, 50 + t * 50));
};

const sliderToPCCenter = (sliderVal, min, base, max) => {
  const v = Math.max(0, Math.min(100, Number(sliderVal)));
  if (!Number.isFinite(min) || !Number.isFinite(base) || !Number.isFinite(max)) {
    return base || 0;
  }

  if (v <= 50) {
    if (base <= min) return base;
    return min + (base - min) * (v / 50);
  }

  if (max <= base) return base;
  return base + (max - base) * ((v - 50) / 50);
};

const findNearestWineByPC = (rows, px, py, pz) => {
  if (!Array.isArray(rows) || !rows.length) return null;
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
//------------------------------------------------------

/** =========================
 *  飲みたい（☆/★）
 * ========================= */
function HeartButton({ jan_code, value, onChange, size = 28, hidden = false, ctx: ctxProp = "" }) {
  const fav = !!value;
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // 親からの反映（一覧⇄詳細の即時同期用）
    const onMsg = (e) => {
      const { type, jan: targetJan, value, ctx: incomingCtx } = e.data || {};
      if (String(targetJan) !== String(jan_code)) return;
      // ctx が来ている場合のみ、現在の ctx と一致するものだけ採用（遅延混入対策）
      if (incomingCtx != null && String(incomingCtx) !== String(ctxProp || "")) return;
      if (type === "SET_WISHLIST") onChange?.(!!value);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [jan_code, onChange, ctxProp]);

  const toggle = async () => {
    if (busy) return;

    if (!isAppLoggedIn()) {
      alert("飲みたい機能はログインしてからご利用いただけます。");
      try { window.parent?.postMessage({ type: "OPEN_MYACCOUNT" }, "*"); } catch {}
      return;
    }

    const willAdd = !fav;
    setBusy(true);
    // 先にUI更新（楽観）
    onChange?.(willAdd);

    // 2) wishlist ON で rating を触らない（排他しない）

    // 3) DBへ反映（失敗したら戻す）
    let finalWish = willAdd;
    try {
      if (willAdd) await addWishlist(jan_code);
      else await removeWishlist(jan_code);
      // 追加フェッチはしない（遅延・競合を増やすため）
      finalWish = willAdd;
    } catch (e) {
      console.error(e);
      onChange?.(!willAdd);
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }

    // 4) 親へ通知（一覧/Map側の即時同期）
    try {
      window.parent?.postMessage(
        { type: "SET_WISHLIST", jan: jan_code, value: finalWish, ctx: String(ctxProp || "") },
        "*"
      );
    } catch {}
    try {
      const bc = new BroadcastChannel("product_bridge");
      bc.postMessage({ type: "SET_WISHLIST", jan: jan_code, value: finalWish, ctx: String(ctxProp || ""), at: Date.now() });
      bc.close();
    } catch {}
  };

  return (
    <button
      aria-label={fav ? "飲みたい解除" : "飲みたいに追加"}
      onClick={toggle}
      disabled={hidden || busy}
      style={{
        border: "none",
        background: "transparent",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: hidden ? "default" : "pointer",
        visibility: hidden ? "hidden" : "visible",
      }}
      title={fav ? "飲みたいに登録済み" : "飲みたいに追加"}
    >
      <img
        src={`${PUBLIC_BASE}${fav ? "/img/store.svg" : "/img/store2.svg"}`}
        alt=""
        style={{ width: "100%", height: "100%", display: "block" }}
        draggable={false}
      />
    </button>
  );
}

/** =========================
 *  評価（◎）
 * ========================= */
const CircleRating = ({ value, currentRating, onClick, centerColor = "#000" }) => {
  const outerSize = 40;
  const baseSize = 8;
  const ringGap = 3;
  const ringCount = value + 1;

  return (
    <div
      onClick={() => onClick(value)}
      style={{
        position: "relative",
        width: `${outerSize}px`,
        height: `${outerSize}px`,
        margin: "2px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        boxSizing: "border-box",
      }}
    >
      {[...Array(ringCount)].map((_, i) => {
        const size = baseSize + ringGap * 2 * i;
        const selected = value === currentRating;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: `${size}px`,
              height: `${size}px`,
              border: `1.5px solid ${selected ? "#000" : "#bbb"}`,
              borderRadius: "50%",
              boxSizing: "border-box",
              backgroundColor:
                i === 0
                  ? selected
                    ? centerColor
                    : "rgb(150,150,150)"
                  : "transparent",
            }}
          />
        );
      })}
    </div>
  );
};

/** =========================
 *  商品画像（バックエンド image_url_v 優先 → 画像更新を反映）
 * ========================= */
function ProductImage({ product, jan_code, maxHeight = 225 }) {
  const primarySrc =
    product?.image_url_v ||
    product?.image_url ||
    `${PUBLIC_BASE}/img/${jan_code}.png`;

  const [src, setSrc] = useState(primarySrc);
  const [loaded, setLoaded] = useState(false);
  const wasCachedRef = React.useRef(false);
  const imgElRef = React.useRef(null);

  const setImgRef = React.useCallback((node) => {
    if (node)
      wasCachedRef.current = node.complete && node.naturalWidth > 0;
    imgElRef.current = node;
  }, []);

  useEffect(() => {
    setLoaded(false);
    setSrc(
      product?.image_url_v ||
        product?.image_url ||
        `${PUBLIC_BASE}/img/${jan_code}.png`
    );
  }, [product, jan_code]);

  useEffect(() => {
    const img = imgElRef.current;
    if (!img) return;

    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    const onLoad = () => setLoaded(true);
    const onError = () => {
      setLoaded(true);
      setSrc(`${PUBLIC_BASE}/img/placeholder.png`);
    };
    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
    return () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
  }, [src]);

  return (
    <img
      ref={setImgRef}
      src={src}
      alt="商品画像"
      decoding="async"
      loading="eager"
      fetchPriority="high"
      style={{
        maxHeight: maxHeight,
        objectFit: "contain",
        opacity: loaded ? 1 : 0.35,
        transition: wasCachedRef.current ? "none" : "opacity .25s ease",
        WebkitBackfaceVisibility: "hidden",
        transform: "translateZ(0)",
      }}
    />
  );
}

/** =========================
 *  商品説明セクション
 * ========================= */
function ProductInfoSection({ product, jan_code }) {
  if (!product) return null;

  // 追加：表示用 JAN（APIが返す product.jan_code を優先、無ければURLの jan_code）
  const janValue = product?.jan_code || jan_code || "—";

  const detailRows = [
    ["タイプ", toJapaneseWineType(product.wine_type)],
    ["生産者名", product.producer_name || "—"],
    ["容量", product.volume_ml ? `${product.volume_ml}ml` : "—"],
    ["国", product.country || "—"],
    ["産地", product.region || "—"],
    ["品種", product.grape_variety || "—"],
    ["JAN", janValue],
    [
      "成分検査年",
      product.production_year_taste
        ? `${product.production_year_taste}：酒類総合情報センター調べ`
        : "—",
    ],
  ];

  // ECなら ec_* だけ。店舗なら comment だけ。空ならブロックごと非表示（詰める）
  const isEcContext = !!product?.is_ec_product; // ← ec_product ではなく最終判定を使う

  const commentBlocks = [];

  if (isEcContext) {
    // EC：ec_* だけ（1..5）
    for (let i = 1; i <= 5; i++) {
      const t = product?.[`ec_title_${i}`];
      const c = product?.[`ec_comment_${i}`];
      if (!t && !c) continue;
      commentBlocks.push({ title: t, body: c });
    }
  } else {
    // 店舗：comment だけ（title/comment は今回は使わない方針）
    if (product?.comment) {
      commentBlocks.push({ title: "ワインの特徴", body: product.comment });
    }
  }

  const hasComments = commentBlocks.length > 0;

  return (
    <div
      className="pb-safe"
      style={{
        paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* コメントブロック（あるときだけ） */}
      {hasComments &&
        commentBlocks.map((b, idx) => (
          <div
            key={idx}
            style={{
              marginTop: idx === 0 ? 20 : 16,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {b.title && (
              <div style={{ fontWeight: "bold", marginBottom: 4 }}>
                {b.title}
              </div>
            )}
            {b.body && <div>{b.body}</div>}
          </div>
        ))}

      {/* 基本情報 */}
      <div
        style={{
          marginTop: hasComments ? 24 : 12, // コメントが無ければ詰める
          paddingTop: 8,
          paddingBottom: 8,
          borderTop: "1px solid #ccc",
          borderBottom: "1px solid #ccc",
          marginBottom: 0,
        }}
      >

        <div style={{ fontSize: 14, lineHeight: 1.9 }}>
          {detailRows.map(([label, value]) => (
            <div
              key={label}
              style={{ display: "flex", marginTop: 2 }}
            >
              <div style={{ width: 96, flexShrink: 0 }}>{label}</div>
              <div style={{ flex: 1 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 100 }} />
    </div>
  );
}

/** =========================
 *  ProductPage（default export）
 * ========================= */
export default function ProductPage() {
  const jan_code = useJanParam();
//////  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [wish, setWish] = useState(false);
  const [clusterId, setClusterId] = useState(null);

  const [sliderRows, setSliderRows] = useState([]);
  const [sliderPcMinMax, setSliderPcMinMax] = useState(null);
  const [productPoint, setProductPoint] = useState(null);
  const [referenceLot, setReferenceLot] = useState(null);
  const [tasteAcidity, setTasteAcidity] = useState(50);     // PC3
  const [tasteSweetness, setTasteSweetness] = useState(50); // PC2
  const [tasteBody, setTasteBody] = useState(50);           // PC1

  const { search, hash } = useLocation();
  // MapPage が iframe src に付与している ctx を受け取る（店舗コンテキスト混入対策）
  const ctxFromQuery = React.useMemo(() => {
    // HashRouter: search は hash 側の ? を含む（環境によっては hash から取る必要がある）
    try {
      const sp = new URLSearchParams(search || "");
      const v = sp.get("ctx");
      if (v) return String(v);
    } catch {}
    // 念のため hash からも拾う（#/products/:jan?embed=1&ctx=...）
    try {
      const q = (hash || "").split("?")[1] || "";
      const sp2 = new URLSearchParams(q);
      return sp2.get("ctx") ? String(sp2.get("ctx")) : "";
    } catch {}
    return "";
  }, [search, hash]);  

  // 店舗コンテキスト（メイン店舗）: これが変わったら必ず再fetch
  const [mainStoreIdForFetch, setMainStoreIdForFetch] = useState(null);
  // latest-only（古いレスポンスで上書きしない）
  const fetchSeqRef = useRef(0);

  // 親（MapPage）からの店舗変更通知を受ける（同一タブ内でも確実に拾う）
  useEffect(() => {
    const onMsg = (e) => {
      const { type, main_store_id } = e.data || {};
      if (type !== "STORE_CONTEXT_CHANGED") return;
      const n = Number(main_store_id);
      const next = Number.isFinite(n) && n > 0 ? n : null;
      setMainStoreIdForFetch(next);
    };
    window.addEventListener("message", onMsg);

    let bc = null;
    try {
      bc = new BroadcastChannel(STORE_CTX_BC);
      bc.onmessage = (ev) => {
        const { type, main_store_id } = ev.data || {};
        if (type !== "STORE_CONTEXT_CHANGED") return;
        const n = Number(main_store_id);
        const next = Number.isFinite(n) && n > 0 ? n : null;
        setMainStoreIdForFetch(next);
      };
    } catch {}

    // 初期値（未ログイン時のローカルキャッシュ）も拾っておく
    try {
      const rawMain = localStorage.getItem("app.main_store_id");
      const n = Number(rawMain);
      const init = Number.isFinite(n) && n > 0 ? n : null;
      setMainStoreIdForFetch((prev) => (prev == null ? init : prev));
    } catch {}

    return () => {
      window.removeEventListener("message", onMsg);
      try { bc && bc.close(); } catch {}
    };
  }, []);
  // ここまで 再fetch 2026.01.

  //////2026.05.以下1セクション追加
  useEffect(() => {
    const lotId = getLotId();
    const lot = getReferenceLotById(lotId);
    setReferenceLot(lot || null);
  }, []);
  
  // CartContext（ローカル積み → カートで同期）
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState(false);
  const { add } = useSimpleCart();

  // 画面オープン/クローズ通知
  useEffect(() => {
    postToParent({ type: "PRODUCT_OPENED", jan: jan_code });
    postToParent({ type: "REQUEST_STATE", jan: jan_code });
    const onBeforeUnload = () => notifyParentClosed(jan_code);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      notifyParentClosed(jan_code);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [jan_code]);

  // -----バックエンドの商品情報を読む useEffect-----
  useEffect(() => {
    if (!jan_code) return;

    let cancelled = false;
    const controller = new AbortController();
    const seq = ++fetchSeqRef.current; // この effect の世代番号（最後だけ反映）

    const fetchProduct = async () => {
      setLoading(true);
      setProduct(null);

      // main_store_id は state を優先（STORE_CONTEXT_CHANGED で最新化） 2026.01.追加
      // state が無ければ localStorage（未ログイン時）をフォールバック
      let mainId = mainStoreIdForFetch;
      if (mainId == null) {
        try {
          const rawMain = localStorage.getItem("app.main_store_id");
          const n = Number(rawMain);
          mainId = Number.isFinite(n) && n > 0 ? n : null;
        } catch {}
      }
 
      // sub_store_ids は送らない（未ログイン時は main だけ、ログイン時はトークンで sub を見る）
      const qsStr = mainId ? `?main_store_id=${encodeURIComponent(String(mainId))}` : "";

      // app API 用トークン（存在すれば付ける）2026.01.
      let token = "";
      try { token = localStorage.getItem("app.access_token") || ""; } catch {}
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      try {
        const res = await fetch(
          `${API_BASE}/api/app/map-products/${encodeURIComponent(jan_code)}${qsStr}`,
        { signal: controller.signal, headers, cache: "no-store" }
        );
        // 重要：res.ok で早期 return しない（後続の wish/rating 初期化が飛ぶため）
        if (!res.ok) {
          console.warn("商品APIエラー", res.status);
          if (!cancelled) {
            // 古い世代は捨てる
            if (seq !== fetchSeqRef.current) return;
            setProduct((prev) => ({
              ...(prev || {}),
              jan_code,
              // 判定用は「不明」を明示：UIが嘘をつかない
              is_ec_product: prev?.is_ec_product ?? false,
              available_in_selected_stores: prev?.available_in_selected_stores ?? null,
            }));
            setLoading(false);
          }  
        } else {
          const data = await res.json();
          if (!cancelled) {
            if (seq !== fetchSeqRef.current) return;
            setProduct(data);
            setLoading(false);
          }
        }
      } catch (e) {
        if (!cancelled && e.name !== "AbortError") {
          console.error("商品API読込エラー:", e);
          if (seq !== fetchSeqRef.current) return;
          setLoading(false);
        }
        // Abort のときはここで打ち切り（後続の wishlist/rating 初期化も不要）
        if (e?.name === "AbortError") return;
      }

      // wishlist 初期点灯（DB 正）
      try {
        if (!cancelled) {
          if (isAppLoggedIn()) {
            const st = await fetchWishlistStatus(jan_code);
            if (!cancelled) {
              if (seq !== fetchSeqRef.current) return;
              setWish(!!st?.is_wished);
            }
          } else {
            if (seq !== fetchSeqRef.current) return;
            setWish(false);
          }
        }
      } catch {
        if (!cancelled) {
          if (seq !== fetchSeqRef.current) return;
          setWish(false);
        }
      }

      // ローカルの userRatings 読込（従来通り）
      try {
        const ratings = JSON.parse(localStorage.getItem("userRatings") || "{}");
        if (ratings[jan_code]) {
          const meta = ratings[jan_code];
          const val =
            meta?.source === "wish" && Number(meta?.rating) === 1
              ? 0
              : meta?.rating ?? 0;
          if (seq !== fetchSeqRef.current) return;
          setRating(val);
            } else {
          if (seq !== fetchSeqRef.current) return;
          setRating(0);
            }
      } catch {}
    };

    fetchProduct();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [jan_code, mainStoreIdForFetch]);

  // 風味データ（umapData or JSON）から cluster を取得
  useEffect(() => {
    if (!jan_code) return;

    let cancelled = false;

    const findCluster = async () => {
      // 1) まず MapPage が保存した umapData を見る
      try {
        const raw = localStorage.getItem("umapData");
        if (raw) {
          const arr = JSON.parse(raw);
          const hit = (arr || []).find(
            (r) => String(r.jan_code || r.JAN) === String(jan_code)
          );
          if (hit && Number.isFinite(Number(hit.cluster))) {
            if (!cancelled) setClusterId(Number(hit.cluster));
            return;
          }
        }
      } catch (e) {
        console.warn("ProductPage: umapData 読み込み失敗:", e);
      }

      // 2) なければ風味データJSONを直接 fetch
      try {
        const res = await fetch(TASTEMAP_POINTS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        if (cancelled) return;

        const hit = (rows || []).find(
          (r) => String(r.jan_code || r.JAN) === String(jan_code)
        );
        if (hit && Number.isFinite(Number(hit.cluster))) {
          setClusterId(Number(hit.cluster));
        } else {
          setClusterId(null);
        }
      } catch (e) {
        console.error("ProductPage: クラスタ取得に失敗:", e);
        if (!cancelled) setClusterId(null);
      }
    };

    findCluster();

    return () => {
      cancelled = true;
    };
  }, [jan_code]);

  //////2026.05.以下1セクション追加
  // 商品詳細スライダー用：points JSON から PC/UMAP を取得
  useEffect(() => {
    if (!jan_code) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(TASTEMAP_POINTS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        if (cancelled) return;

        const cleaned = (json || [])
          .map((d) => ({
            JAN: String(d.jan_code ?? d.JAN ?? ""),
            PC1: num(d.pc1 ?? d.PC1),
            PC2: num(d.pc2 ?? d.PC2),
            PC3: num(d.pc3 ?? d.PC3),
            UMAP1: num(d.umap_x ?? d.UMAP1),
            UMAP2: num(d.umap_y ?? d.UMAP2),
          }))
          .filter(
            (r) =>
              r.JAN &&
              Number.isFinite(r.PC1) &&
              Number.isFinite(r.PC2) &&
              Number.isFinite(r.PC3) &&
              Number.isFinite(r.UMAP1) &&
              Number.isFinite(r.UMAP2)
          );

        const hit = cleaned.find((r) => String(r.JAN) === String(jan_code));

        setSliderRows(cleaned);
        setProductPoint(hit || null);

        if (cleaned.length) {
          const pc1s = cleaned.map((r) => r.PC1);
          const pc2s = cleaned.map((r) => r.PC2);
          const pc3s = cleaned.map((r) => r.PC3);

          const nextMinMax = {
            minPC1: Math.min(...pc1s),
            maxPC1: Math.max(...pc1s),
            minPC2: Math.min(...pc2s),
            maxPC2: Math.max(...pc2s),
            minPC3: Math.min(...pc3s),
            maxPC3: Math.max(...pc3s),
          };

          setSliderPcMinMax(nextMinMax);

          const refPC1 = num(referenceLot?.pc1);
          const refPC2 = num(referenceLot?.pc2);
          const refPC3 = num(referenceLot?.pc3);

          if (hit && referenceLot) {
            setTasteBody(
              pcToSliderCenter(hit.PC1, nextMinMax.minPC1, refPC1, nextMinMax.maxPC1)
            );
            setTasteSweetness(
              pcToSliderCenter(hit.PC2, nextMinMax.minPC2, refPC2, nextMinMax.maxPC2)
            );
            setTasteAcidity(
              pcToSliderCenter(hit.PC3, nextMinMax.minPC3, refPC3, nextMinMax.maxPC3)
            );
          } else {
            setTasteBody(50);
            setTasteSweetness(50);
            setTasteAcidity(50);
          }
        } else {
          setSliderPcMinMax(null);
          setTasteBody(50);
          setTasteSweetness(50);
          setTasteAcidity(50);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("ProductPage: 商品詳細スライダー用データ取得失敗:", e);
          setSliderRows([]);
          setProductPoint(null);
          setSliderPcMinMax(null);
          setTasteBody(50);
          setTasteSweetness(50);
          setTasteAcidity(50);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jan_code, referenceLot]);

  // 評価の同期（STATE_SNAPSHOT / SET_RATING）は従来通り
  useEffect(() => {
    const onMsgSnapshot = (e) => {
      const { type, jan: targetJan, rating: ratingPayload } = e.data || {};
      if (type !== "STATE_SNAPSHOT") return;
      if (String(targetJan) !== String(jan_code)) return;
      try {
        setRating(Number(ratingPayload?.rating) || 0);
      } catch {}
    };
    window.addEventListener("message", onMsgSnapshot);
    return () => window.removeEventListener("message", onMsgSnapshot);
  }, [jan_code]);

  useEffect(() => {
    const onMsgSet = (e) => {
      const { type, jan: targetJan, rating: payload } = e.data || {};
      if (type !== "SET_RATING") return;
      if (String(targetJan) !== String(jan_code)) return;
      const next =
        payload && Number(payload?.rating) > 0
          ? Number(payload.rating)
          : 0;
      setRating(next);
      try {
        const store = JSON.parse(
          localStorage.getItem("userRatings") || "{}"
        );
        if (next > 0)
          store[jan_code] = {
            rating: next,
            date: payload?.date || new Date().toISOString(),
          };
        else delete store[jan_code];
        localStorage.setItem("userRatings", JSON.stringify(store));
      } catch {}
    };
    window.addEventListener("message", onMsgSet);
    return () => window.removeEventListener("message", onMsgSet);
  }, [jan_code]);

  const handleCircleClick = async (value) => {
    // 1) 未ログインなら評価NG → アラート → マイアカウントパネルを開く
    if (!isAppLoggedIn()) {
      alert("評価機能はログインしてからご利用いただけます。");
      try {
        window.parent?.postMessage({ type: "OPEN_MYACCOUNT" }, "*");
      } catch {}
      return;
    }

    const newRating = value === rating ? 0 : value;

    // 2) UI と localStorage を即時更新
    setRating(newRating);

    // 重要：壊れたJSONで落ちないようにする
    let ratings = {};
    try {
      ratings = JSON.parse(localStorage.getItem("userRatings") || "{}");
      if (!ratings || typeof ratings !== "object") ratings = {};
    } catch {
      ratings = {};
    }

    let payload = null;
    if (newRating === 0) {
      delete ratings[jan_code];
    } else {
      payload = {
        rating: newRating,
        date: new Date().toISOString(),
      };
      ratings[jan_code] = payload;

      // ★が付いていたら外す（排他：DBを正）
      // ※ 失敗したら wish 表示は落とさない（嘘をつかない）
      if (wish) {
        try {
          await removeWishlist(jan_code);
          setWish(false);
          try { window.parent?.postMessage({ type: "SET_WISHLIST", jan: jan_code, value: false }, "*"); } catch {}
          try {
            const bc = new BroadcastChannel("product_bridge");
            bc.postMessage({ type: "SET_WISHLIST", jan: jan_code, value: false, at: Date.now() });
            bc.close();
          } catch {}
        } catch (e) {
          console.warn("removeWishlist failed while rating ON:", e);
        }
      }
    }
    try {
      localStorage.setItem("userRatings", JSON.stringify(ratings));
    } catch {}
    postToParent({
      type: "SET_RATING",
      jan: jan_code,
      rating: payload ? { rating: newRating, date: payload.date } : { rating: 0, date: new Date().toISOString() },
    });

    // 3) バックエンドへも送信
    try {
      // 解除(0)も含めて常にDBへ反映する（バックは 0 を受けるよう修正済み）
      await postRating({ jan_code, rating: newRating });
    } catch (e) {
      console.error(e);
    }
  };

  // 価格・タイプ色などの表示用
  const price = product?.price_inc_tax;
  const priceNum =
    price === null || price === undefined || price === "" ? null : Number(price);
  const displayPrice =
    priceNum !== null && Number.isFinite(priceNum)
      ? `¥${priceNum.toLocaleString()}`
      : null;

  // 選択中店舗にアクティブ取扱があるか（※EC判定には使わない。availabilityLineの「評価履歴」表示用）
  const availableInSelected = product?.available_in_selected_stores;

  // クラスタ色
  const clusterRgba = getClusterRGBA(
    clusterId != null ? clusterId : product?.cluster_id
  );
  const typeColor = clusterRGBAtoCSS(clusterRgba);

  const title =
    product?.name_kana ||
    product?.title ||
    product?.jan_code ||
    "（名称不明）";

  // EC商品かどうか　 is_ec_product で 1本化（これだけを真実にする）
  const isEcContext = !!product?.is_ec_product;
  const canShowCartButton = isEcContext;

  // 価格下の文言（EC / 店舗 / それ以外）
  // 店舗文言は「店名がある」ではなく「選択中店舗で取扱あり」のときだけ出す
  let availabilityLine = null;
  if (isEcContext) {
    availabilityLine = <>この商品はネット購入できます。</>;
  } else if (availableInSelected === true) {
    // 店名はバックの price_store_name に 1本化（価格表示の出典と一致させる）
    // 無い場合は「店舗」とする（誤表示ゼロ優先）
    const storeLabel = product?.price_store_name || "";
    availabilityLine = (
      <>
        この商品はお選びの{storeLabel || "店舗"}でお買い求めいただけます。
        在庫・価格は店頭でご確認ください。
      </>
    );
  } else if (availableInSelected === false) {
    availabilityLine = (
      <>
        現在お選びの店舗ではお取り扱いがありません。
      </>
    );
  } else {
    // availableInSelected が未取得/不明なときは何も出さない（サブ店舗名の誤表示を防ぐ）
    availabilityLine = null;
  }

  const handleAddToCart = async () => {
    // 未ログインなら MyAccount へ誘導（評価ボタンと同じ挙動）
    if (!isAppLoggedIn()) {
      alert("購入機能はログインしてからご利用いただけます。");
      try {
        window.parent?.postMessage({ type: "OPEN_MYACCOUNT" }, "*");
      } catch {}
      return;
    }
    
    try {
      setAdding(true);
      await add({
        jan: jan_code,
        title,
        price: priceNum ?? 0,
        qty: 1,
        volume_ml: Number(product?.volume_ml) || 750,
        imageUrl:
          product?.image_url_v ||
          product?.image_url ||
          `${PUBLIC_BASE}/img/${jan_code}.png`,
      });
      // 親へ「カートが変わった」通知
      try {
        window.parent?.postMessage({ type: "CART_CHANGED" }, "*");
      } catch {}
      try {
        const bc = new BroadcastChannel("cart_bus");
        bc.postMessage({
          type: "CART_CHANGED",
          at: Date.now(),
        });
        bc.close();
      } catch {}

      // 軽いトースト表示
      setToast(true);
      setTimeout(() => setToast(false), 1200);
    } catch (e) {
      alert(`追加に失敗: ${e?.message || e}`);
    } finally {
      setAdding(false);
    }
  };

  //////2026.05.以下1セクションを追加
  //------------------------------------------------------
  const canUseProductSlider =
    !!productPoint &&
    !!referenceLot &&
    !!sliderPcMinMax &&
    Array.isArray(sliderRows) &&
    sliderRows.length > 0;

  const handleProductSliderGenerate = () => {
    if (!canUseProductSlider) return;

    const {
      minPC1,
      maxPC1,
      minPC2,
      maxPC2,
      minPC3,
      maxPC3,
    } = sliderPcMinMax;

    const basePC1 = num(referenceLot?.pc1);
    const basePC2 = num(referenceLot?.pc2);
    const basePC3 = num(referenceLot?.pc3);

    const pc1Value = sliderToPCCenter(tasteBody, minPC1, basePC1, maxPC1);
    const pc2Value = sliderToPCCenter(tasteSweetness, minPC2, basePC2, maxPC2);
    const pc3Value = sliderToPCCenter(tasteAcidity, minPC3, basePC3, maxPC3);

    const nearest =
      tasteBody === 50 && tasteSweetness === 50 && tasteAcidity === 50
        ? productPoint
        : findNearestWineByPC(sliderRows, pc1Value, pc2Value, pc3Value);

    if (!nearest) return;

    postAccessLog({
      event_type: "product_slider",
      jan_code: nearest.JAN,
      source: "product_detail",
    });

    localStorage.setItem(
      "userPinCoords",
      JSON.stringify({
        coordsUMAP: [nearest.UMAP1, nearest.UMAP2],
        version: 4,
        source: "product_slider",
        baseJan: jan_code,
        pcValues: {
          pc1: pc1Value,
          pc2: pc2Value,
          pc3: pc3Value,
        },
        nearestJan: nearest.JAN,
      })
    );

    try {
      sessionStorage.setItem("tm_center_on_userpin", "1");
    } catch {}

    postToParent({
      type: "PRODUCT_SLIDER_GENERATED",
      jan: jan_code,
      nearestJan: nearest.JAN,
      centerOnUserPin: true,
    });

    try {
      const bc = new BroadcastChannel("product_bridge");
      bc.postMessage({
        type: "PRODUCT_SLIDER_GENERATED",
        jan: jan_code,
        nearestJan: nearest.JAN,
        centerOnUserPin: true,
        at: Date.now(),
      });
      bc.close();
    } catch {}
  };
  //------------------------------------------------------

  if (loading && !product) {
    return <div style={{ padding: 16 }}>読み込み中です…</div>;
  }
  if (!product) {
    return <div style={{ padding: 16 }}>商品が見つかりませんでした。</div>;
  }

  return (
    <div
      className="pb-safe fill-screen"
      style={{
        height: "100%",
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        maxWidth: 500,
        margin: "0 auto",
        padding: 16,
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* 商品画像 */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <ProductImage product={product} jan_code={jan_code} maxHeight={225} />
      </div>

      {/* 商品名 */}
      <h2
        style={{
          margin: "8px 0",
          fontWeight: "bold",
          fontSize: 16,
        }}
      >
        {title}
      </h2>

      {/* タイプマーク＋価格＋「どの店舗の商品か」 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          margin: "4px 0 12px 0",
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            backgroundColor: typeColor,
            borderRadius: "50%",
            marginRight: 8,
            display: "inline-block",
            marginTop: 4,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            {displayPrice || null}
          </div>

          {availabilityLine && (
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                lineHeight: 1.6,
                color: "#555",
              }}
            >
              {availabilityLine}
            </div>
          )}
        </div>
      </div>

      {/* カートに入れる（EC対象商品のときだけ表示） */}
      {canShowCartButton && (
        <div style={{ margin: "8px 0 16px" }}>
          <button
            onClick={handleAddToCart}
            disabled={adding}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "8px 20px",
              background: "rgb(230,227,219)", // SliderPage と統一
              color: "#000",
              border: "none",
              borderRadius: 10,
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1,
              cursor: adding ? "default" : "pointer",
              boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
              WebkitBackdropFilter: "blur(2px)",
              backdropFilter: "blur(2px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: adding ? 0.7 : 1,
            }}
          >
            <img
              src={`${PUBLIC_BASE}/img/icon-cart2.png`}
              alt="cart"
              style={{
                width: 40,
                height: 40,
                objectFit: "contain",
                display: "block",
              }}
            />
            カートに入れる
          </button>

          {toast && (
            <div
              role="status"
              style={{
                marginTop: 8,
                fontSize: 20,
                background: "#111",
                color: "#fff",
                display: "inline-block",
                padding: "6px 10px",
                borderRadius: 8,
              }}
            >
              カートに入れました
            </div>
          )}
        </div>
      )}

      {/* 評価（◎） */}
      <div
        style={{
          marginTop: 24,
          paddingTop: 8,
          paddingBottom: 8,
          borderTop: "1px solid #ccc",
          borderBottom: "1px solid #ccc",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* 左：飲みたい★ */}
          <div
            style={{
              flex: "0 0 64px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 4px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#666",
                alignSelf: "flex-start",
                lineHeight: 1,
                position: "relative",
                top: "-11px",
                marginLeft: "10px",
              }}
            >
              {"飲みたい"}
            </div>
            <HeartButton jan_code={jan_code} value={wish} onChange={setWish} size={28} ctx={ctxFromQuery} />
          </div>
          <div
            style={{
              width: 1,
              background: "#d9d9d9",
              marginLeft: "4px",
              marginRight: "12px",
              alignSelf: "stretch",
            }}
          />
          {/* 右：評価◎ */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                color: "#666",
                padding: "0 4px",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  flex: 1,
                  textAlign: "center",
                  marginLeft: -175,
                }}
              >
                イマイチ
              </span>
              <span
                style={{
                  flex: "0 0 60px",
                  textAlign: "right",
                  marginLeft: 0,
                }}
              >
                好き
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                paddingRight: 4,
                maxWidth: 320,
              }}
            >
              {[1, 2, 3, 4, 5].map((v) => (
                <CircleRating
                  key={v}
                  value={v}
                  currentRating={rating}
                  onClick={handleCircleClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 商品詳細スライダー */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          paddingBottom: 16,
          borderBottom: "1px solid #ccc",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          このワインを基準に好みを調整
        </div>

        <style>{`
          .product-taste-slider{ appearance:none; -webkit-appearance:none; width:100%; height:6px; background:transparent; margin-top:6px; outline:none; }
          .product-taste-slider::-webkit-slider-runnable-track{ height:6px; border-radius:9999px; background:var(--range,#e9e9e9); }
          .product-taste-slider::-moz-range-track{ height:6px; border-radius:9999px; background:var(--range,#e9e9e9); }
          .product-taste-slider::-webkit-slider-thumb{ -webkit-appearance:none; width:22px; height:22px; border-radius:50%; background:#262626; border:0; box-shadow:0 1px 2px rgba(0,0,0,.25); margin-top:-8px; cursor:pointer; }
          .product-taste-slider::-moz-range-thumb{ width:22px; height:22px; border-radius:50%; background:#262626; border:0; box-shadow:0 1px 2px rgba(0,0,0,.25); cursor:pointer; }
        `}</style>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>← 酸味は控えめが良い</span>
            <span>もっと酸味が欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={tasteAcidity}
            onChange={(e) => setTasteAcidity(Number(e.target.value))}
            className="product-taste-slider"
            style={{ "--range": centerGradient(tasteAcidity) }}
            disabled={!canUseProductSlider}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>← こんなに甘味は不要</span>
            <span>もっと甘みが欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={tasteSweetness}
            onChange={(e) => setTasteSweetness(Number(e.target.value))}
            className="product-taste-slider"
            style={{ "--range": centerGradient(tasteSweetness) }}
            disabled={!canUseProductSlider}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>← もっと軽やかが良い</span>
            <span>濃厚なコクが欲しい →</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={tasteBody}
            onChange={(e) => setTasteBody(Number(e.target.value))}
            className="product-taste-slider"
            style={{ "--range": centerGradient(tasteBody) }}
            disabled={!canUseProductSlider}
          />
        </div>

        <button
          onClick={handleProductSliderGenerate}
          disabled={!canUseProductSlider}
          style={{
            width: "100%",
            padding: "12px 16px",
            background: "rgb(230,227,219)",
            color: "#000",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: canUseProductSlider ? "pointer" : "default",
            boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
            opacity: canUseProductSlider ? 1 : 0.6,
          }}
        >
          この調整でMAPにピンを打つ
        </button>
      </div>

      {/* 説明＋基本情報 */}
      <ProductInfoSection product={product} jan_code={jan_code} />
    </div>
  );
}
