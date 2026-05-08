// src/pages/MapPage.jsx
// Map（DeckGL）＋ 下から出る各パネル/Drawerの統括画面
// 主な責務：
//  - data（打点：points）を読み込み → normalizePoints() で JAN/座標/cluster を正規化して MapCanvas に渡す
//  - allowedJansSet / storeJansSet / ecOnlyJansSet を API から取得し、表示・EC判定を制御
//  - isSearchOpen / isRatedOpen / isMyPageOpen / cartOpen ... など 全パネルの開閉状態を一元管理
//  - 商品詳細は Drawer + iframe(ProductPage) で開き、飲みたい/評価/カート の反映をしている

//////2026.04.既存先頭2行を以下2行と置換え
import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Drawer from "@mui/material/Drawer";

import MapGuidePanelContent from "../components/panels/MapGuidePanelContent";
import SearchPanel from "../components/panels/SearchPanel";
import BarcodeScanner from "../components/BarcodeScanner";
import RatedPanel from "../components/panels/RatedPanel";
import MyAccountPanelContent from "../components/panels/MyAccountPanelContent";
import MapCanvas from "../components/map/MapCanvas";
import PanelHeader from "../components/ui/PanelHeader";
import StorePanelContent from "../components/panels/StorePanelContent";
import FaqPanelContent from "../components/panels/FaqPanelContent";
import MyPagePanelContent from "../components/panels/MyPagePanelContent";
import MilesPanelContent from "../components/panels/MilesPanelContent";
import ClusterPalettePanel from "../components/panels/ClusterPalettePanel";
import SimpleCartPanel from "../components/panels/SimpleCartPanel";
import TastePositionPanelContent from "../components/panels/TastePositionPanelContent";
import RefreshPanelContent from "../components/panels/RefreshPanelContent";
import { useSimpleCart } from "../cart/simpleCart";
import {
  drawerModalProps,
  paperBaseStyle,
  ZOOM_LIMITS,
  INITIAL_ZOOM,
  CENTER_Y_OFFSET,
  DRAWER_HEIGHT,
  API_BASE,
  TASTEMAP_POINTS_URL,
  getReferenceLotById,
  OFFICIAL_STORE_ID,
} from "../ui/constants";
import { getLotId } from "../utils/lot";
import { getCurrentMainStoreIdSafe } from "../utils/store";
import TermsPage from "./TermsPage";

//---------------------------------------------------------------------------------
// EC許可コンテキストのため（カートパネルボタンの表示/非表示）
const getCurrentSubStoreIdsFromStorage = () => {
  const tryParseIds = (raw) => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
      if (Array.isArray(v?.sub_store_ids)) return v.sub_store_ids.map(Number).filter(Number.isFinite);
      if (Array.isArray(v?.subStoreIds)) return v.subStoreIds.map(Number).filter(Number.isFinite);
    } catch {}
    return [];
  };

  try {
    // StorePanelContent が書いているキー
    const keys = ["sub_store_ids", "app.sub_store_ids", "selectedSubStoreIds"];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      const ids = tryParseIds(raw);
      if (ids.length) return ids;
    }
  } catch {}
  return [];
};
// EC許可コンテキスト（カートパネルボタンの表示/非表示）：main==公式 or subに公式
const isEcEnabledInContext = (mainStoreId, subStoreIds) => {
  const main = Number(mainStoreId);
  const subs = Array.isArray(subStoreIds) ? subStoreIds.map(Number) : [];
  return main === OFFICIAL_STORE_ID || subs.includes(OFFICIAL_STORE_ID);
};

//---------------------------------------------------------------------------------
// 店舗コンテキストKey（iframe再読み込み判定用） 
const getStoreContextKeyFromStorage = () => {
  let mainStoreId = null;
  try {
    mainStoreId = getCurrentMainStoreIdSafe();
  } catch {}

  let hasToken = false;
  try {
    hasToken = !!(localStorage.getItem("app.access_token") || "");
  } catch {}

  return [
    `m=${Number(mainStoreId) || 0}`,
    `t=${hasToken ? 1 : 0}`,
  ].join("|");
};

//////2026.05.以下1セクション追加
//---------------------------------------------------------------------------------
// QR文脈保存（QR専用）
// - 既存の main_store / selectedStore / app.main_store_id とは混ぜない
// - /#/slider → /#/map のようにURLから store_id/importer_id が消えても復元する
const QR_CONTEXT_KEY = "tm_qr_context_v1";

function readQrContextSnapshot() {
  try {
    const raw = sessionStorage.getItem(QR_CONTEXT_KEY);
    if (!raw) return null;

    const s = JSON.parse(raw);
    const mode = s?.mode === "store" || s?.mode === "importer" ? s.mode : null;
    if (!mode) return null;

    const storeId = Number(s?.store_id);
    const importerId = Number(s?.importer_id);

    if (mode === "store") {
      if (!Number.isFinite(storeId) || storeId <= 0) return null;
      return {
        mode: "store",
        store_id: storeId,
        importer_id: null,
        context_name: s?.context_name || "",
        saved_at: s?.saved_at || null,
      };
    }

    if (mode === "importer") {
      if (!Number.isFinite(importerId) || importerId <= 0) return null;
      return {
        mode: "importer",
        store_id: null,
        importer_id: importerId,
        context_name: s?.context_name || "",
        saved_at: s?.saved_at || null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function writeQrContextSnapshot(ctx) {
  try {
    if (!ctx || (ctx.mode !== "store" && ctx.mode !== "importer")) return;

    const snap = {
      mode: ctx.mode,
      store_id: ctx.mode === "store" ? Number(ctx.store_id) : null,
      importer_id: ctx.mode === "importer" ? Number(ctx.importer_id) : null,
      context_name: ctx.context_name || "",
      saved_at: new Date().toISOString(),
    };

    sessionStorage.setItem(QR_CONTEXT_KEY, JSON.stringify(snap));
  } catch {}
}

//---------------------------------------------------------------------------------
// スナップショット2
// ALLOWED_SNAPSHOT =どれを描くか　（どの点を表示していいか ＋ EC可否 の保存版）対象：MapPage
const ALLOWED_SNAPSHOT_KEY = "tm_allowed_snapshot_v1";

function readAllowedSnapshot() {
  try {
    const raw = localStorage.getItem(ALLOWED_SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);

    const allowed = Array.isArray(s?.allowedJans) ? s.allowedJans.map(String) : null;
    const ecOnly  = Array.isArray(s?.ecOnlyJans) ? s.ecOnlyJans.map(String) : [];
    const store   = Array.isArray(s?.storeJans) ? s.storeJans.map(String) : [];

    if (!allowed || allowed.length === 0) return null;

    return {
      allowedJans: allowed,
      ecOnlyJans: ecOnly,
      storeJans: store,
      mainStoreEcActive: typeof s?.mainStoreEcActive === "boolean" ? s.mainStoreEcActive : null,
      ecEnabledInContext: !!s?.ecEnabledInContext,
      savedAt: s?.savedAt || null,
    };
  } catch {
    return null;
  }
}

function writeAllowedSnapshot(payload) {
  try {
    const snap = {
      allowedJans: payload.allowedJans || null,
      ecOnlyJans: payload.ecOnlyJans || [],
      storeJans: payload.storeJans || [],
      mainStoreEcActive: typeof payload.mainStoreEcActive === "boolean" ? payload.mainStoreEcActive : null,
      ecEnabledInContext: !!payload.ecEnabledInContext,
      savedAt: new Date().toISOString(),
    };
    if (Array.isArray(snap.allowedJans) && snap.allowedJans.length > 0) {
      localStorage.setItem(ALLOWED_SNAPSHOT_KEY, JSON.stringify(snap));
    }
  } catch {}
}

//---------------------------------------------------------------------------------
// points 正規化（入口で吸収）
function normalizePointRow(row) {
  const toNumOrNull = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // JAN: points.csv 由来の揺れを吸収
  const jan =
    row?.jan_code ??
    row?.jan ??
    row?.JAN ??
    row?.barcode ??
    row?.BARCODE ??
    null;

  // 座標: umap_x/y or UMAP1/2 or x/y を吸収（float化）
  const xRaw = row?.umap_x ?? row?.UMAP1 ?? row?.x ?? row?.X ?? null;
  const yRaw = row?.umap_y ?? row?.UMAP2 ?? row?.y ?? row?.Y ?? null;

  const umap_x = toNumOrNull(xRaw);
  const umap_y = toNumOrNull(yRaw);

  // cluster: 数値化（なければ null）
  const cRaw = row?.cluster ?? row?.CLUSTER ?? null;
  const cluster = toNumOrNull(cRaw);

  return {
    ...row, // 既存項目は保持（他ロジックを壊さない）
    jan_code: jan === null || jan === undefined ? "" : String(jan).trim(),
    umap_x,
    umap_y,
    cluster,
  };
}

function normalizePoints(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(normalizePointRow)
    // JANが空 or 座標が数値でない行は落とす（描画事故を防ぐ）
    .filter((d) => d.jan_code && Number.isFinite(d.umap_x) && Number.isFinite(d.umap_y));
}
// ここまでが正規化ユーティリティ

//---------------------------------------------------------------------------------
// 任意のオブジェクトから JAN を安全に取り出す共通ヘルパー
const getJanFromItem = (item) => {
  if (!item) return "";
  const jan = item.jan_code ?? item.JAN ?? item.jan ?? null;
  return jan ? String(jan) : "";
};

//---------------------------------------------------------------------------------
// メイン店舗の EC有効フラグをローカルから推定（JSONでも文字列でも耐える）
const getCurrentMainStoreEcActiveFromStorage = () => {
  try {
    const raw =
      localStorage.getItem("selectedStore") ||
      localStorage.getItem("main_store");
    if (!raw) return null;

    let s;
    try {
      s = JSON.parse(raw);
    } catch {
      // JSONでない（"1"等）ならオブジェクト情報が無いので判定不能
      return null;
    }

    const v =
      s?.ec_active ??
      s?.ecActive ??
      s?.main_store_ec_active ??
      s?.mainStoreEcActive ??
      null;

    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  } catch (e) {
    console.warn("getCurrentMainStoreEcActiveFromStorage error:", e);
  }
  return null;
};

//---------------------------------------------------------------------------------
// rated-panel（DB正）スナップショット取得
// - rating も同時に取れれば userRatings も同期
async function fetchRatedPanelSnapshot({ apiBase, token }) {
  if (!token) return null;
  const url = `${apiBase}/api/app/rated-panel`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`rated-panel HTTP ${res.status}`);
  const json = await res.json();
  return json;
}

function parseRatedPanelItems(json) {
  // 返却形式の揺れに強くする（items / data / results など）
  const items =
    Array.isArray(json?.items) ? json.items :
    Array.isArray(json?.data) ? json.data :
    Array.isArray(json?.results) ? json.results :
    [];

  const nextRatings = {};
  const nextFav = {};

  for (const it of items) {
    const jan = String(it?.jan_code ?? it?.jan ?? it?.JAN ?? "").trim();
    if (!jan) continue;

    // rating（あれば同期）
    const r = Number(it?.rating ?? it?.score ?? 0) || 0;
    const dt =
      it?.created_at ??
      it?.rated_at ??
      it?.date ??
      null;
    if (r > 0) {
      nextRatings[jan] = { rating: r, date: dt || new Date().toISOString() };
    }

    // wishlist（飲みたい）
    // wished / is_wished / wishlist / wanted など揺れ吸収
    const wishedRaw =
      it?.wished ??
      it?.is_wished ??
      it?.wishlist ??
      it?.wanted ??
      it?.wish ??
      false;
    const wished =
      wishedRaw === true ||
      wishedRaw === 1 ||
      wishedRaw === "1" ||
      wishedRaw === "true";

    if (wished) {
      nextFav[jan] = { addedAt: it?.wished_at ?? it?.created_at ?? new Date().toISOString() };
    }
  }

  return { nextRatings, nextFav };
}

//---------------------------------------------------------------------------------
// allowed-jans 取得エラー時に表示
let allowedJansErrorShown = false;

const showAllowedJansErrorOnce = () => {
  if (allowedJansErrorShown) return;
  allowedJansErrorShown = true;
  try {
    alert("allowed-jans の取得に失敗しました。表示点が一時的に減ることがあります。再読み込みしてください。");
  } catch (e) {
    console.warn("allowed-jans error (alert failed)", e);
  }
};

//////2026.04.以下の4行を追加（位置情報）
//---------------------------------------------------------------------------------
// 位置キャッシュ
const TM_LAST_LOCATION_KEY = "tm_last_location";
const LOCATION_TTL_MS = 30 * 60 * 1000; // 30分

//////2026.04.以下の1セクションを追加（位置情報）
//---------------------------------------------------------------------------------
// 位置取得（silent優先）
function getCachedLocation() {
  try {
    const raw = localStorage.getItem(TM_LAST_LOCATION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocation(loc) {
  try {
    localStorage.setItem(TM_LAST_LOCATION_KEY, JSON.stringify(loc));
  } catch {}
}

function shouldRefreshLocation(loc) {
  if (!loc?.located_at) return true;
  const last = new Date(loc.located_at).getTime();
  return Date.now() - last > LOCATION_TTL_MS;
}

function fetchLocationSilently() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          located_at: new Date().toISOString(),
        };
        saveLocation(loc);
        resolve(loc);
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        maximumAge: LOCATION_TTL_MS,
        timeout: 3000,
      }
    );
  });
}

//////2026.04.以下の1セクションを追加（アクセスログ）
//---------------------------------------------------------------------------------
// アクセスログ共通
const ACCESS_LOG_SESSION_KEY = "tm_access_log_session_id";

function getOrCreateAccessLogSessionId() {
  try {
    let sid = sessionStorage.getItem(ACCESS_LOG_SESSION_KEY);
    if (sid) return sid;

    sid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    sessionStorage.setItem(ACCESS_LOG_SESSION_KEY, sid);
    return sid;
  } catch {
    return null;
  }
}

function readAccessLogContextFromSearch(search) {
  // 1) URLの store_id / importer_id を優先
  try {
    const params = new URLSearchParams(search || "");
    const src = params.get("src") || null;

    const rawStoreId = params.get("store_id");
    const rawImporterId = params.get("importer_id");

    const storeIdNum = rawStoreId != null ? Number(rawStoreId) : null;
    const importerIdNum = rawImporterId != null ? Number(rawImporterId) : null;

    const store_id =
      Number.isFinite(storeIdNum) && storeIdNum > 0 ? storeIdNum : null;

    const importer_id =
      Number.isFinite(importerIdNum) && importerIdNum > 0 ? importerIdNum : null;

    if (store_id || importer_id) {
      return { src, store_id, importer_id };
    }

    // 2) URLに無ければ QR文脈 snapshot を見る
    const raw = sessionStorage.getItem("tm_qr_context_v1");
    if (raw) {
      const ctx = JSON.parse(raw);

      const snapStoreId = Number(ctx?.store_id);
      const snapImporterId = Number(ctx?.importer_id);

      return {
        src,
        store_id:
          Number.isFinite(snapStoreId) && snapStoreId > 0 ? snapStoreId : null,
        importer_id:
          Number.isFinite(snapImporterId) && snapImporterId > 0 ? snapImporterId : null,
      };
    }

    return { src, store_id: null, importer_id: null };
  } catch {
    return { src: null, store_id: null, importer_id: null };
  }
}

function buildSearchWithoutQrSrc(search) {
  try {
    const params = new URLSearchParams(search || "");
    params.delete("src");
    const s = params.toString();
    return s ? `?${s}` : "";
  } catch {
    return "";
  }
}

async function sendAccessLog({
  event_type,
  jan_code,
  source = null,
  search = "",
}) {
  try {
    if (!event_type || !jan_code) return;

    const ctx = readAccessLogContextFromSearch(search);
    const payload = {
      event_type,
      jan_code: String(jan_code),
      session_id: getOrCreateAccessLogSessionId(),
      store_id: ctx.store_id,
      importer_id: ctx.importer_id,
      source: event_type === "product_open" ? source || null : null,
    };

    // MapPage で保持している位置情報キャッシュを流用
    try {
      const raw = localStorage.getItem("tm_last_location");
      if (raw) {
        const parsed = JSON.parse(raw);
        const lat = Number(parsed?.latitude);
        const lon = Number(parsed?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          payload.latitude = lat;
          payload.longitude = lon;
        }
      }
    } catch {}

    await fetch(`${API_BASE}/api/app/access-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (e) {
    console.warn("[access-log] send failed:", e);
  }
}

//---------------------------------------------------------------------------------
// 共通のパース小ユーティリティ（先に定義しておく）
function parseAllowedJansResponse(json) {
  const storeArr =
    Array.isArray(json?.store_jans) ? json.store_jans :
    Array.isArray(json?.allowed_store_jans) ? json.allowed_store_jans :
    Array.isArray(json?.storeJans) ? json.storeJans :
    null;

  const allowedArrRaw =
    Array.isArray(json?.allowed_jans) ? json.allowed_jans :
    Array.isArray(json?.jans) ? json.jans :
    storeArr;

  let ecOnlyArr = [];
  if (Array.isArray(json?.ec_only_jans)) ecOnlyArr = json.ec_only_jans;
  else if (Array.isArray(json?.ec_jans)) ecOnlyArr = json.ec_jans;

  const mainStoreEcActive =
    typeof json?.main_store_ec_active === "boolean"
      ? json.main_store_ec_active
      : null;

  const allowedArr = Array.from(new Set([
    ...(allowedArrRaw || []),
    ...ecOnlyArr,
  ].map(String)));

  const wishArr =
    Array.isArray(json?.wish_jans) ? json.wish_jans :
    Array.isArray(json?.wishJans) ? json.wishJans :
    [];
  
  // ここを storeArr ベースにする（最重要）
  const storeJans = Array.isArray(storeArr) ? storeArr.map(String) : [];

  return { allowedJans: allowedArr, ecOnlyJans: ecOnlyArr.map(String), storeJans, mainStoreEcActive, wishJans: wishArr.map(String).filter(Boolean) };
}

//---------------------------------------------------------------------------------
// 指定店舗IDの allowed_jans を取得する共通ヘルパー（未ログイン想定）
async function fetchAllowedJansForStore(storeId) {
  if (storeId === null || storeId === undefined) {
    return { allowedJans: null, ecOnlyJans: null, storeJans: null, mainStoreEcActive: null };
  }

  // 互換：古い0運用が残っていたら公式Shop(1)へ丸める
  const sid = Number(storeId) > 0 ? Number(storeId) : OFFICIAL_STORE_ID;

  const params = new URLSearchParams();
  params.set("stores", String(sid));
  params.set("include_ec", "true");

  // 実在店舗（id > 0）のときだけ main_store_id を付ける
  params.set("main_store_id", String(sid)); // 常に付けてOK（sidは必ず>0）

  const res = await fetch(`${API_BASE}/api/app/allowed-jans?${params.toString()}`, { cache: "no-store" });  
  if (!res.ok) {
    throw new Error(`allowed-jans(stores=${storeId}) HTTP ${res.status}`);
  }

  const json = await res.json();
  const { allowedJans, ecOnlyJans, storeJans, mainStoreEcActive } =
    parseAllowedJansResponse(json);
  return { allowedJans, ecOnlyJans, storeJans, mainStoreEcActive };
}
//---------------------------------------------------------------------------------
// メイン店舗（＋ログイン状態）に応じて allowed_jans を取得
//    - 未ログイン: ローカルにメイン店舗IDがあれば /allowed-jans?stores=...&include_ec=true
//                  メイン店舗IDが無ければ null（= フィルタ無し）
//    - ログイン済み: /allowed-jans/auto を呼び、失敗時のみ null（= フィルタ無し）
async function fetchAllowedJansAuto() {
  const mainStoreId = getCurrentMainStoreIdSafe();

  let token = "";
  try {
    token = localStorage.getItem("app.access_token") || "";
  } catch {}

  // ① 未ログイン or トークンなし
  if (!token) {
      try {
        const { allowedJans, ecOnlyJans, storeJans, mainStoreEcActive } =
          await fetchAllowedJansForStore(mainStoreId);
        const ecEnabledInContext = Number(mainStoreId) === OFFICIAL_STORE_ID;

        return { 
          allowedJans,
          ecOnlyJans: ecOnlyJans || [],
          storeJans: storeJans || [],
          mainStoreEcActive,
          ecEnabledInContext,
          wishJans: [],
        };
      } catch (e) {
        console.warn(
          `allowed-jans(stores=${mainStoreId}) の取得に失敗 → 全件表示にフォールバック`,
          e
        );
        showAllowedJansErrorOnce();
        return {
          allowedJans: null,
          ecOnlyJans: [],
          storeJans: [],
          mainStoreEcActive: null,
          ecEnabledInContext: Number(mainStoreId) === OFFICIAL_STORE_ID,
        };
      }
    }

  // ② ログイン済み
  try {
    const url = `${API_BASE}/api/app/allowed-jans/auto`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const json = await res.json();
      const { allowedJans, ecOnlyJans, storeJans, mainStoreEcActive, wishJans } =
        parseAllowedJansResponse(json);
      const subStoreIds = getCurrentSubStoreIdsFromStorage();
      const ecEnabledInContext = isEcEnabledInContext(mainStoreId, subStoreIds);

      return {
        allowedJans,
        ecOnlyJans: ecOnlyJans || [],
        storeJans: storeJans || [],
        mainStoreEcActive,
        ecEnabledInContext,
        wishJans: wishJans || [],
      };
    } else {
      console.warn(
        `allowed-jans/auto HTTP ${res.status} → フィルタ無しで続行`
      );
      showAllowedJansErrorOnce();
      return {
        allowedJans: null,
        ecOnlyJans: [],
        storeJans: [],
        mainStoreEcActive: null,
        ecEnabledInContext: isEcEnabledInContext(mainStoreId, getCurrentSubStoreIdsFromStorage()),
      };
    }
  } catch (e) {
    console.warn("allowed-jans/auto の取得に失敗 → フィルタ無しで続行", e);
    showAllowedJansErrorOnce();
    return {
      allowedJans: null,
      ecOnlyJans: [],
      storeJans: [],
      mainStoreEcActive: null,
      ecEnabledInContext: isEcEnabledInContext(mainStoreId, getCurrentSubStoreIdsFromStorage()),
    };
  }
}

//---------------------------------------------------------------------------------
const REREAD_LS_KEY = "tm_reread_until";
const CENTER_Y_FRAC = 0.85; // 0.0 = 画面最上端, 0.5 = 画面の真ん中
const ANCHOR_JAN = "4964044046324";
const UI_Z_TOP = 2400;

function getYOffsetWorld(zoom, fracFromTop = CENTER_Y_FRAC) {
  const worldPerPx = 1 / Math.pow(2, Number(zoom) || 0);
  let hPx = 0;
  if (typeof window !== "undefined") {
    hPx =
      window.visualViewport && window.visualViewport.height
        ? window.visualViewport.height
        : window.innerHeight || 0;
  }
  return (0.5 - fracFromTop) * hPx * worldPerPx;
}

//==================================================================================
//==================================================================================
function MapPage() {
  // Drawer を “背面（Map）に操作を通す” 共通設定
  const passThroughDrawerSx = useMemo(() => ({ pointerEvents: "none" }), []);
  const passThroughBackdropProps = useMemo(
    () => ({ style: { background: "transparent", pointerEvents: "none" } }),
    []
  );
  const passThroughPaperSx = useMemo(() => ({ pointerEvents: "auto" }), []);
  const location = useLocation();
  const navigate = useNavigate();
  //////2026.04.以下1行を追加
  const { jan: routeJan } = useParams();

  // ログインユーザー名（ニックネーム）表示用
  const [userDisplayName, setUserDisplayName] = useState("");

  //---------------------------------------------------------------------------------
  useEffect(() => {
    const readUserFromStorage = () => {
      try {
        const appUserStr = localStorage.getItem("app.user");
        if (appUserStr) {
          const u = JSON.parse(appUserStr);
          const name = (u && (u.display_name || u.nickname || u.name)) || "";
          setUserDisplayName(name);
          return;
        }
        // 旧キーのフォールバック
        const legacy = localStorage.getItem("user.nickname") || "";
        setUserDisplayName(legacy);
      } catch {
        setUserDisplayName("");
      }
    };

    readUserFromStorage();

    // フォーカス戻りや別タブでのログイン変更を拾う
    window.addEventListener("focus", readUserFromStorage);
    window.addEventListener("storage", readUserFromStorage);
    return () => {
      window.removeEventListener("focus", readUserFromStorage);
      window.removeEventListener("storage", readUserFromStorage);
    };
  }, []);

  //---------------------------------------------------------------------------------
  // ロット → 基準ワイン座標
  const lotId = getLotId();
  const reference = useMemo(() => getReferenceLotById(lotId), [lotId]);

  const basePoint = useMemo(
    () =>
      reference
        ? {
            x: reference.umap_x,
            y: reference.umap_y,
            lotId: reference.lotId,
          }
        : null,
    [reference]
  );

  //---------------------------------------------------------------------------------
  // ---- Refs ----
  const didInitialCenterRef = useRef(false);
  const iframeRef = useRef(null);
  const autoOpenOnceRef = useRef(false);
  const lastCommittedRef = useRef({ code: "", at: 0 });
  const unknownWarnedRef = useRef(new Map());
  // latest-only（reloadAllowedJans の多重実行で古い結果を捨てる）
  const reloadAllowedSeqRef = useRef(0);
  // 更新ボタン（手動更新）の latest-only
  const manualRefreshSeqRef = useRef(0);
  // 更新ボタン（points再取得）の latest-only + abort
  const pointsFetchSeqRef = useRef(0);
  const pointsAbortRef = useRef(null); 
  //////2026.04.以下4行を追加
  const bootFetchSeqRef = useRef(0);
  const bootAbortRef = useRef(null);
  const routeJanHandledRef = useRef("");
  const routeJanCenteredRef = useRef("");
  //////2026.05.以下2行を追加
  const qrContextFetchSeqRef = useRef(0);
  const qrContextAbortRef = useRef(null);
  //////2026.04.以下1行を追加（アクセスログ）
  const qrLandingLoggedRef = useRef(new Set());

  // ---- Drawer 状態（すべて明示）----
  const [isMyPageOpen, setIsMyPageOpen] = useState(false); // アプリガイド（メニュー）
  const [isSearchOpen, setIsSearchOpen] = useState(false); // 検索
  const [isRatedOpen, setIsRatedOpen] = useState(false); // 評価（◎）
  const [isMapGuideOpen, setIsMapGuideOpen] = useState(false); // マップガイド（オーバーレイ）
  const [isTastePositionOpen, setIsTastePositionOpen] = useState(false); // あなたの味覚位置（オーバーレイ）
  const [isStoreOpen, setIsStoreOpen] = useState(false); // お気に入り店舗登録（オーバーレイ）
  const [isAccountOpen, setIsAccountOpen] = useState(false); // マイアカウント（メニュー）
  const [isMilesOpen, setIsMilesOpen] = useState(false); // 獲得マイル（メニュー）
  const [isFaqOpen, setIsFaqOpen] = useState(false); // よくある質問（メニュー）
  const [isClusterOpen, setIsClusterOpen] = useState(false); // クラスタ配色パネル
  const [cartOpen, setCartOpen] = useState(false); // カート
  const [isScannerOpen, setIsScannerOpen] = useState(false); // バーコードスキャナ
  const [isRefreshOpen, setIsRefreshOpen] = useState(false); // 更新ボタンパネル
  const [isTermsOpen, setIsTermsOpen] = useState(false);  // 利用規約

  //---------------------------------------------------------------------------------
  // SimpleCart（ローカル） カートパネル
  const { totalQty, add: addLocal } = useSimpleCart();

  // Shopify チェックアウト復帰時のローカル掃除
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("from") === "checkout") {
        localStorage.removeItem("tm_cart_stage_v1");
        localStorage.removeItem("tm_cart_local_v1");
        alert("ご注文ありがとうございました。続けてお買い物いただけます。");
        url.searchParams.delete("from");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}
  }, []);

  //---------------------------------------------------------------------------------
  // ---- Map / DeckGL の初期 viewState ----
  const [viewState, setViewState] = useState({
    target: [0, 0, 0],
    zoom: INITIAL_ZOOM,
  });

  // データ & 状態
  const [data, setData] = useState([]);
  const [userRatings, setUserRatings] = useState({});
  const [userPin, setUserPin] = useState(null);
  const [highlight2D, setHighlight2D] = useState("");
  const [selectedJAN, setSelectedJAN] = useState(null);
  //////2026.04.以下の1行を追加
  const [highlightedJAN, setHighlightedJAN] = useState(null);
  const [productDrawerOpen, setProductDrawerOpen] = useState(false);
  const [iframeNonce, setIframeNonce] = useState(0);
  const [storeContextKey, setStoreContextKey] = useState(() => getStoreContextKeyFromStorage());
//  const [allowedJansSet, setAllowedJansSet] = useState(() => new Set());  
  const [ecOnlyJansSet, setEcOnlyJansSet] = useState(() => new Set());
//  const [storeJansSet, setStoreJansSet] = useState(() => new Set());
  const [cartEnabled, setCartEnabled] = useState(false);
  const [wishJansSet, setWishJansSet] = useState(() => new Set());
  const [wishVersion, setWishVersion] = useState(0);
  //////2026.04.以下1行を追加
  const [activeJans, setActiveJans] = useState([]);
  //////2026.05.以下3行を追加
  const [qrContext, setQrContext] = useState(null);
  const [qrTargetJansSet, setQrTargetJansSet] = useState(() => new Set());
  const [qrContextLoading, setQrContextLoading] = useState(false);

  // wish の「即時反映（SET_WISHLIST）」が API 結果で戻されないようにする保険
  const wishOverrideRef = useRef(new Map()); // jan -> { value:boolean, at:number }
  const lastWishLocalAtRef = useRef(0);

  //////2026.05.以下1セクションと置き換え
  //---------------------------------------------------------------------------------
  // QR流入アクセスログ
  // - QR文脈つきURLで最初に入った1回だけ qr_landing を送る
  // - その後、同じQR文脈で別商品へ遷移しても qr_landing は送らない
  const QR_LANDING_LOGGED_KEY = "tm_qr_landing_logged_v1";

  useEffect(() => {
    const janStr = String(routeJan || "").trim();
    if (!janStr) return;

    const isProductsRoute = /^\/products\/[^/]+$/.test(location.pathname);
    if (!isProductsRoute) return;

    const ctx = readAccessLogContextFromSearch(location.search);

    // QR文脈がない通常URLでは送らない
    if (!ctx.store_id && !ctx.importer_id) return;

    const contextKey = `store=${ctx.store_id || ""}|importer=${ctx.importer_id || ""}`;

    // このタブで同じQR文脈のlandingをすでに送っていたら送らない
    try {
      const raw = sessionStorage.getItem(QR_LANDING_LOGGED_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.context_key === contextKey) return;
      }
    } catch {}

    // ref側でも二重実行防止（React StrictMode / effect再実行対策）
    const refKey = `${contextKey}|first=${janStr}`;
    if (qrLandingLoggedRef.current.has(refKey)) return;
    qrLandingLoggedRef.current.add(refKey);

    sendAccessLog({
      event_type: "qr_landing",
      jan_code: janStr,
      search: location.search,
    });

    try {
      sessionStorage.setItem(
        QR_LANDING_LOGGED_KEY,
        JSON.stringify({
          context_key: contextKey,
          first_jan: janStr,
          store_id: ctx.store_id || null,
          importer_id: ctx.importer_id || null,
          logged_at: new Date().toISOString(),
        })
      );
    } catch {}

    // 互換：src=qr が付いている古いURLだけ src を落とす
    const nextSearch = buildSearchWithoutQrSrc(location.search);
    if (nextSearch !== location.search) {
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
        },
        { replace: true, state: location.state }
      );
    }
  }, [routeJan, location.pathname, location.search, location.state, navigate]);

  //////2026.04.以下の1セクションを追加（位置情報）
  //---------------------------------------------------------------------------------
  // 位置情報の初期取得＆更新（silent）
  useEffect(() => {
    let mounted = true;

    (async () => {
      const cached = getCachedLocation();

      // 初回 or TTL切れなら更新
      if (!cached || shouldRefreshLocation(cached)) {
        await fetchLocationSilently();
        if (!mounted) return;
        // 取得できなくても何もしない（UX優先）
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  //////2026.04.以下1セクションを追加
  //---------------------------------------------------------------------------------
  // base層:
  // points JSON（normalize済み data） ∩ boot.active_jans
  const basePoints = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!Array.isArray(activeJans) || activeJans.length === 0) return [];

    const activeSet = new Set(activeJans.map(String));
    return data.filter((d) => activeSet.has(String(getJanFromItem(d))));
  }, [data, activeJans]);

  //////2026.05.以下1セクションを追加
  //---------------------------------------------------------------------------------
  // QR表示打点:
  // base(points JSON ∩ active_jans) ∩ QR対象JAN
//////  const qrVisiblePoints = useMemo(() => {
//////    if (!Array.isArray(basePoints) || basePoints.length === 0) return [];
//////
//////    if (!(qrTargetJansSet instanceof Set) || qrTargetJansSet.size === 0) {
//////      return [];
//////    }
//////
//////    return basePoints.filter((d) =>
//////      qrTargetJansSet.has(String(getJanFromItem(d)))
//////    );
//////  }, [basePoints, qrTargetJansSet]);
  //////2026.05.以下1セクションと置き換え
  const qrVisiblePoints = useMemo(() => {
    if (!Array.isArray(basePoints) || basePoints.length === 0) return [];

    // 直前のbase表示を維持して、読み込み完了後にQR対象へ絞る
    if (qrContextLoading) {
      return basePoints;
    }

    if (!(qrTargetJansSet instanceof Set) || qrTargetJansSet.size === 0) {
      return [];
    }

    return basePoints.filter((d) =>
      qrTargetJansSet.has(String(getJanFromItem(d)))
    );
  }, [basePoints, qrTargetJansSet, qrContextLoading]);

  const qrVisibleJansSet = useMemo(() => {
    return new Set(
      (Array.isArray(qrVisiblePoints) ? qrVisiblePoints : [])
        .map((d) => String(getJanFromItem(d)))
        .filter(Boolean)
    );
  }, [qrVisiblePoints]);

  //////2026.05.以下ログ追加（問題解決のため）
  useEffect(() => {
    console.log("[QR DEBUG]", {
      search: location.search,
      qrContext,
      basePoints: basePoints.length,
      qrTargetJans: qrTargetJansSet.size,
      qrVisiblePoints: qrVisiblePoints.length,
      targetSample: Array.from(qrTargetJansSet).slice(0, 10),
      baseSample: basePoints.slice(0, 10).map((d) => getJanFromItem(d)),
    });
  }, [location.search, qrContext, basePoints, qrTargetJansSet, qrVisiblePoints]);

  // --- MapCanvas に渡す “見える集合” を確定（参照安定）---
  //////2026.05.以下の行を置き換え
  const visibleJansSetForCanvas = useMemo(() => {
    return qrVisibleJansSet;
  }, [qrVisibleJansSet]);

  // --- MapCanvas に渡す “許可集合” は「空Set＝未確定」を null に寄せる ---
  // MapCanvas側で null を“制限なし”として扱う
  //////2026.05.以下の行を置き換え
//////  const allowedJansSetForCanvas = useMemo(() => {
//////    return qrVisibleJansSet.size > 0 ? qrVisibleJansSet : new Set();
//////  }, [qrVisibleJansSet]);
  const allowedJansSetForCanvas = useMemo(() => {
    // QR文脈取得中は制限なし扱いにして、0点確定を避ける
    if (qrContextLoading) return null;

    return qrVisibleJansSet.size > 0 ? qrVisibleJansSet : new Set();
  }, [qrVisibleJansSet, qrContextLoading]);
  
  //////2026.04.以下1セクションを置き換え
  //---------------------------------------------------------------------------------
  // 商品iframe URL（店舗コンテキスト＆キャッシュバスト込み）
  // - ctx: 店舗コンテキスト（main/token）
  // - _  : iframeNonce（強制再読み込み用）
  const productIframeSrc = useMemo(() => {
    if (!selectedJAN) return "";
    const base = process.env.PUBLIC_URL || "";
    const jan = encodeURIComponent(String(selectedJAN));
    const params = new URLSearchParams();
    params.set("embed", "1");
    params.set("ctx", String(storeContextKey || ""));
    params.set("_", String(iframeNonce || 0));

    if (qrContext?.mode === "store" && qrContext?.store_id) {
      params.set("store_id", String(qrContext.store_id));
    }
    if (qrContext?.mode === "importer" && qrContext?.importer_id) {
      params.set("importer_id", String(qrContext.importer_id));
    }
    return `${base}/#/product-frame/${jan}?${params.toString()}`;
  }, [selectedJAN, storeContextKey, iframeNonce, qrContext]);

  //---------------------------------------------------------------------------------
  // 更新ボタン用 （打点JSON, バックグラウンド の更新反映のため）
  // - cache を強制的に無効化 - ?v= でURLをバスト（静的配信の強キャッシュ対策）
  const fetchPoints = useCallback(async (opts = {}) => {
    const { bust = false } = opts;
    const seq = ++pointsFetchSeqRef.current;

    // 直前の points fetch を中断（古いレスポンス勝ちを防ぐ）
    try { pointsAbortRef.current?.abort?.(); } catch {}
    const ac = new AbortController();
    pointsAbortRef.current = ac;

    try {
      const baseUrl = String(TASTEMAP_POINTS_URL || "");
      if (!baseUrl) return;

      const url = new URL(baseUrl, window.location.origin);
      if (bust) url.searchParams.set("v", String(Date.now()));

      console.log("[MapPage] fetch points", { bust, url: url.toString(), seq });
      const res = await fetch(url.toString(), {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`points HTTP ${res.status}`);

      const json = await res.json();
      const list = Array.isArray(json) ? json : (json?.points || []);
      const normalized = normalizePoints(list);

      // latest-only
      if (seq !== pointsFetchSeqRef.current) return;

      setData(normalized);
    } catch (e) {
      // abortは黙る
      if (e?.name === "AbortError") return;
      console.error("[MapPage] points fetch error", e);
    }
  }, []);

  //////2026.04.以下1セクションすべてを追加
  //---------------------------------------------------------------------------------
  // boot 取得（active_jans）
  const fetchBoot = useCallback(async () => {
    const seq = ++bootFetchSeqRef.current;

    try { bootAbortRef.current?.abort?.(); } catch {}
    const ac = new AbortController();
    bootAbortRef.current = ac;

    try {
      const res = await fetch(`${API_BASE}/api/app/boot`, {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`boot HTTP ${res.status}`);

      const json = await res.json();
      //////2026.04.一時ログのため以下の4行を追加
      console.log(
        "[DEBUG] boot.active_jans sample =",
        Array.isArray(json?.active_jans) ? json.active_jans.slice(0, 10) : json?.active_jans
      );      
      const next = Array.isArray(json?.active_jans)
        ? json.active_jans.map(String).filter(Boolean)
        : [];

      if (seq !== bootFetchSeqRef.current) return;
      setActiveJans(next);
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("[MapPage] boot fetch error", e);
    }
  }, []);

  //////2026.05.以下1セクションを置き換え
  //---------------------------------------------------------------------------------
  // QR文脈取得
  const getQrParamsFromSearch = useCallback(() => {
    try {
      // HashRouterでは location.search が空になる場面があるため、hash側も見る
      const searchText =
        location.search ||
        (window.location.hash.includes("?")
          ? `?${window.location.hash.split("?")[1]}`
          : window.location.search || "");

      const params = new URLSearchParams(searchText);

      const rawStoreId = params.get("store_id");
      const rawImporterId = params.get("importer_id");

      const storeId = rawStoreId ? Number(rawStoreId) : null;
      const importerId = rawImporterId ? Number(rawImporterId) : null;

      if (Number.isFinite(storeId) && storeId > 0) {
        return {
          mode: "store",
          storeId,
          importerId: null,
          from: "url",
        };
      }

      if (Number.isFinite(importerId) && importerId > 0) {
        return {
          mode: "importer",
          storeId: null,
          importerId,
          from: "url",
        };
      }

      // URLに無ければ、スライダー遷移後などのため sessionStorage から復元
      const snap = readQrContextSnapshot();
      if (snap?.mode === "store" && Number(snap.store_id) > 0) {
        return {
          mode: "store",
          storeId: Number(snap.store_id),
          importerId: null,
          from: "session",
        };
      }

      if (snap?.mode === "importer" && Number(snap.importer_id) > 0) {
        return {
          mode: "importer",
          storeId: null,
          importerId: Number(snap.importer_id),
          from: "session",
        };
      }

      return {
        mode: null,
        storeId: null,
        importerId: null,
        from: "none",
      };
    } catch {
      return {
        mode: null,
        storeId: null,
        importerId: null,
        from: "error",
      };
    }
  }, [location.search]);

  const fetchQrContext = useCallback(async () => {
    const { mode, storeId, importerId, from } = getQrParamsFromSearch();

    if (!storeId && !importerId) {
      setQrContext(null);
      setQrTargetJansSet(new Set());
      return;
    }

    const seq = ++qrContextFetchSeqRef.current;

    try { qrContextAbortRef.current?.abort?.(); } catch {}
    const ac = new AbortController();
    qrContextAbortRef.current = ac;

    setQrContextLoading(true);

    try {
      const params = new URLSearchParams();
      if (storeId) params.set("store_id", String(storeId));
      if (importerId) params.set("importer_id", String(importerId));

      const res = await fetch(`${API_BASE}/api/qr/map-products/context?${params.toString()}`, {
        cache: "no-store",
        signal: ac.signal,
      });

      if (!res.ok) throw new Error(`qr context HTTP ${res.status}`);

      const json = await res.json();

      if (seq !== qrContextFetchSeqRef.current) return;

      const targetJans = Array.isArray(json?.target_jans)
        ? json.target_jans.map(String).filter(Boolean)
        : [];

      const nextContext = {
        ...(json || {}),
        mode: json?.mode || mode,
        store_id: json?.store_id ?? storeId ?? null,
        importer_id: json?.importer_id ?? importerId ?? null,
        source: from,
      };

      setQrContext(nextContext);
      setQrTargetJansSet(new Set(targetJans));

      // URLから来た文脈、またはAPI成功した文脈は sessionStorage に保存
      writeQrContextSnapshot(nextContext);
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("[MapPage] QR context fetch error", e);

      if (seq !== qrContextFetchSeqRef.current) return;
      setQrContext(null);
      setQrTargetJansSet(new Set());
    } finally {
      if (seq === qrContextFetchSeqRef.current) {
        setQrContextLoading(false);
      }
    }
  }, [getQrParamsFromSearch]);

  //////2026.05.以下1セクションを置き換え
  //---------------------------------------------------------------------------------
  // 検索パネルに渡すデータ
//////  const searchPanelData = useMemo(() => {
//////    return Array.isArray(qrVisiblePoints) ? qrVisiblePoints : [];
//////  }, [qrVisiblePoints]);
  const searchPanelData = useMemo(() => {
    if (qrContextLoading) {
      return Array.isArray(basePoints) ? basePoints : [];
    }
    return Array.isArray(qrVisiblePoints) ? qrVisiblePoints : [];
  }, [qrContextLoading, basePoints, qrVisiblePoints]);

  //////2026.04.一時ログ追加のため以下6行を追加
  useEffect(() => {
    console.log("[DEBUG] data.length =", Array.isArray(data) ? data.length : -1);
    console.log("[DEBUG] activeJans.length =", Array.isArray(activeJans) ? activeJans.length : -1);
    console.log("[DEBUG] basePoints.length =", Array.isArray(basePoints) ? basePoints.length : -1);
    console.log("[DEBUG] searchPanelData.length =", Array.isArray(searchPanelData) ? searchPanelData.length : -1);
  }, [data, activeJans, basePoints, searchPanelData]);  

  //---------------------------------------------------------------------------------
  // ====== allowed-jans を読み直す共通関数 ======
  const reloadAllowedJans = useCallback(async () => {
    const seq = ++reloadAllowedSeqRef.current; // この呼び出しの世代 
    const mainStoreId = getCurrentMainStoreIdSafe();
    let hasToken = false;
      try {
        hasToken = !!(localStorage.getItem("app.access_token") || "");
      } catch {}

    try {
      const startedAt = Date.now();
      const { allowedJans, ecOnlyJans, storeJans, mainStoreEcActive, ecEnabledInContext, wishJans } =
        await fetchAllowedJansAuto();

      // 古い呼び出しの結果は捨てる（上書き事故防止）
      if (seq !== reloadAllowedSeqRef.current) return;

      const fromLS = getCurrentMainStoreEcActiveFromStorage();
      const apiEc = typeof mainStoreEcActive === "boolean" ? mainStoreEcActive : null;

      // ✅ cartEnabled の正：ecEnabledInContext（= 店舗コンテキスト判定）だけ
      //    成功時のみ確定更新。失敗時に false へ落とさない（揺れ防止）
      setCartEnabled(!!ecEnabledInContext);
      console.log("[cartEnabled]", { mainStoreId, hasToken, apiEc, mainStoreEcActive, fromLS, ecEnabledInContext });

      // 常に Set（null禁止）
//////      if (Array.isArray(allowedJans)) setAllowedJansSet(new Set(allowedJans.map(String)));
      if (Array.isArray(ecOnlyJans)) setEcOnlyJansSet(new Set(ecOnlyJans.map(String)));
      // wish: API結果 + ローカル即時反映（SET_WISHLIST）を merge（上書き事故防止）
      if (Array.isArray(wishJans)) {
        const apiSet = new Set(wishJans.map(String));
        const next = new Set(apiSet);

        // 直近でローカル変更があった場合、overrideを優先して反映
        // （古いAPI結果で ON を戻されるのを防ぐ）
        const lastLocalAt = lastWishLocalAtRef.current || 0;
        if (lastLocalAt && lastLocalAt >= startedAt - 5000) {
          for (const [jan, meta] of wishOverrideRef.current.entries()) {
            const key = String(jan);
            if (meta?.value) next.add(key);
            else next.delete(key);
          }
        }
        setWishJansSet(next);
        setWishVersion((v) => v + 1);
      } else {
        setWishJansSet((prev) => (prev instanceof Set ? prev : new Set()));
        setWishVersion((v) => v + 1);
      }
//////      setStoreJansSet(new Set(storeJans || []));

      // ✅ 成功したらスナップショット保存（ログアウト後も維持）
      writeAllowedSnapshot({ allowedJans, ecOnlyJans, storeJans, mainStoreEcActive, ecEnabledInContext, wishJans });
    } catch (e) {
      console.error("allowed-jans の取得に失敗:", e);

      // 失敗側も latest-only（古い失敗で復元上書きしない）
      if (seq !== reloadAllowedSeqRef.current) return;

      // ✅ 失敗したら最後の成功値へフォールバック
      const snap = readAllowedSnapshot();

      // ✅ snap.allowedJans は「配列 & 非空」のときだけ採用（空Setを作らない）
      if (Array.isArray(snap?.allowedJans) && snap.allowedJans.length > 0) {
//////        setAllowedJansSet(new Set(snap.allowedJans));
        setEcOnlyJansSet(new Set((snap.ecOnlyJans || []).map(String)));
//////        setStoreJansSet(new Set(snap.storeJans || []));
        // snapshot復元 + override を merge（復元も戻されないように）
        const snapSet = new Set((snap.wishJans || []).map(String));
        const next = new Set(snapSet);
        for (const [jan, meta] of wishOverrideRef.current.entries()) {
          const key = String(jan);
          if (meta?.value) next.add(key);
          else next.delete(key);
        }
        setWishJansSet(next);
        setWishVersion((v) => v + 1);

        // ✅ 失敗時は snapshot があるときだけ cartEnabled を更新
        setCartEnabled(!!snap.ecEnabledInContext);
        return;
      }

      // ✅ 初回で何も無いなら Set は prev維持（=揺れ防止）
//////      setAllowedJansSet((prev) => (prev instanceof Set ? prev : new Set()));
      setEcOnlyJansSet((prev) => (prev instanceof Set ? prev : new Set()));
//////      setStoreJansSet(new Set());
      setCartEnabled((prev) => prev); // ここで false に落とさない
    }
  }, []);

  // ====== 初回マウント時に allowed-jans を取得 ======
  useEffect(() => {
    reloadAllowedJans();
  }, [reloadAllowedJans]);

  //---------------------------------------------------------------------------------
  // ====== rated-panel（DB正）から wishlist を同期 ====== 評価一覧API（rated-panel）
  const syncRatedPanel = useCallback(async () => {
    let token = "";
    try {
      token = localStorage.getItem("app.access_token") || "";
    } catch {}
    if (!token) {
      return;
    }

    try {
      const json = await fetchRatedPanelSnapshot({ apiBase: API_BASE, token });
      const { nextRatings } = parseRatedPanelItems(json);

      // rating も一緒に取れているなら同期（空なら触らない）
      if (nextRatings && Object.keys(nextRatings).length > 0) {
        setUserRatings(nextRatings);
        try {
          localStorage.setItem("userRatings", JSON.stringify(nextRatings));
        } catch {}
      }
    } catch (e) {
      console.warn("rated-panel sync failed:", e);
    }
  }, []);

  //---------------------------------------------------------------------------------
  // syncRatedPanel（評価パネル開閉）は「復元用」に限定
  // - rated-panel は店舗コンテキストに依存しないので tm_store_changed では呼ばない
  // - storage も auth 系 key のみ反応（過剰発火を削る）
  useEffect(() => {
    const handler = (e) => {
      if (e && e.type === "storage") {
        const k = e.key || "";
        const ok = k === "app.access_token" || k === "app.user";
        if (!ok) return;
      }
      syncRatedPanel();
    };
    // 初回復元（マウント時に1回）
    syncRatedPanel();

    window.addEventListener("tm_auth_changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("tm_auth_changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [syncRatedPanel]);

  //---------------------------------------------------------------------------------
  // ====== ログイン状態や店舗選択の変更を拾って再取得 （handler）======
  useEffect(() => {
    const handler = (e) => {
    // サブ店舗ON/OFFなど「allowed-jans を即更新したい」イベントだけ reload する
    const isSubStoreKey = (k) =>
      k === "sub_store_ids" ||
      k === "selectedSubStoreIds" ||
      k === "selectedSubStores" ||
      k === "app.sub_store_ids";

    const isStoreKey = (k) =>
      k === "selectedStore" || k === "main_store" || isSubStoreKey(k);

      // storage のときだけ key で絞る（関係ない localStorage 更新での過剰リロード防止）
      if (e && e.type === "storage") {
        const k = e.key || "";
        const ok =
          k === "app.access_token" ||
          k === "app.user" ||
          k === "selectedStore" ||
          k === "main_store" ||
          k === "sub_store_ids" ||
          k === "selectedSubStoreIds" ||
          k === "selectedSubStores" ||
          k === "app.sub_store_ids";
        if (!ok) return;

        // 即反映が必要なのは サブ店舗変更
        if (isStoreKey(k)) {
          reloadAllowedJans();
        }
      }

      // StorePanelContent などが投げるカスタムイベント（サブ店舗ON/OFFを含む想定）
      if (e && e.type === "tm_store_changed") {
        reloadAllowedJans();
      }

      // 店舗コンテキストが変わったら商品iframeを必ずリロード　2026.01.追加
      const nextKey = getStoreContextKeyFromStorage();
      setStoreContextKey((prev) => {
        if (prev === nextKey) return prev;
        // Drawer が開いていようがいまいが、nonceを進めて「次に開いた時」も新鮮にする
        setIframeNonce((n) => n + 1);
        return nextKey;
      });
    };

    // MyAccount でログイン/ログアウト時に発火させる想定
    window.addEventListener("tm_auth_changed", handler);
    // StorePanelContent から localStorage が書き換わったときも拾う
    window.addEventListener("storage", handler);
    window.addEventListener("tm_store_changed", handler);

    return () => {
      window.removeEventListener("tm_auth_changed", handler);
      window.removeEventListener("storage", handler);
      window.removeEventListener("tm_store_changed", handler);
    };
  }, [reloadAllowedJans]);

  //---------------------------------------------------------------------------------
  // ストアパネル（サブ店舗の登録/解除で打点を即反映）
  // storeContextKey が変わったら allowed-jans を再取得して即反映
  useEffect(() => {
    if (!storeContextKey) return;
    reloadAllowedJans();
  }, [storeContextKey, reloadAllowedJans]); 

  //---------------------------------------------------------------------------------
  // クラスタ配色
  const [clusterColorMode, setClusterColorMode] = useState(false);
  const [clusterCollapseKey, setClusterCollapseKey] = useState(null);

  /** ===== UMAP座標へセンタリング ===== */
  const centerToUMAP = useCallback(
    (xUMAP, yUMAP, opts = {}) => {
      if (!Number.isFinite(xUMAP) || !Number.isFinite(yUMAP)) return;
      const yCanvas = -yUMAP;
      // opts.zoom が来ていればそれを最優先。
      // それ以外は keepZoom のとき現在ズーム維持、通常は最小ズームへ。
      const baseZoom =
        opts.zoom != null
          ? opts.zoom
          : opts.keepZoom
            ? (viewState.zoom ?? INITIAL_ZOOM)
            : ZOOM_LIMITS.min;
      const zoomTarget = Math.max(
        ZOOM_LIMITS.min,
        Math.min(ZOOM_LIMITS.max, baseZoom)
      );
      const yOffset = getYOffsetWorld(zoomTarget, CENTER_Y_FRAC);
      setViewState((prev) => ({
        ...prev,
        target: [xUMAP, yCanvas - yOffset, 0],
        zoom: zoomTarget,
      }));
    },
    [viewState.zoom]
  );

  // クラスタ重心に移動
  const centerToCluster = useCallback(
    (clusterId) => {
      const cid = Number(clusterId);
      if (!Array.isArray(data) || data.length === 0 || !Number.isFinite(cid))
        return;
      const items = data.filter((d) => Number(d.cluster) === cid);
      if (!items.length) return;
      const sx = items.reduce((s, d) => s + Number(d.umap_x || 0), 0);
      const sy = items.reduce((s, d) => s + Number(d.umap_y || 0), 0);
      const cx = sx / items.length;
      const cy = sy / items.length;
      // 色分けがOFFならONにしておく（任意）
      setClusterColorMode(true);
      centerToUMAP(cx, cy); // 既定で最小ズーム
    },
    [data, centerToUMAP]
  );

  // ユニークな cluster 値 → 初期色を決定
  const clusterList = useMemo(() => {
    const s = new Set();
    (data || []).forEach(
      (d) => Number.isFinite(d.cluster) && s.add(Number(d.cluster))
    );
    return Array.from(s).sort((a, b) => a - b);
  }, [data]);

  //---------------------------------------------------------------------------------
  //---------------------------------------------------------------------------------
  // ===== パネル開閉ユーティリティー
  const PANEL_ANIM_MS = 260;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** まとめて閉じ、閉じアニメ分だけ待つ（preserveMyPage=true ならメニューは残す） */
  const closeUIsThen = useCallback(
    async (opts = {}) => {
      const {
        preserveMyPage = false,
        preserveRated = false,
        preserveSearch = false,
        preserveCluster = false,
      } = opts;
      let willClose = false;

      if (productDrawerOpen) {
        setProductDrawerOpen(false);
        setSelectedJAN(null);
        willClose = true;
      }
      if (isMapGuideOpen) {
        setIsMapGuideOpen(false);
        willClose = true;
      }
      if (isTastePositionOpen) {
        setIsTastePositionOpen(false);
        willClose = true;
      }      
      if (isStoreOpen) {
        setIsStoreOpen(false);
        willClose = true;
      }
      if (isSearchOpen && !preserveSearch) {
        setIsSearchOpen(false);
        willClose = true;
      }
      if (isRatedOpen && !preserveRated) {
        setIsRatedOpen(false);
        willClose = true;
      }
      if (isAccountOpen) {
        setIsAccountOpen(false);
        willClose = true;
      }
      if (isMilesOpen) {
        setIsMilesOpen(false);
        willClose = true;
      }
      if (isFaqOpen) {
        setIsFaqOpen(false);
        willClose = true;
      }
      if (isRefreshOpen) {
        setIsRefreshOpen(false);
        willClose = true;
      }

      // クラスタパネルは preserveCluster=true のときは閉じない
      if (isClusterOpen && !preserveCluster) {
        setIsClusterOpen(false);
        setClusterCollapseKey(null);
        willClose = true;
      }

      if (!preserveMyPage && isMyPageOpen) {
        setIsMyPageOpen(false);
        willClose = true;
      }
      if (cartOpen) {
        setCartOpen(false);
        willClose = true;
      }

      if (willClose) await wait(PANEL_ANIM_MS);
    },
    [
      productDrawerOpen,
      isMapGuideOpen,
      isTastePositionOpen,
      isStoreOpen,
      isSearchOpen,
      isRatedOpen,
      isMyPageOpen,
      isAccountOpen,
      isMilesOpen,
      isFaqOpen,
      isRefreshOpen,
      isClusterOpen,
      cartOpen,
    ]
  );

  /** 通常の相互排他オープン（メニュー含め全部調停して開く） */
  const openPanel = useCallback(
    async (kind) => {
      // ★ cluster 以外を開くとき、クラスターパネルが開いていれば「畳む」合図を送る
      if (kind !== "cluster" && isClusterOpen) {
        setClusterCollapseKey((k) => (k == null ? 1 : k + 1));
      }

      // クラスタパネルは閉じずに残す
      await closeUIsThen({ preserveCluster: true });

      if (kind === "mypage") setIsMyPageOpen(true);
      else if (kind === "mapguide" || kind === "guide") setIsMapGuideOpen(true);
      else if (kind === "position") setIsTastePositionOpen(true);
      else if (kind === "store") setIsStoreOpen(true);
      else if (kind === "search") setIsSearchOpen(true);
      else if (kind === "rated") setIsRatedOpen(true);
      else if (kind === "cluster") setIsClusterOpen(true);
      else if (kind === "cart") {
       if (!cartEnabled) return;
       setCartOpen(true);
      }
    },
    [closeUIsThen, isClusterOpen, cartEnabled]
  );

  /** メニューを開いたまま、上に重ねる版（レイヤー表示用） */
  const openOverlayAboveMenu = useCallback(
    async (kind) => {
      await closeUIsThen({ preserveMyPage: true, preserveCluster: true });
      if (kind === "mapguide") setIsMapGuideOpen(true);
      else if (kind === "position") setIsTastePositionOpen(true);
      else if (kind === "store") setIsStoreOpen(true);
      else if (kind === "guide") setIsMapGuideOpen(true);
      else if (kind === "account") setIsAccountOpen(true);
      else if (kind === "miles") setIsMilesOpen(true);
      else if (kind === "faq") setIsFaqOpen(true);
      else if (kind === "refresh") setIsRefreshOpen(true);
      else if (kind === "cart") {
        if (!cartEnabled) return;
        setCartOpen(true);
      }

    }, [closeUIsThen, cartEnabled]
  );

  //----------------------------
  // クエリで各パネルを開く（/ ?open=mypage|search|rated|mapguide|guide|position|store）
  useEffect(() => {
    try {
      const p = new URLSearchParams(location.search);
      const open = (p.get("open") || "").toLowerCase();
      if (!open) return;
      (async () => {
        await openPanel(open); // クエリ経由は従来どおり相互排他
        navigate(location.pathname, {
          replace: true,
          state: location.state,
        });
      })();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, openPanel, navigate, location.pathname, location.state]);

  //---------------------------------------------------------------------------------
  // ====== パン境界
  const panBounds = useMemo(() => {
    if (!data.length) return { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    const xs = data.map((d) => d.umap_x);
    const ys = data.map((d) => -d.umap_y);
    const xmin = Math.min(...xs),
      xmax = Math.max(...xs);
    const ymin = Math.min(...ys),
      ymax = Math.max(...ys);
    const pad = 1.5 + Math.abs(CENTER_Y_OFFSET);
    return {
      xmin: xmin - pad,
      xmax: xmax + pad,
      ymin: ymin - pad,
      ymax: ymax + pad,
    };
  }, [data]);

  //---------------------------------------------------------------------------------
  //---------------------------------------------------------------------------------
  // 更新ボタン用 （打点JSONやバックグラウンド読み込みのため）
  // ====== 打点データ読み込み（初回）===== 2026.01.
  useEffect(() => {
    fetchPoints({ bust: false });
  }, [fetchPoints]);

  //////2026.04.以下1セクションを追加
  //---------------------------------------------------------------------------------
  // boot 初回取得
  useEffect(() => {
    fetchBoot();
  }, [fetchBoot]);

  //////2026.05.以下1セクションを追加
  //---------------------------------------------------------------------------------
  // QR文脈 初回/URL変更時取得
  useEffect(() => {
    fetchQrContext();
  }, [fetchQrContext]);

  //---------------------------------------------------------------------------------
  // スキャナ：未登録JANの警告リセット
  useEffect(() => {
    if (isScannerOpen) unknownWarnedRef.current.clear();
  }, [isScannerOpen]);

  //---------------------------------------------------------------------------------
  // ====== ローカルストレージ同期
  useEffect(() => {
    const syncUserRatings = () => {
      const stored = localStorage.getItem("userRatings");
      if (stored) {
        try {
          setUserRatings(JSON.parse(stored));
        } catch (e) {
          console.error("Failed to parse userRatings:", e);
        }
      }
    };
    syncUserRatings();
    window.addEventListener("focus", syncUserRatings);
    window.addEventListener("storage", syncUserRatings);
    return () => {
      window.removeEventListener("focus", syncUserRatings);
      window.removeEventListener("storage", syncUserRatings);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("userRatings", JSON.stringify(userRatings));
    } catch {}
  }, [userRatings]);

  //---------------------------------------------------------------------------------
  // ====== UMAP 重心
  const umapCentroid = useMemo(() => {
    if (!data?.length) return [0, 0];
    let sx = 0,
      sy = 0,
      n = 0;
    for (const d of data) {
      if (Number.isFinite(d.umap_x) && Number.isFinite(d.umap_y)) {
        sx += d.umap_x;
        sy += d.umap_y;
        n++;
      }
    }
    return n ? [sx / n, sy / n] : [0, 0];
  }, [data]);

  // userPin 読み出し
  const readUserPinFromStorage = useCallback(() => {
    try {
      const raw = localStorage.getItem("userPinCoords");
      if (!raw) return null;
      const val = JSON.parse(raw);

      if (
        val &&
        Array.isArray(val.coordsUMAP) &&
        val.coordsUMAP.length >= 2
      ) {
        const x = Number(val.coordsUMAP[0]);
        const y = Number(val.coordsUMAP[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      }
      if (val && Array.isArray(val.coords) && val.coords.length >= 2) {
        const xCanvas = Number(val.coords[0]);
        const yCanvas = Number(val.coords[1]);
        if (Number.isFinite(xCanvas) && Number.isFinite(yCanvas)) {
          const umap = [xCanvas, -yCanvas];
          localStorage.setItem(
            "userPinCoords",
            JSON.stringify({ coordsUMAP: umap, version: 2 })
          );
          return umap;
        }
      }
      if (Array.isArray(val) && val.length >= 2) {
        const ax = Number(val[0]);
        const ay = Number(val[1]);
        if (Number.isFinite(ax) && Number.isFinite(ay)) {
          const [cx, cy] = umapCentroid;
          const dUMAP = (ax - cx) ** 2 + (ay - cy) ** 2;
          const dFlipY = (ax - cx) ** 2 + (-ay - cy) ** 2;
          const umap = dUMAP <= dFlipY ? [ax, ay] : [ax, -ay];
          localStorage.setItem(
            "userPinCoords",
            JSON.stringify({ coordsUMAP: umap, version: 2 })
          );
          return umap;
        }
      }
      return null;
    } catch (e) {
      console.warn("userPinCoords の解析に失敗:", e);
      return null;
    }
  }, [umapCentroid]);

  // userPin 同期
  useEffect(() => {
    const sync = () => setUserPin(readUserPinFromStorage());
    sync();
    const onFocus = () => sync();
    const onStorage = (e) => {
      if (!e || e.key === "userPinCoords") sync();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [readUserPinFromStorage]);

  // 初期センタリング
  useEffect(() => {
    if (didInitialCenterRef.current) return;
    if (!Array.isArray(data) || data.length === 0) return;

    let targetX = null;
    let targetY = null;

   // ① userPin を最優先 （スライダー遷移後の user嗜好の中心）
   const pin = readUserPinFromStorage() || userPin;
   const [px, py] = Array.isArray(pin) ? pin : [];
   if (Number.isFinite(px) && Number.isFinite(py)) {
     targetX = px;
     targetY = py;
   } else if (
     // ② userPin が無いときだけ basePoint（基準のワイン）
     basePoint &&
     Number.isFinite(basePoint.x) &&
     Number.isFinite(basePoint.y)
   ) {
     targetX = Number(basePoint.x);
     targetY = Number(basePoint.y);
   } else {
     // ③ なければ ANCHOR_JAN（基準のワイン）
     const b = data.find(
       (d) =>
         String(d.jan_code) === ANCHOR_JAN ||
         String(d.JAN) === ANCHOR_JAN
     );
     if (b && Number.isFinite(b.umap_x) && Number.isFinite(b.umap_y)) {
       targetX = b.umap_x;
       targetY = b.umap_y;
     } else {
       // ④ それも無ければ全体重心
       const [cx, cy] = umapCentroid;
       targetX = cx;
       targetY = cy;
     }
   }

    centerToUMAP(targetX, targetY, { zoom: INITIAL_ZOOM });
    didInitialCenterRef.current = true;
  }, [data, centerToUMAP, umapCentroid, basePoint, readUserPinFromStorage, userPin]);

  // SliderPageから戻った直後にユーザーピンへセンタリング
  useEffect(() => {
    // state か sessionStorage の合図を読む
    const byState = location.state?.centerOnUserPin === true;
    let byFlag = false;
    try {
      byFlag = sessionStorage.getItem("tm_center_on_userpin") === "1";
    } catch {}

    if (!(byState || byFlag)) return;

    try { sessionStorage.setItem("tm_slider_return_flow", "1"); } catch {}

    const pin = readUserPinFromStorage() || userPin;
    const [x, y] = Array.isArray(pin) ? pin : [];

    if (Number.isFinite(x) && Number.isFinite(y)) {
      // 初期センタリング（basePoint/anchor）に上書きされないように止める
      didInitialCenterRef.current = true;
      // visualViewport が安定してからセンタリング（iPhone/PWAのブレ対策）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          centerToUMAP(x, y, { zoom: INITIAL_ZOOM });
        });
      });
    }

    // 使い終わったフラグ類を掃除
    try {
      sessionStorage.removeItem("tm_center_on_userpin");
    } catch {}
    // URLの state をクリア（戻る履歴を汚さない）
    if (byState) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.key, userPin, centerToUMAP, readUserPinFromStorage, navigate, location.pathname]);

  // 初回センタリング（userPin 指定時）
  useEffect(() => {
    // 評価後に商品ページを閉じてもマップが勝手に動かないよう、ユーザーピンへの自動センタリングを無効化
    return;
  }, [userPin, location.state, centerToUMAP]);

  useEffect(() => {
    // Slider復帰フロー中は「基準へ戻す」を無効化（最後に上書きされるのを防ぐ）
    const isSliderReturn =
      location.state?.centerOnUserPin === true ||
      sessionStorage.getItem("tm_center_on_userpin") === "1" ||
      sessionStorage.getItem("tm_slider_return_flow") === "1";
    if (isSliderReturn) {
      try { sessionStorage.removeItem("tm_center_umap"); } catch {}
      try { sessionStorage.removeItem("tm_slider_return_flow"); } catch {}
      return;
    }
    const fromState = !!location.state?.centerOnBlendF;
    const raw = sessionStorage.getItem("tm_center_umap");
    if (!fromState && !raw) return;
    if (!Array.isArray(data) || data.length === 0) return;

    let targetX = null,
      targetY = null;
    try {
      if (raw) {
        const payload = JSON.parse(raw);
        if (
          Number.isFinite(payload?.x) &&
          Number.isFinite(payload?.y)
        ) {
          targetX = Number(payload.x);
          targetY = Number(payload.y);
        }
      }
    } catch {}

    if (targetX == null || targetY == null) {
      const b = data.find(
        (d) =>
          String(d.jan_code) === ANCHOR_JAN ||
          String(d.JAN) === ANCHOR_JAN
      );
      if (b && Number.isFinite(b.umap_x) && Number.isFinite(b.umap_y)) {
        targetX = b.umap_x;
        targetY = b.umap_y;
      }
    }

    if (targetX != null && targetY != null) {
      centerToUMAP(targetX, targetY, { zoom: INITIAL_ZOOM });
    }

    sessionStorage.removeItem("tm_center_umap");
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {}
  }, [location.state, data, centerToUMAP]);

  // ====== 商品へフォーカス
  const focusOnWine = useCallback((item, opts = {}) => {
    if (!item) return;
    const tx = Number(item.umap_x);
    const tyUMAP = Number(item.umap_y);
    if (!Number.isFinite(tx) || !Number.isFinite(tyUMAP)) return;

    setViewState((prev) => {
      const wantZoom = opts.zoom;
      const zoomTarget =
        wantZoom == null
          ? prev.zoom
          : Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, wantZoom));
      const yOffset = getYOffsetWorld(zoomTarget, CENTER_Y_FRAC);
      const keepTarget = opts.recenter === false;
      const nextTarget = keepTarget
        ? prev.target
        : [tx, -tyUMAP - yOffset, 0];
      return { ...prev, target: nextTarget, zoom: zoomTarget };
    });
  }, []);

  //////2026.04.上記を以下の1セクションに置き換え（アクセスログ含む）
  //---------------------------------------------------------------------------------
  // 商品を開く共通関数
  // - /products/:jan 上では URL を更新して商品を切り替える
  // - /map 上では既存どおり state で Drawer を開く
  const openWine = useCallback(
    async (itemOrJan, opts = {}) => {
      const janStr =
        typeof itemOrJan === "string"
          ? String(itemOrJan)
          : String(getJanFromItem(itemOrJan));

      if (!janStr) return;

      const keepSearch = !!opts.preserveSearch;
      const keepRated = !!opts.preserveRated;
      const source = opts.source || null;

      const item =
        typeof itemOrJan === "string"
          ? (
              basePoints.find((d) => String(getJanFromItem(d)) === janStr) ||
              data.find((d) => String(getJanFromItem(d)) === janStr) ||
              null
            )
          : itemOrJan;

      await closeUIsThen({
        preserveMyPage: true,
        preserveSearch: keepSearch,
        preserveRated: keepRated,
        preserveCluster: true,
      });

      setClusterCollapseKey((k) => (k == null ? 1 : k + 1));

      const isProductsRoute = /^\/products\/[^/]+$/.test(location.pathname);

      // 商品オープンログは「開く意思決定」のここで送る
      if (source) {
        sendAccessLog({
          event_type: "product_open",
          jan_code: janStr,
          source,
          search: location.search,
        });
      }

      // 強調対象は「開いた商品」に合わせる
      setHighlightedJAN(janStr);

      //////2026.05.以下1セクションと置き換え
      if (isProductsRoute) {
        const currentSearch = buildSearchWithoutQrSrc(location.search);
        const params = new URLSearchParams(currentSearch);

        if (qrContext?.mode === "store" && qrContext?.store_id) {
          params.set("store_id", String(qrContext.store_id));
        }

        if (qrContext?.mode === "importer" && qrContext?.importer_id) {
          params.set("importer_id", String(qrContext.importer_id));
        }

        const nextSearch = params.toString() ? `?${params.toString()}` : "";

        // ★ /productsルートでもDrawerを必ず開き直す
        setSelectedJAN(janStr);
        setIframeNonce(Date.now());
        setProductDrawerOpen(true);

        navigate(
          {
            pathname: `/products/${encodeURIComponent(janStr)}`,
            search: nextSearch,
          },
          { replace: false }
        );

        if (item) {
          focusOnWine(item, { zoom: opts.zoom });
        }
        return;
      }

      setSelectedJAN(janStr);
      setIframeNonce(Date.now());
      setProductDrawerOpen(true);

      if (item) {
        focusOnWine(item, { zoom: opts.zoom });
      }
    },
    [
      basePoints,
      data,
      closeUIsThen,
      location.pathname,
      location.search,
      navigate,
      focusOnWine,
      qrContext,
    ]
  );

  //////2026.04.以下の1セクションと置き換え
  //---------------------------------------------------------------------------------
  // /products/:jan で来た時は MapPage 上で商品Drawerを開く
  useEffect(() => {
    if (!routeJan) return;

    const janStr = String(routeJan).trim();
    if (!janStr) return;

    // URL上のJANを現在値に合わせる
    routeJanHandledRef.current = janStr;
    setSelectedJAN((prev) => (prev === janStr ? prev : janStr));
    setHighlightedJAN((prev) => (prev === janStr ? prev : janStr));
    setProductDrawerOpen(true);

    // まだ点データが無い段階では待つ
    const hit =
      (Array.isArray(basePoints)
        ? basePoints.find((d) => String(getJanFromItem(d)) === janStr)
        : null) ||
      (Array.isArray(data)
        ? data.find((d) => String(getJanFromItem(d)) === janStr)
        : null);

    if (!hit) return;

    // そのJANについてまだ未センタリングなら、データが揃ったタイミングで1回だけ中心へ
    if (routeJanCenteredRef.current !== janStr) {
      routeJanCenteredRef.current = janStr;
      didInitialCenterRef.current = true;

      requestAnimationFrame(() => {
        focusOnWine(hit, { zoom: INITIAL_ZOOM });
      });
    }
  }, [routeJan, basePoints, data, focusOnWine]);

  // 最近傍（ワールド座標：DeckGLの座標系 = [UMAP1, -UMAP2]）
  //////2026.05.以下1セクションと置き換え
  const findNearestWineWorld = useCallback(
    (wx, wy) => {
      const src = Array.isArray(qrVisiblePoints) ? qrVisiblePoints : [];
      if (src.length === 0) return null;

      let best = null;
      let bestD2 = Infinity;

      for (const d of src) {
        const x = d.umap_x;
        const y = -d.umap_y;

        const dx = x - wx;
        const dy = y - wy;
        const d2 = dx * dx + dy * dy;

        if (d2 < bestD2) {
          bestD2 = d2;
          best = d;
        }
      }
      return best;
    },
    [qrVisiblePoints]
  );

  // 「あなたの味覚位置パネル」表示用：userPin 近傍のクラスターIDを算出（UMAP近傍）
  const tastePositionClusterId = useMemo(() => {
    if (!userPin || !Array.isArray(data) || data.length === 0) return null;
    const x = Number(userPin?.[0]);
    const y = Number(userPin?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    // findNearestWineWorld は「ワールド座標（y反転）」を受け取る
    const nearest = findNearestWineWorld(x, -y);
    const cid = Number(nearest?.cluster);
    return Number.isFinite(cid) ? cid : null;
  }, [userPin, data, findNearestWineWorld]);

  // スライダー直後：最寄り自動オープン
  useEffect(() => {
    const wantAutoOpen =
      sessionStorage.getItem("tm_autopen_nearest") === "1";
    if (!wantAutoOpen) return;
    if (autoOpenOnceRef.current) return;
    if (!userPin || !Array.isArray(data) || data.length === 0) return;

    autoOpenOnceRef.current = true;
    sessionStorage.removeItem("tm_autopen_nearest");

    setIsSearchOpen(false);
    setIsRatedOpen(false);

    try {
      // userPin は UMAP空間（x, yUMAP）。DeckGL世界は y を反転している点に注意
      const wx = userPin[0];
      const wy = -userPin[1];
      const nearest = findNearestWineWorld(wx, wy);
      const janStr = getJanFromItem(nearest);
      if (janStr) {
        setSelectedJAN(janStr);
        setIframeNonce(Date.now());
        setProductDrawerOpen(true);
        focusOnWine(nearest, { zoom: INITIAL_ZOOM, recenter: false });
      }
    } catch (e) {
      console.error("auto-open-nearest failed:", e);
    }
  }, [location.key, userPin, data, findNearestWineWorld, focusOnWine]);

  //---------------------------------------------------------------------------------
  // スナップショット1
  // STATE_SNAPSHOT =どう見せるか　（iframe側のUIを親と一致させる = iframe分離構造では必須）対象：iframe
  // ====== 子iframeへ（wishlist反映など）状態スナップショットを送る
  const CHILD_ORIGIN =
    typeof window !== "undefined" ? window.location.origin : "*";

  // 商品ページ（iframe）からの postMessage
  useEffect(() => {
    const onMsg = async (e) => {
      // 同一オリジン以外は無視（混入対策）
      if (!e || e.origin !== CHILD_ORIGIN) return;
      const msg = e?.data || {};
      const { type } = msg || {};
      if (!type) return;

      // ctx が付いているメッセージは「現在の storeContextKey と一致するものだけ」採用
      // （店舗変更直後の遅延 message 混入を捨てる / latest-only）
      try {
        if (msg.ctx != null && String(msg.ctx) !== String(storeContextKey || "")) {
          return;
        }
      } catch {}

      // === ProductPage からのカート関連メッセージ ===
      if (type === "OPEN_CART") {
        if (!cartEnabled) return;
        setCartOpen(true);
        return;
      }

      if (type === "SIMPLE_CART_ADD" && msg.item) {
         if (!cartEnabled) return;
        try {
          await addLocal(msg.item); // ローカルカートに積む
          setCartOpen(true); // ついでに開く
        } catch (e) {
          console.error("SIMPLE_CART_ADD failed:", e);
        }
        return;
      }

      const sendSnapshotToChild = (janStr, nextRatingObj) => {
        try {
          const isWished = wishJansSet instanceof Set ? wishJansSet.has(janStr) : false;
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "STATE_SNAPSHOT",
              ctx: String(storeContextKey || ""),
              jan: janStr,
              wished: isWished,
              favorite: isWished, // 後方互換
              rating: nextRatingObj || userRatings[janStr] || null,
              // 後方互換のため送る場合は rating>0 を反映
              hideHeart:
                (nextRatingObj?.rating ||
                  userRatings[janStr]?.rating ||
                  0) > 0,
            },
            CHILD_ORIGIN
          );
          // HIDE_HEART 明示送信は廃止（子は rating から自律判定）
        } catch {}
      };

      // 評価を子iframeに明示的に適用させるための補助メッセージ
      const sendRatingToChild = (janStr, ratingObjOrNull) => {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "SET_RATING", // 子側でこれを受けてUIを即時更新させる
              ctx: String(storeContextKey || ""),
              jan: janStr,
              rating: ratingObjOrNull, // { rating, date } もしくは null（クリア）
            },
            CHILD_ORIGIN
          );
        } catch {}
      };

      if (type === "OPEN_MYACCOUNT") {
        await closeUIsThen({ preserveMyPage: true });
        setIsMyPageOpen(true);
        setIsAccountOpen(true);
        return;
      }

      const janStr = String(msg.jan ?? msg.jan_code ?? "");
      if (!janStr) return;

      // ProductPage の wishlist（DB正）→ MapPage（表示用キャッシュ）へ即反映
      // ProductPage は API を叩いた後にこれを投げる（単一ソース維持）
      if (type === "SET_WISHLIST") {
        const isWished = !!msg.value;
        const at = Number(msg.at) || Date.now();
        lastWishLocalAtRef.current = at;
        wishOverrideRef.current.set(String(janStr), { value: isWished, at });
        // 飲みたいの正：wishJansSet を即時更新（MapCanvas即反映）
        setWishJansSet((prev) => {
          const base = prev instanceof Set ? prev : new Set();
          const next = new Set(base);
          const key = String(janStr);
          if (isWished) next.add(key);
          else next.delete(key);
          return next;
        });
        setWishVersion((v) => v + 1);
        return;
      }

      if (type === "RATING_UPDATED") {
        const payload = msg.payload || null;

        setUserRatings((prev) => {
          const next = { ...prev };
          if (!payload || !payload.rating) delete next[janStr];
          else next[janStr] = payload;
          try {
            localStorage.setItem("userRatings", JSON.stringify(next));
          } catch {}
          return next;
        });

        // まずスナップショットを送る
        sendSnapshotToChild(janStr, msg.payload || null);
        // さらに評価を明示適用（特に「評価クリア(null)」時のUI遅延対策）
        sendRatingToChild(
          janStr,
          payload && Number(payload.rating) > 0 ? payload : null
        );
        return;
      }

      if (type === "tm:rating-updated") {
        const rating = Number(msg.rating) || 0;
        const date = msg.date || new Date().toISOString();

        setUserRatings((prev) => {
          const next = { ...prev };
          if (rating <= 0) delete next[janStr];
          else next[janStr] = { ...(next[janStr] || {}), rating, date };
          try {
            localStorage.setItem("userRatings", JSON.stringify(next));
          } catch {}
          return next;
        });

        // スナップショット
        const nextRating = rating > 0 ? { rating, date } : null;
        sendSnapshotToChild(janStr, nextRating);
        // 明示適用（評価クリア時のズレ解消）
        sendRatingToChild(janStr, nextRating);
        return;
      }

      // 子が再描画直後に状態を取りに来た時
      if (type === "REQUEST_STATE") {
        sendSnapshotToChild(janStr, null);
        return;
      }
    };

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [
    userRatings,
    wishJansSet,
    closeUIsThen,
    navigate,
    addLocal,
    cartEnabled,
    CHILD_ORIGIN,
    storeContextKey,
  ]);

  //---------------------------------------------------------------------------------
  // 更新ボタン（SW更新があれば適用する関数）
  const applyServiceWorkerUpdateIfAny = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;

      // サーバ側に更新があるか確認
      try { await reg.update(); } catch {}

      // waiting が居れば即適用（controllerchange → index.js 側で1回reload）
      if (reg.waiting) {
        try { reg.waiting.postMessage({ type: "SKIP_WAITING" }); } catch {}
        return true;
      }
    } catch (e) {
      console.warn("[SW] update check failed:", e);
    }
    return false;
  }, []);

  //////2026.04.以下1セクション21行を上記を置き換え
  //---------------------------------------------------------------------------------
  // 更新ボタン（ボタンで呼ぶ手動更新）
  const runManualRefresh = useCallback(async () => {
    const seq = ++manualRefreshSeqRef.current;
    const startedAt = Date.now();

    // 体感：先に「できる範囲で同期」を走らせる
    const p1 = fetchPoints({ bust: true });
    const p2 = fetchBoot();
    const p3 = reloadAllowedJans();
    const p4 = syncRatedPanel();
    const p5 = applyServiceWorkerUpdateIfAny();

    try {
      await Promise.allSettled([p1, p2, p3, p4, p5]);
    } finally {
      if (seq !== manualRefreshSeqRef.current) return;
      setIframeNonce((n) => n + 1);
      console.log("[ManualRefresh] done", { ms: Date.now() - startedAt });
    }
  }, [fetchPoints, fetchBoot, reloadAllowedJans, syncRatedPanel, applyServiceWorkerUpdateIfAny]);

  //////2026.04.以下1セクションを置き換え
  // unmount時は進行中の fetch を止める
  useEffect(() => {
    return () => {
      try { pointsAbortRef.current?.abort?.(); } catch {}
      try { bootAbortRef.current?.abort?.(); } catch {}
      //////2026.05.以下1行を追加
      try { qrContextAbortRef.current?.abort?.(); } catch {}
    };
  }, []);  

  //=================================================================================
  // ====== レンダリング
  return (
    <div id="map-root" className="map-root" tabIndex={-1}>
      <MapCanvas
        //////data={data}
        //////////2026.04.以下1行を追加
        //////basePoints={basePoints}
        //////// 店舗集合（意味の集合）：信頼できる時だけ意味を持つ
        //////storeJansSet={storeJansSet}
        //////// 描画用の主集合    - 参照安定：毎回 new Set しない
        //////visibleJansSet={visibleJansSetForCanvas}
        //////// EC専用JAN（星・色替え用）
        //////ecOnlyJansSet={ecOnlyJansSet instanceof Set ? ecOnlyJansSet : new Set()}
        //////// 表示許可集合（フェード/非表示制御）    - 空Setは未確定扱いで null（制限なし）へ寄せる
        //////allowedJansSet={allowedJansSetForCanvas}
        //////2026.05.以下6行と置き換え
        data={qrVisiblePoints}
        basePoints={[]}
        storeJansSet={qrVisibleJansSet}
        visibleJansSet={visibleJansSetForCanvas}
        ecOnlyJansSet={ecOnlyJansSet instanceof Set ? ecOnlyJansSet : new Set()}
        allowedJansSet={allowedJansSetForCanvas}
        userRatings={userRatings}
        selectedJAN={selectedJAN}
        //////2026.04.以下1行を追加
        highlightedJAN={highlightedJAN}
        wishJansSet={wishJansSet}
        wishVersion={wishVersion}
        highlight2D={highlight2D}
        userPin={userPin}
        panBounds={panBounds}
        viewState={viewState}
        setViewState={setViewState}
        onOpenSlider={() => navigate("/slider")}
        //////2026.04.以下4行と置き換え（アクセスログ含む）
        onPickWine={async (item) => {
          if (!item) return;
          await openWine(item, { source: "map" });
       }}
        clusterColorMode={clusterColorMode}
        edgeMarginXPx={50}
        edgeMarginYPx={400}
        basePoint={basePoint}
      />

      {/* QR用メッセージ */}
      {!qrContextLoading && !qrContext && qrVisiblePoints.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.92)",
            fontSize: 14,
            color: "#555",
            textAlign: "center",
            padding: 24,
            lineHeight: 1.8,
          }}
        >
          QRコードからアクセスすると<br />
          店舗または輸入元の商品マップが表示されます
        </div>
      )}
    
      {/* 左上ボタン群: 指標セレクタ + クラスタ配色 */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: UI_Z_TOP,
          display: "flex",
          alignItems: "center",
          gap: "6px", // セレクタとボタンの間隔
          pointerEvents: "auto",
        }}
      >
        {/* 指標セレクタ選択ボタン */}
        <div style={{ position: "relative", display: "inline-block" }}>
          <select
            value={highlight2D}
            onChange={(e) => setHighlight2D(e.target.value)}
            style={{
              padding: "6px 28px 6px 8px",
              fontSize: "8px",
              color: "#666",
              backgroundColor: "#fff",
              border: "0.5px solid #000",
              borderRadius: "6px",
              outline: "none",
              appearance: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
            }}
          >
            <option value="">基本マップ</option>
            <option value="pc3">酸味</option>
            <option value="pc2">甘味</option>
            <option value="pc1">ボディ</option>
          </select>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              fontSize: 12,
              color: "#666",
            }}
          >
            ▼
          </span>
        </div>

        {/* クラスタ配色ボタン */}
        <button
          onClick={async () => {
            const next = !clusterColorMode;
            if (next) {
              setIsClusterOpen(true);
            } else {
              setIsClusterOpen(false);
              setClusterCollapseKey(null);
            }
            setClusterColorMode(next);
          }}
          style={{
            width: "30px",
            height: "30px",
            background: "#fff",
            border: "0.5px solid #000",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
          aria-label="クラスタ配色"
          title="クラスタ配色"
        >
          <img
            src={`${process.env.PUBLIC_URL || ""}/img/icon-colour.png`}
            alt=""
            style={{
              width: "95%",
              height: "95%",
              objectFit: "contain",
              display: "block",
              pointerEvents: "none",
              opacity: clusterColorMode ? 1.0 : 0.5,
              transition: "opacity 0.2s",
            }}
            draggable={false}
          />
        </button>
      </div>

      {/* 2026.05.以下追加 */}
      {/* 左下（ギアボタン）: アプリガイド */}
      <button
        onClick={() => openPanel("mypage")}
        style={{
          position: "absolute",
          left: "10px",
          bottom: "18px",
          zIndex: UI_Z_TOP,
          width: "42px",
          height: "42px",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(0,0,0,0.25)",
          borderRadius: "50%",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          pointerEvents: "auto",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
        aria-label="アプリガイド"
        title="アプリガイド"
      >
        <span style={{ fontSize: 24, lineHeight: 1 }}>⚙️</span>
      </button>

      {/* 右上: アプリガイド */}
      {/* 2026.05.以下と置き換え
      <button
        onClick={() => openPanel("mypage")}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: UI_Z_TOP,
          width: "40px",
          height: "40px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          pointerEvents: "auto",
        }}
        aria-label="アプリガイド"
        title="アプリガイド"
      >
        <img
          src={`${process.env.PUBLIC_URL || ""}/img/app-guide.svg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      </button>
      */}
      {/* 右上ボタン群: 基準のワイン/スライダーボタン */}
      <button
        onClick={() => navigate("/slider", { replace: false, state: { from: "map" } })}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: UI_Z_TOP,
          width: "40px",
          height: "40px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          pointerEvents: "auto",
        }}
        aria-label="基準のワイン"
        title="基準のワイン"
      >
        <img
          src={`${process.env.PUBLIC_URL || ""}/img/app-guide.svg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      </button>

      {/* 右上ボタン群: 検索パネルボタン */}
      <button
        onClick={async () => {
          // 先に開く（体感速度優先）
          openPanel("search");
        }}
        style={{
          pointerEvents: "auto",
          position: "absolute",
          top: "60px",
          right: "10px",
          zIndex: UI_Z_TOP,
          width: "40px",
          height: "40px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        aria-label="検索"
        title="検索"
      >
        <img
          src={`${process.env.PUBLIC_URL || ""}/img/search.svg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      </button>

      {/* 右上ボタン群: 評価パネルボタン */}
      <button
        onClick={async () => {
          // 先に開く（体感速度優先）
          openPanel("rated");
        }}
        style={{
          /* 110px */
          pointerEvents: "auto",
          position: "absolute",
          top: "110px",
          right: "10px",
          zIndex: UI_Z_TOP,
          width: "40px",
          height: "40px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        aria-label="評価一覧"
        title="評価（◎）一覧"
      >
        <img
          src={`${process.env.PUBLIC_URL || ""}/img/hyouka.svg`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      </button>

      {/* 右上ボタン群: カートパネルボタン */}
      {false && cartEnabled && (
      <button
        onClick={() => openPanel("cart")}
        style={{
          /* 160px */
          pointerEvents: "auto",
          position: "absolute",
          top: "160px",
          right: "10px",
          zIndex: UI_Z_TOP,
          width: "40px",
          height: "40px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        aria-label="カートを開く"
        title="カートを開く"
      >
        <img
          src={`${process.env.PUBLIC_URL || ""}/img/icon-cart1.png`}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
        {totalQty > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              backgroundColor: "#111",
              color: "#fff",
              borderRadius: "50%",
              fontSize: "10px",
              lineHeight: "1",
              width: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #fff",
            }}
          >
            {totalQty}
          </span>
        )}
      </button>
      )}

      {/* ====== 検索パネル ====== */}
      <SearchPanel
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        data={searchPanelData}
        //////2026.04.上記を以下の8行と置き換え（アクセスログ含む）
        onPick={async (item) => {
          if (!item) return;
          await openWine(item, {
            preserveSearch: true,
            zoom: viewState.zoom,
            source: "search",
          });
        }}        
        onScanClick={async () => {
          await closeUIsThen({ preserveCluster: true });
          setIsScannerOpen(true);
        }}
      />

      {/* バーコードスキャナ */}
      <BarcodeScanner
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={async (codeText) => {
          const isValidEan13 = (ean) => {
            if (!/^\d{13}$/.test(ean)) return false;
            let sum = 0;
            for (let i = 0; i < 12; i++) {
              const d = ean.charCodeAt(i) - 48;
              sum += i % 2 === 0 ? d : d * 3;
            }
            const check = (10 - (sum % 10)) % 10;
            return check === ean.charCodeAt(12) - 48;
          };

          let jan = String(codeText).replace(/\D/g, "");
          if (jan.length === 12) jan = "0" + jan;
          if (jan.length !== 13 || !isValidEan13(jan)) {
            alert(`JAN: ${jan} は無効なバーコードです。`);
            return false;
          }

          const now = Date.now();
          let bypassThrottle = false;
          try {
            const until = Number(
              sessionStorage.getItem(REREAD_LS_KEY) || 0
            );
            bypassThrottle = until > 0 && now < until;
          } catch {}

          if (!bypassThrottle) {
            if (
              jan === lastCommittedRef.current.code &&
              now - lastCommittedRef.current.at < 60000
            ) {
              return false;
            }
          }

          const hit = data.find(
            (d) => String(getJanFromItem(d)) === jan
          );
          //////2026.04.上記を以下の8行と置き換え（アクセスログ含む）
          if (hit) {
            const janStr = getJanFromItem(hit);
            if (!janStr) return false;
          
            lastCommittedRef.current = { code: jan, at: now };
            await openWine(hit, { zoom: INITIAL_ZOOM, source: "scan" });
            return true;
          }          
          const lastWarn = unknownWarnedRef.current.get(jan) || 0;
          if (now - lastWarn > 12000) {
            alert(`JAN: ${jan} は見つかりませんでした。`);
            unknownWarnedRef.current.set(jan, now);
          }
          return false;
        }}
      />

      {/* ====== 評価・飲みたいパネル ====== */}
      <RatedPanel
        isOpen={isRatedOpen}
        onClose={async () => {
          await closeUIsThen({ preserveCluster: true });
        }}
        //////2026.04.上記を以下の10行と置き換え（アクセスログ含む）
        onSelectJAN={async (jan) => {
          try {
            sessionStorage.setItem("tm_from_rated_jan", String(jan));
          } catch {}
          await openWine(String(jan), {
            preserveRated: true,
            zoom: INITIAL_ZOOM,
            source: "rated",
          });
        }}
      />

      <ClusterPalettePanel
        isOpen={isClusterOpen}
        onClose={() => {
          setIsClusterOpen(false);
          setClusterCollapseKey(null);
        }}
        height={DRAWER_HEIGHT}
        onPickCluster={centerToCluster}
        availableIds={clusterList} // 追加：存在クラスターのみ出す場合
        collapseKey={clusterCollapseKey}
      />

      {/* ====== 商品詳細ページドロワー ====== */}
      <Drawer
        anchor="bottom"
        open={productDrawerOpen}
        onClose={() => {
          setProductDrawerOpen(false);
          setSelectedJAN(null);
        }}
        sx={{ zIndex: 1700, pointerEvents: "none" }}
        hideBackdrop
        BackdropProps={{
          style: { background: "transparent", pointerEvents: "none" },
        }}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true, // フォーカスロック解除
          disableAutoFocus: true, // 自動フォーカスを抑止
          disableRestoreFocus: true, // 閉じた後のフォーカス復元も抑止
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
          },
          sx: { pointerEvents: "auto" },
        }}
      >
        <PanelHeader
          title="商品ページ"
          icon="dot.svg"
          onClose={() => {
            setProductDrawerOpen(false);
            setSelectedJAN(null);
          }}
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
        >
          {selectedJAN ? (
            <iframe
              title={`product-${selectedJAN || "preview"}`}
              ref={iframeRef}
              key={productIframeSrc}   // URLが変われば確実に差し替え 2026.01.
              src={productIframeSrc}
              style={{ width: "100%", height: "100%", border: "none" }}
              onLoad={() => {
                try {
                  requestAnimationFrame(() => {
                    iframeRef.current?.contentWindow?.postMessage(
                      {
                        type: "REQUEST_STATE",
                        ctx: String(storeContextKey || ""),
                        jan: String(selectedJAN),
                      },
                      CHILD_ORIGIN
                    );
                  });
                } catch {}
              }}
            />
          ) : (
            <div style={{ padding: 16, color: "#555" }}>
              商品を選択するとページが表示されます。
            </div>
          )}
        </div>
      </Drawer>

      {/* ====== カートパネル（SimpleCartPanel）====== */}
      <Drawer
        id="cart-drawer"
        anchor="bottom"
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        sx={{ zIndex: 1850, pointerEvents: "none" }} // MapGuideより手前/後ろはお好みで
        BackdropProps={{
          style: {
            background: "transparent",
            pointerEvents: "none",
          },
        }}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true, // フォーカスロック解除
          disableAutoFocus: true, // 自動フォーカス抑止
          disableRestoreFocus: true, // フォーカス復元抑止
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
            outline: "none",
          },
          sx: { pointerEvents: "auto" },
        }}
      >
        <PanelHeader
          title="ECカート"
          icon="icon-cart2.png"
          iconSize={30}
          onClose={() => setCartOpen(false)}
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
          tabIndex={-1}
          data-autofocus="cart"
        >
          {/* isOpen を渡しておくと在庫チェックの依存が素直になる */}
          <SimpleCartPanel
            isOpen={cartOpen}
            onClose={() => setCartOpen(false)}
          />
        </div>
      </Drawer>

      {/* ====== アプリガイド（メニュー）====== */}
      <Drawer
        anchor="bottom"
        open={isMyPageOpen}
        onClose={() => setIsMyPageOpen(false)}
        sx={{ zIndex: 1400, pointerEvents: "none" }}
        hideBackdrop
        BackdropProps={{
          style: { background: "transparent", pointerEvents: "none" },
        }}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true, // フォーカスロック解除
          disableAutoFocus: true, // 自動フォーカスを抑止
          disableRestoreFocus: true, // 閉じた後のフォーカス復元も抑止
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: { pointerEvents: "auto" },
        }}
      >
        <PanelHeader
          title="アプリガイド"
          icon="app-guide.svg"
          onClose={() => setIsMyPageOpen(false)}
        />
        <MyPagePanelContent
          onOpenCart={() => openOverlayAboveMenu("cart")}
          onOpenMapGuide={() => openOverlayAboveMenu("mapguide")}
          onOpenStore={() => openOverlayAboveMenu("store")}
          onOpenAccount={() => openOverlayAboveMenu("account")}
        //2026.05.  onOpenMiles={() => openOverlayAboveMenu("miles")}
          onOpenFaq={() => openOverlayAboveMenu("faq")}
          onOpenRefresh={() => openOverlayAboveMenu("refresh")}
          onOpenSlider={() => {
            setIsMyPageOpen(false);
            navigate("/slider", { replace: false, state: { from: "menu" } });
          }}
        />
      </Drawer>

      {/* ====== あなたの味覚位置パネル ====== */}
      <Drawer
        anchor="bottom"
        open={isTastePositionOpen}
        onClose={() => setIsTastePositionOpen(false)}
        sx={{ zIndex: 1800, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,
        }}
      >
        <PanelHeader
          title="あなたの味覚位置"
          icon="app-guide.svg"
          onClose={() => setIsTastePositionOpen(false)}
        />
        <div className="drawer-scroll" style={{ flex: 1, overflowY: "auto" }}>
          <TastePositionPanelContent
            userPin={userPin}
            clusterId={tastePositionClusterId}
          />
        </div>
      </Drawer>

      {/* ====== マップガイドパネル ====== */}
      <Drawer
        anchor="bottom"
        open={isMapGuideOpen}
        onClose={() => setIsMapGuideOpen(false)}
        sx={{ zIndex: 1800, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,          
        }}
      >
        <PanelHeader
          title="マップガイド"
          icon="map-guide.svg"
          onClose={() => setIsMapGuideOpen(false)}
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
        >
          <MapGuidePanelContent />
        </div>
      </Drawer>

      {/* ====== マイアカウントパネル ====== */}
      <Drawer
        anchor="bottom"
        open={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        sx={{ zIndex: 1500, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,
        }}
      >
        <PanelHeader
          title="マイアカウント"
          icon="account.svg"
          onClose={() => setIsAccountOpen(false)}
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
        >
          <MyAccountPanelContent
            onOpenTerms={() => setIsTermsOpen(true)}
          />
        </div>
      </Drawer>

      {/* ====== お気に入り店舗登録パネル ====== */}
      <Drawer
        anchor="bottom"
        open={isStoreOpen}
        onClose={() => setIsStoreOpen(false)}
        sx={{ zIndex: 1500, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,          
        }}
      >
        <PanelHeader
          title="お気に入り店舗登録"
          icon="store.svg"
          onClose={() => setIsStoreOpen(false)} // ← 子だけ閉じる
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
        >
          <StorePanelContent />
        </div>
      </Drawer>

      {/* ====== 獲得マイルパネル ====== */}
      <Drawer
        anchor="bottom"
        open={isMilesOpen}
        onClose={() => setIsMilesOpen(false)}
        sx={{ zIndex: 1500, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,          
        }}
      >
        <PanelHeader
          title="獲得マイル"
          icon="icon-cart2.png"
          iconSize={30}
          onClose={() => setIsMilesOpen(false)}
        />
        <div className="drawer-scroll" style={{ flex: 1, overflowY: "auto" }}>
          <MilesPanelContent />
        </div>
      </Drawer>

      {/* ====== よくある質問パネル ====== */}
      <Drawer
        anchor="bottom"
        open={isFaqOpen}
        onClose={() => setIsFaqOpen(false)}
        sx={{ zIndex: 1500, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,          
        }}
      >
        <PanelHeader
          title="よくある質問"
          icon="faq.svg"
          onClose={() => setIsFaqOpen(false)}
        />
        <div
          className="drawer-scroll"
          style={{ flex: 1, overflowY: "auto" }}
        >
          <FaqPanelContent />
        </div>
      </Drawer>

      {/* ====== 更新ボタンパネル ====== */}
      <Drawer
        anchor="bottom"
        open={isRefreshOpen}
        onClose={() => setIsRefreshOpen(false)}
        sx={{ zIndex: 1500, ...passThroughDrawerSx }}
        hideBackdrop
        BackdropProps={passThroughBackdropProps}
        ModalProps={{
          ...drawerModalProps,
          keepMounted: true,
          disableEnforceFocus: true,
          disableAutoFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        PaperProps={{
          style: {
            ...paperBaseStyle,
            borderTop: "1px solid #c9c9b0",
            height: DRAWER_HEIGHT,
            display: "flex",
            flexDirection: "column",
          },
          sx: passThroughPaperSx,
        }}
      >
        <PanelHeader
          title="更新ボタン"
          icon="refresh.svg"
          iconSize={38}
          onClose={() => setIsRefreshOpen(false)}
        />
        <div className="drawer-scroll" style={{ flex: 1, overflowY: "auto" }}>
          <RefreshPanelContent onRefresh={runManualRefresh} />
        </div>
      </Drawer>

      {/* ====== 下部中央: 「○○さんの地図」ラベル ====== */}
      {(() => {
        try {
          const token = localStorage.getItem("app.access_token");
          if (!token) return null; // ログアウト → 非表示

          if (!userDisplayName) return null;

         // RatedPanel 表示中は、ラベルがパネル内に透けるので消す
         if (isRatedOpen) return null;

          return (
            <div
              style={{
                position: "absolute",
                bottom: 30,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: UI_Z_TOP,
                pointerEvents: "none", // 地図操作の邪魔をしない
              }}
            >
              <div
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: "transparent",
                  backdropFilter: "none",
                  fontSize: 12,
                  color: "#333",
                  whiteSpace: "nowrap",
                  border: "none",
                }}
              >
                {userDisplayName} さんの地図
              </div>
            </div>
          );
        } catch {
          return null;
        }
      })()}

      {/* ===== 利用規約（全画面オーバーレイ） ===== */}
      {isTermsOpen && (
        <TermsPage onClose={() => setIsTermsOpen(false)} />
      )}
    </div>
  );
}

export default MapPage;
