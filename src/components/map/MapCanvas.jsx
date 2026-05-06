// src/components/map/MapCanvas.jsx
// マップ描画
// - 打点表示（MapPage から渡された扱いをどう表現するか）が責務
import React, { forwardRef, useMemo, useRef, useCallback, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import {
  ScatterplotLayer,
  LineLayer,
  PathLayer,
  IconLayer,
  BitmapLayer,
} from "@deck.gl/layers";
import {
  ZOOM_LIMITS,
  GRID_CELL_SIZE,
  HEAT_GAMMA,
  HEAT_CLIP_PCT,
//////2026.04.以下の1行を削除  
//  MAP_POINT_COLOR,
  getClusterRGBA,
  // wishlist（飲みたい）★は constants を正とする（色/サイズの調整点を一本化）
  WISH_STAR_COLOR,
  WISH_STAR_SIZE,
  MAP_POINT_RADIUS,
  MAP_POINT_RADIUS_CLUSTER,
} from "../../ui/constants";

const BLACK = [0, 0, 0, 255];
// constants の色を正とする（RGBだけ使う）
const WISH_STAR_RGBA = WISH_STAR_COLOR; // [178, 53, 103, 255] を想定
const STAR_ORANGE = [247, 147, 30, 255]; // #F7931E くらいのオレンジ
const TILE_GRAY = `${process.env.PUBLIC_URL || ""}/img/gray-tile.png`;
const TILE_OCHRE = `${process.env.PUBLIC_URL || ""}/img/ochre-tile.png`;
//////2026.04.以下3行を追加
//////2026.05.以下3行を削除、1行を追加
//////const BASE_GRAY = [160, 160, 160, 220];          // 新base
//////const STORE_ORANGE = STAR_ORANGE;                // 既存グレー → オレンジ
//////const EC_YELLOW = [235, 220,  80, 255];          // 既存オレンジ → 黄色
const QR_POINT_ORANGE = STAR_ORANGE;

// ===== 正規化ユーティリティ（MapPageと整合）2025.12.20.追加=====
const toNumOrNull = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const janOf = (d) => {
  const v =
    d?.jan_code ??
    d?.jan ??
    d?.JAN ??
    d?.barcode ??
    d?.BARCODE ??
    null;
  return v === null || v === undefined ? "" : String(v).trim();
};

const xOf = (d) => {
  const raw = d?.umap_x ?? d?.UMAP1 ?? d?.x ?? d?.X ?? null;
  return toNumOrNull(raw);
};
const yOf = (d) => {
  const raw = d?.umap_y ?? d?.UMAP2 ?? d?.y ?? d?.Y ?? null;
  return toNumOrNull(raw);
};

const clusterOf = (d) => toNumOrNull(d?.cluster ?? d?.CLUSTER ?? null);
// ここまで 正規化ユーティリティ 2025.12.20.追加

const ANCHOR_JAN = "4964044046324";

// （嗜好重心ピン）
const makePinSVG = ({
  fill = "#2A6CF7",        // 本体色
  stroke = "#FFFFFF",      // 縁取り
  strokeWidth = 2,
  innerFill = "#FFFFFF",   // 中の丸
} = {}) => {
  const w = 64, h = 96; // 描画サイズ（アンカー基準用）
  // しずく型のピン（先端は下）
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="M32 4
             C19 4 9 14 9 28
             C9 47 32 79 32 79
             C32 79 55 47 55 28
             C55 14 45 4 32 4 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
    <circle cx="32" cy="28" r="9" fill="${innerFill}"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    width: w,
    height: h,
    anchorX: w / 2,   // 先端が座標に刺さるよう、Xは中央
    anchorY: h - 1,   // Yは最下点付近（微調整は -1/-2 で）
  };
};

// （飲みたい星）IconLayer 用
const makeStarSVG = ({ color = "#9aa0a6" } = {}) => {
  const w = 64, h = 64;
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 64 64">
    <path d="M32 6
             L39.6 22.4
             L57.6 24.8
             L44.2 37.6
             L47.6 55.6
             L32 47
             L16.4 55.6
             L19.8 37.6
             L6.4 24.8
             L24.4 22.4
             Z"
          fill="${color}" />
  </svg>`;
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    width: w,
    height: h,
    anchorX: w / 2,
    anchorY: h / 2,
  };
};

// クリック時に最近傍を許可する半径（px）
const CLICK_NEAR_PX = 24; // お好みで 14〜24 あたり

// パンのクランプ切替
const PAN_CLAMP = true;

// デフォルト余白（px）
const DEFAULT_EDGE_MARGIN_X_PX = 8;   // 横
const DEFAULT_EDGE_MARGIN_Y_PX = 20;  // 縦

/** px → world（Orthographic） */
function pxToWorld(zoom, px) {
  const scale = Math.pow(2, Number(zoom) || 0);
  return (px || 0) / (scale || 1);
}

// --- 小ユーティリティ ---
const EPS = 1e-9;
const toIndex = (v) => Math.floor((v + EPS) / GRID_CELL_SIZE);
const toCorner = (i) => i * GRID_CELL_SIZE;
const keyOf = (ix, iy) => `${ix},${iy}`;

// 実際に見えているビューポート px（Safari の URL バーを除外）
function getEffectiveSizePx(sizePx) {
  let w = Math.max(1, sizePx?.width || 1);
  let h = Math.max(1, sizePx?.height || 1);
  if (typeof window !== "undefined" && window.visualViewport) {
    const vvW = Math.floor(window.visualViewport.width || 0);
    const vvH = Math.floor(window.visualViewport.height || 0);
    if (vvW > 0) w = vvW;
    if (vvH > 0) h = vvH;
  }
  return { width: w, height: h };
}

// 画面サイズ（px）とズームから世界座標の半幅・半高
function halfSizeWorld(zoom, sizePx) {
  const scale = Math.pow(2, Number(zoom) || 0);
  const { width: w, height: h } = getEffectiveSizePx(sizePx);
  return { halfW: w / (2 * scale), halfH: h / (2 * scale) };
}

// ===== パン可動域クランプ（“ギリ見える”余白つき） =====
function clampViewState(nextVS, panBounds, sizePx, margins = {}) {
  const zoom = Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, nextVS.zoom));
  if (!PAN_CLAMP) return { ...nextVS, zoom };

  const t0 = Array.isArray(nextVS?.target) ? nextVS.target : [0, 0, 0];
  const tx = Number(t0[0]) || 0;
  const ty = Number(t0[1]) || 0;

  const { halfW, halfH } = halfSizeWorld(zoom, sizePx);
  const xmin = panBounds?.xmin ?? -Infinity;
  const xmax = panBounds?.xmax ?? Infinity;
  const ymin = panBounds?.ymin ?? -Infinity;
  const ymax = panBounds?.ymax ?? Infinity;

  // 画面端に「X=edgeMarginXPx, Y=edgeMarginYPx」だけデータが残るように
  const pxX = margins.xPx ?? DEFAULT_EDGE_MARGIN_X_PX;
  const pxY = margins.yPx ?? DEFAULT_EDGE_MARGIN_Y_PX;
  const mX = pxToWorld(zoom, pxX);
  const mY = pxToWorld(zoom, pxY);

  const worldW = xmax - xmin;
  const worldH = ymax - ymin;

  let minX, maxX, minY, maxY;

  if (worldW >= 2 * halfW) {
    // ふつうに“ギリ見える”クランプ
    minX = xmin + halfW - mX;
    maxX = xmax - halfW + mX;
  } else {
    // 画面の方が横に広い → “仮想余白”で可動域を確保
    const cx = (xmin + xmax) / 2;
    const lackX = 2 * halfW - worldW; // どれだけ足りないか
    const slackX = lackX * 0.5 + mX;  // 左右に半分ずつ + マージン
    minX = cx - slackX;
    maxX = cx + slackX;
  }

  if (worldH >= 2 * halfH) {
    // ふつうに“ギリ見える”クランプ
    minY = ymin + halfH - mY;
    maxY = ymax - halfH + mY;
  } else {
    // 画面の方が高い → “仮想余白”を作って可動域を確保
    const cy = (ymin + ymax) / 2;
    const lack = 2 * halfH - worldH;             // どれだけ足りないか
    const slack = lack * 0.5 + mY;               // 上下に半分ずつ＋マージン
    minY = cy - slack;
    maxY = cy + slack;
  }

  const EPS_EDGE = 1e-6;
  const x = Math.max(minX + EPS_EDGE, Math.min(maxX - EPS_EDGE, tx));
  const y = Math.max(minY + EPS_EDGE, Math.min(maxY - EPS_EDGE, ty));
  return { ...nextVS, zoom, target: [x, y, 0] };
}

const MapCanvas = forwardRef(function MapCanvas(
  {
    data,
    //////2026.04.以下の1行を追加
//////    basePoints,
    visibleJansSet,
    allowedJansSet,
    ecOnlyJansSet,
    userRatings,
//////    selectedJAN,
    //////2026.04.以下の1行を追加
    highlightedJAN,
    wishJansSet,
    wishVersion,
    highlight2D,
    userPin,
    compassPoint,
    panBounds,
    viewState,
    setViewState,
    onPickWine,
    onOpenSlider,
    edgeMarginXPx = 8,
    edgeMarginYPx = 20,
    clusterColorMode = false,
//////    basePoint,
  },
  deckRef   // ref を受け取る
) {
  // --- DeckGL ref（親refがnullでも落ちないように内部refへ集約） ---
  const localDeckRef = useRef(null);
  const setDeckRef = useCallback(
    (node) => {
      // DeckGL instance（@deck.gl/react）の参照
      localDeckRef.current = node;

      // 親から forwardRef が渡っていれば同期（関数ref/オブジェクトref両対応）
      if (!deckRef) return;
      if (typeof deckRef === "function") {
        deckRef(node);
      } else {
        deckRef.current = node;
      }
    },
    [deckRef]
  );

  // --- refs ---
  const sizeRef = useRef({ width: 1, height: 1 });
  const interactingRef = useRef(false);
  const clampRAF = useRef(0);

  const clampZoomOnly = (vs) => ({
    ...vs,
    zoom: Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, vs.zoom)),
  });

  // 背景ビットマップの敷き範囲（常に画面外まで）
  const bgBounds = useMemo(() => {
    const { halfW, halfH } = halfSizeWorld(viewState.zoom, sizeRef.current);
    const cx = viewState?.target?.[0] ?? 0;
    const cy = viewState?.target?.[1] ?? 0;
    const K = 8; // 余裕係数
    return [cx - K * halfW, cy - K * halfH, cx + K * halfW, cy + K * halfH];
  }, [viewState.zoom, viewState.target]);

  // --- 店舗情報に基づいて打点をフィルタするデータ ---
  const filteredData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];

    // 描画用の主集合（visible）：
    // - MapPage が「allowedが取れないときは全打点Set」を渡してくる前提
    // - ここでは“表示”の入口としてだけ使う（意味集合とは混ぜない）
    // - ログアウト直後や通信失敗で空Setになると打点が全消しになるため
    // - “空Set” は無効（＝絞り込み無し扱い）にして全消しを防ぐ
    // - allowedJansSet: null/undefined は「制限なし」なので allowMode=false（=フィルタの根拠なし）にする
    // - Set かつ size>0 のときだけ「店舗許可集合として有効」
    const hasVisible = visibleJansSet instanceof Set && visibleJansSet.size > 0;
    const allowMode  = allowedJansSet instanceof Set && allowedJansSet.size > 0;
    const ecMode     = ecOnlyJansSet instanceof Set && ecOnlyJansSet.size > 0;

    // ① まず visibleJansSet があれば、それに含まれるものだけを候補にする
    //    （visible が無い場合は従来通り data 全体を候補）
    const base = hasVisible
      ? data.filter((d) => {
          const jan = janOf(d);
          return !!jan && visibleJansSet.has(jan);
        })
      : data;

    // ② allowedJansSet === null（未確定）または
    //    allowed/ecOnly ともに無効なら「制限なし」＝ base を返す
      if (!allowMode && !ecMode) return base;

    // ③ allowed/ecOnly がある場合は、従来通り集合でフィルタ
    return base.filter((d) => {
      const jan = janOf(d);
      if (!jan) return false;

      // 座標が壊れてる行はここで落とす（事故防止）
      const x = xOf(d), y = yOf(d);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      const allowStore = allowMode && allowedJansSet.has(jan);
      const allowEc    = ecMode && ecOnlyJansSet.has(jan);

      return allowStore || allowEc;
    });
  }, [data, visibleJansSet, allowedJansSet, ecOnlyJansSet]);

  // --- EC専用 / 店舗商品 の振り分け ---
  //  憲法：表示判定の一次条件は “集合（allowed / ec_only）”
  //       activeStoreId は「店舗JANの解釈条件」としてのみ後段適用
  //  表示：店舗=●グレイ / EC専用=●オレンジ
  //  EC = ecOnly　　
  const { storePoints, ecPoints } = useMemo(() => {
    // 集合が無い = フィルタ無し → 全件を店舗●として表示
    const allowMode = allowedJansSet instanceof Set && allowedJansSet.size > 0;
    const ecMode    = ecOnlyJansSet instanceof Set && ecOnlyJansSet.size > 0;
    if (!allowMode && !ecMode) {
      return { storePoints: filteredData, ecPoints: [] };
    }

    const store = [];
    const ec = [];

    filteredData.forEach((d) => {
      const jan = janOf(d);
      if (!jan) return;

      // null/undefined の場合に .has() を呼ばない（MapPage の「null=制限なし」と整合）
      const isEc    = ecMode && ecOnlyJansSet.has(jan);
      const isStore = allowMode && allowedJansSet.has(jan) && !isEc;

      if (isStore) store.push(d);
      else if (isEc) ec.push(d);
    });

    return { storePoints: store, ecPoints: ec };
  }, [filteredData, allowedJansSet, ecOnlyJansSet]);

  //////2026.04.上記を以下の1セクション42行と置き換え
  // --- 商品打点に付くバブル用データ（highlight2D=PC1/PC2/PC3 などの値→t[0..1]へ正規化） ---
  // base層も既存文脈点も同じようにバブル対象にする
  const pointBubbles = useMemo(() => {
    if (!highlight2D) return [];

    //////2026.05.以下1行と置き換え
//////    const src = Array.isArray(basePoints) ? basePoints : [];
    const src = Array.isArray(filteredData) ? filteredData : [];

    // 値分布（外れ値カットは従来ヒートと同じ HEAT_CLIP_PCT を踏襲）
    const vals = src
      .map((d) => Number(d[highlight2D]))
      .filter((v) => Number.isFinite(v));
    if (!vals.length) return [];

    vals.sort((a, b) => a - b);
    const loIdx = Math.floor(HEAT_CLIP_PCT[0] * (vals.length - 1));
    const hiIdx = Math.floor(HEAT_CLIP_PCT[1] * (vals.length - 1));
    const lo = vals[loIdx];
    const hi = vals[hiIdx];
    const vHi = hi - lo < 1e-9 ? lo + 1e-9 : hi;

    // 各商品点へ t と座標を付与
    return src
      .map((d) => {
        const v = Number(d[highlight2D]);
        if (!Number.isFinite(v)) return null;

        let t = (v - lo) / ((vHi - lo) || 1e-9);
        t = Math.max(0, Math.min(1, Math.pow(t, HEAT_GAMMA))); // ガンマ補正

        const x = xOf(d);
        const y = yOf(d);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        return {
          jan: janOf(d),
          position: [x, -y, 0],
          t,
          cluster: clusterOf(d),
        };
      })
      .filter(Boolean);
  //////2026.05.以下1行と置き換え
//////  }, [basePoints, highlight2D]);
  }, [filteredData, highlight2D]);

  // 初期クランプ
  useEffect(() => {
    if (!PAN_CLAMP) return;
    const raf = requestAnimationFrame(() => {
      setViewState((curr) =>
        clampViewState(curr, panBounds, sizeRef.current, {
          xPx: edgeMarginXPx,
          yPx: edgeMarginYPx,
        })
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [panBounds, setViewState, edgeMarginXPx, edgeMarginYPx]);

  // visualViewport（URLバー出入り）
  useEffect(() => {
    if (!window.visualViewport) return;
    let timeoutId = 0;
    let animationId = 0;

    const onVV = () => {
      if (interactingRef.current) return;
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const vv = window.visualViewport;
        sizeRef.current = {
          width: Math.floor(vv?.width || sizeRef.current.width),
          height: Math.floor(vv?.height || sizeRef.current.height),
        };
        if (!PAN_CLAMP) return;
        cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(() => {
          setViewState((curr) =>
            clampViewState(curr, panBounds, sizeRef.current, {
              xPx: edgeMarginXPx,
              yPx: edgeMarginYPx,
            })
          );
        });
      }, 80);
    };

    window.visualViewport.addEventListener("resize", onVV, { passive: true });
    window.visualViewport.addEventListener("scroll", onVV, { passive: true });

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(animationId);
      window.visualViewport.removeEventListener("resize", onVV);
      window.visualViewport.removeEventListener("scroll", onVV);
    };
  }, [panBounds, setViewState, edgeMarginXPx, edgeMarginYPx]);

  // bfcache復帰 / 画面の向き変更
  useEffect(() => {
    if (!PAN_CLAMP) return;
    const refreshSize = () => {
      // visualViewport があれば優先して実画面サイズを取得
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const width  = Math.floor(vv?.width  || window.innerWidth  || sizeRef.current.width  || 1);
      const height = Math.floor(vv?.height || window.innerHeight || sizeRef.current.height || 1);
      sizeRef.current = { width, height };
    };
    const onPageShow = () => {
      refreshSize();
      setViewState((curr) =>
        clampViewState(curr, panBounds, sizeRef.current, { xPx: edgeMarginXPx, yPx: edgeMarginYPx })
      );
    };
    const onOrientation = () => {
      refreshSize();
      setViewState((curr) =>
        clampViewState(curr, panBounds, sizeRef.current, { xPx: edgeMarginXPx, yPx: edgeMarginYPx })
      );
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [panBounds, setViewState, edgeMarginXPx, edgeMarginYPx]);

  // --- グリッド線データ ---
  const { thinLines, thickLines } = useMemo(() => {
    const interval = GRID_CELL_SIZE;
    const thin = [];
    const thick = [];
    for (let i = -500; i <= 500; i++) {
      const x = i * interval;
      (i % 5 === 0 ? thick : thin).push({
        sourcePosition: [x, -100, 0],
        targetPosition: [x, 100, 0],
      });
      const y = i * interval;
      (i % 5 === 0 ? thick : thin).push({
        sourcePosition: [-100, y, 0],
        targetPosition: [100, y, 0],
      });
    }
    return { thinLines: thin, thickLines: thick };
  }, []);

  //////2026.05.以下1セクション削除
//////  //////2026.04.以下1セクション33行を追加
//////  // --- セル集計（base層用） ---
//////  const baseCells = useMemo(() => {
//////    const map = new Map();
//////    const src = Array.isArray(basePoints) ? basePoints : [];
//////
//////    src.forEach((d) => {
//////      const x = xOf(d);
//////      const y = yOf(d);
//////      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
//////
//////      const ix = toIndex(x);
//////      const iy = toIndex(-y);
//////      const key = keyOf(ix, iy);
//////
//////      if (!map.has(key)) {
//////        map.set(key, {
//////          ix,
//////          iy,
//////          position: [toCorner(ix), toCorner(iy)],
//////          center: [
//////            toCorner(ix) + GRID_CELL_SIZE / 2,
//////            toCorner(iy) + GRID_CELL_SIZE / 2,
//////            0,
//////          ],
//////          count: 0,
//////        });
//////      }
//////
//////      map.get(key).count += 1;
//////    });
//////
//////    return Array.from(map.values());
//////  }, [basePoints]);

  // --- セル集計（評価フラグ） ---
  const cells = useMemo(() => {
    const map = new Map();
    filteredData.forEach((d) => {
      const x = xOf(d);
      const y = yOf(d);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const ix = toIndex(x);
      const iy = toIndex(-y);
      const key = keyOf(ix, iy);
      if (!map.has(key)) {
        map.set(key, {
          ix,
          iy,
          position: [toCorner(ix), toCorner(iy)],
          center: [
            toCorner(ix) + GRID_CELL_SIZE / 2,
            toCorner(iy) + GRID_CELL_SIZE / 2,
            0,
          ],
          count: 0,
          hasRating: false,
        });
      }
      if ((userRatings?.[janOf(d)]?.rating ?? 0) > 0) {
        map.get(key).hasRating = true;
      }
      map.get(key).count += 1;
    });
    return Array.from(map.values());
  }, [filteredData, userRatings]);

  //////2026.04.以下の1セクション7行を追加
//////  // --- base層専用セル（既存文脈セルと重ならないものだけ） ---
//////  const baseOnlyCells = useMemo(() => {
//////    const usedKeys = new Set(
//////      (cells || []).map((c) => keyOf(c.ix, c.iy))
//////    );
//////    return (baseCells || []).filter((c) => !usedKeys.has(keyOf(c.ix, c.iy)));
//////  }, [baseCells, cells]);
  
  //////2026.04.上記を以下の1セクション40行に置き換え
  // ベクタで描く選択ドット
  const selectedDotLayers = useMemo(() => {
    if (!highlightedJAN) return [];

    //////2026.05.以下1行と置き換え
//////    const baseList = Array.isArray(basePoints) ? basePoints : [];
//////    const hit =
//////      baseList.find((d) => janOf(d) === String(highlightedJAN)) ||
//////      filteredData.find((d) => janOf(d) === String(highlightedJAN));
    const hit = filteredData.find((d) => janOf(d) === String(highlightedJAN));
      
    if (!hit || !Number.isFinite(xOf(hit)) || !Number.isFinite(yOf(hit))) return [];

    const pos = [xOf(hit), -yOf(hit), 0];
    const R = 0.1;

    // 外側の黒丸
    const outer = new ScatterplotLayer({
      id: "selected-dot-outer",
      data: [{ position: pos }],
      getPosition: (d) => d.position,
      getFillColor: [0, 0, 0, 255],
      radiusUnits: "meters",
      getRadius: R,
      pickable: false,
      parameters: { depthTest: false },
    });

    // 中の白丸（リングに見せる）
    const innerWhite = new ScatterplotLayer({
      id: "selected-dot-inner-white",
      data: [{ position: pos }],
      getPosition: (d) => d.position,
      getFillColor: [255, 255, 255, 255],
      radiusUnits: "meters",
      getRadius: R * 0.58,
      pickable: false,
      parameters: { depthTest: false },
    });

    return [outer, innerWhite];
  //////2026.05.以下1行と置き換え  
//////  }, [basePoints, filteredData, highlightedJAN]);
  }, [filteredData, highlightedJAN]);

  //////2026.05.以下1セクション削除
  //////2026.04.以下1セクション31行を追加（getFillColorのセクションを以下に変更済み）
  // --- レイヤ：base（常時表示の土台） ---
//////  const baseLayer = useMemo(() => {
//////    if (!Array.isArray(basePoints) || basePoints.length === 0) return null;
//////
//////    return new ScatterplotLayer({
//////      id: "base-points",
//////      data: basePoints,
//////      getPosition: (d) => {
//////        const x = xOf(d), y = yOf(d);
//////        return [x, -y, 0];
//////      },
//////      getFillColor: (d) => {
//////        const janStr = janOf(d);
//////        if (Number(userRatings?.[janStr]?.rating) > 0) return BLACK;
//////
//////        const c = clusterOf(d);
//////        if (clusterColorMode && Number.isFinite(c)) {
//////          return getClusterRGBA(c);
//////        }
//////
//////        return BASE_GRAY;
//////      },
//////      updateTriggers: {
//////        getFillColor: [userRatings, clusterColorMode],
//////      },
//////      radiusUnits: "meters",
//////      getRadius: clusterColorMode ? MAP_POINT_RADIUS_CLUSTER : MAP_POINT_RADIUS,
//////      pickable: true,
//////      parameters: { depthTest: false },
//////    });
//////  }, [basePoints, userRatings, clusterColorMode]);

  // --- レイヤ：打点（店舗商品＋通常点） ---
  const mainLayer = useMemo(
    () =>
      new ScatterplotLayer({
        id: "scatter",
        data: storePoints,  // ← 店舗商品を●で表示（憲法）
        getPosition: (d) => {
          const x = xOf(d), y = yOf(d);
          return [x, -y, 0];
        },
        getFillColor: (d) => {
          const janStr = janOf(d);
          if (Number(userRatings?.[janStr]?.rating) > 0) return BLACK;
          const c = clusterOf(d);
          if (clusterColorMode && Number.isFinite(c)) {
            return getClusterRGBA(c);
          }
          //////2026.04.以下1行を以下の1行と置き換え
          //return MAP_POINT_COLOR;
          //////2026.05.以下1行と置き換え
          //////return STORE_ORANGE;
          return QR_POINT_ORANGE;
        },
        updateTriggers: {
          getFillColor: [clusterColorMode, userRatings],
        },
        radiusUnits: "meters",
        getRadius: clusterColorMode ? MAP_POINT_RADIUS_CLUSTER : MAP_POINT_RADIUS,
        pickable: true,
      }),
     [storePoints, userRatings, clusterColorMode]
    );

  // --- デバッグ（集合ベース） ---
  useEffect(() => {
    // points.csv 由来の data には is_ec_product は基本載らない前提
    const a = allowedJansSet instanceof Set ? allowedJansSet.size : null;
    const e = ecOnlyJansSet instanceof Set ? ecOnlyJansSet.size : null;
    const v = visibleJansSet instanceof Set ? visibleJansSet.size : null;
    console.log("[MapCanvas] visibleJansSet size =", v);
    console.log("[MapCanvas] allowedJansSet size =", a, "ecOnlyJansSet size =", e, "allowedIsNull=", allowedJansSet == null);
    console.log("[MapCanvas] storePoints =", storePoints.length, "ecPoints =", ecPoints.length);
  }, [visibleJansSet, allowedJansSet, ecOnlyJansSet, storePoints.length, ecPoints.length]);

  //////2026.05.以下1セクションを削除
//////  // --- レイヤ：EC商品の●マーカー（オレンジ） ---
//////  const ecPointLayer = useMemo(() => {
//////    if (!ecPoints || ecPoints.length === 0) return null;
//////
//////    return new ScatterplotLayer({
//////      id: "ec-points",
//////      data: ecPoints.map((d) => ({
//////        __raw: d,
//////        jan: janOf(d),
//////        x: xOf(d),
//////        y: yOf(d),
//////        cluster: clusterOf(d),
//////      })),
//////      getPosition: (d) => [d.x, -d.y, 0],
//////      getFillColor: (d) => {
//////        const janStr = d.jan;
//////        if (Number(userRatings?.[janStr]?.rating) > 0) return BLACK;     // 評価ありは黒（上書き）
//////        if (clusterColorMode && Number.isFinite(d.cluster)) {
//////          return getClusterRGBA(d.cluster);
//////        }
//////        //////2026.04.以下の1行を以下の1行と置き換え
//////        //return STAR_ORANGE; // ← EC扱いはオレンジ●
//////        return EC_YELLOW;
//////      },
//////      updateTriggers: {
//////        getFillColor: [clusterColorMode, userRatings],
//////      },
//////      radiusUnits: "meters",
//////      getRadius: clusterColorMode ? MAP_POINT_RADIUS_CLUSTER : MAP_POINT_RADIUS,
//////      pickable: true,
//////      parameters: { depthTest: false },
//////    });
//////  }, [ecPoints, userRatings, clusterColorMode]);

  // --- レイヤ：飲みたい★---
  // 優先順位：rating > wished(★) > store/ec
  // 「wished(★)」は allowed-jans/auto（ログイン後） で返る wishJansSet を唯一ソースにする
  const wishStarLayer = useMemo(() => {
    const wishSet = wishJansSet instanceof Set ? wishJansSet : null;
    if (!wishSet || wishSet.size === 0) return null;

    // ★色（SVGはalphaを使わないのでRGBだけ）
    const wishColorCss = `rgb(${WISH_STAR_RGBA[0]}, ${WISH_STAR_RGBA[1]}, ${WISH_STAR_RGBA[2]})`;
    const icon = makeStarSVG({ color: wishColorCss });

    const wishPoints = filteredData
      .map((d) => {
        const jan = janOf(d);
        if (!jan) return null;
        if (!wishSet.has(jan)) return null; // wished=true（サーバ正）
        if ((Number(userRatings?.[jan]?.rating) || 0) > 0) return null; // rating優先
        const x = xOf(d), y = yOf(d);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { jan, position: [x, -y, 0] };
      })
      .filter(Boolean);

    if (wishPoints.length === 0) return null;

    return new IconLayer({
      id: "wish-stars",
      data: wishPoints,
      getPosition: (d) => d.position,
      getIcon: () => icon,
      sizeUnits: "meters",
      // サイズは constants を正とする
      getSize: () => WISH_STAR_SIZE,
      billboard: true,
      pickable: true,
      onClick: (info) => {
        const jan = info?.object?.jan;
        if (!jan) return;
        const hit = filteredData.find((d) => janOf(d) === String(jan));
        if (hit) onPickWine?.(hit);
      },
      parameters: { depthTest: false },
      updateTriggers: {
       getIcon: [wishSet.size, wishColorCss, wishVersion],
        getSize: wishVersion,
        getPosition: wishVersion,
      },
    });
  }, [filteredData, wishJansSet, userRatings, onPickWine, wishVersion]);

  // --- レイヤ：評価リング ---
  const ratingCircleLayers = useMemo(() => {
    const lineColor = [255, 0, 0, 255];
    return Object.entries(userRatings || {}).flatMap(([jan_code, ratingObj]) => {
      const item = filteredData.find(d => janOf(d) === String(jan_code));
      if (!item || !Number.isFinite(xOf(item)) || !Number.isFinite(yOf(item))) return [];
      const count = Math.min(Number(ratingObj?.rating) || 0, 5);
      if (count <= 0) return [];
      const radiusBase = 0.06;
      return Array.from({ length: count }).map((_, i) => {
        const steps = 40;
        const path = Array.from({ length: steps }, (_, j) => {
          const angle = (j / steps) * 2 * Math.PI;
          const radius = radiusBase * (i + 1);
          const x = xOf(item) + Math.cos(angle) * radius;
          const y = -yOf(item) + Math.sin(angle) * radius;
          return [x, y];
        });
        path.push(path[0]);
        return new PathLayer({
          id: `ring-${jan_code}-${i}`,
          data: [{ path }],
          getPath: (d) => d.path,
          getLineColor: () => lineColor,
          getWidth: 0.3,
          widthUnits: "pixels",
          parameters: { depthTest: false },
          pickable: false,
        });
      });
    });
  }, [filteredData, userRatings]);

  // --- レイヤ：嗜好コンパス（ユーザー重心）をピン化 ---
  const compassLayer = useMemo(() => {
    if (!compassPoint) return null;
    const icon = makePinSVG({
      fill: "#2A6CF7",       // お好みでブランドカラー等
      stroke: "#FFFFFF",
      strokeWidth: 2,
      innerFill: "#FFFFFF",
    });
    return new IconLayer({
      id: "preference-pin",
      data: [{ position: [compassPoint[0], -compassPoint[1], 0] }],
      getPosition: d => d.position,
      getIcon: () => icon,
      sizeUnits: "meters",
      getSize: 0.55,          // 見た目サイズ（調整ポイント）
      billboard: true,
      pickable: false,
      parameters: { depthTest: false },
    });
  }, [compassPoint]);

  // --- レイヤ：任意ユーザーピンをピン化（色違い） ---
  const userPinCompassLayer = useMemo(() => {
    if (!userPin) return null;
    const icon = makePinSVG({
      fill: "#F7931E",        // こちらは赤系などで区別
      stroke: "#FFFFFF",
      strokeWidth: 2,
      innerFill: "#FFFFFF",
    });
    return new IconLayer({
      id: "user-pin",
      data: [{ position: [userPin[0], -userPin[1], 0] }],
      getPosition: d => d.position,
      getIcon: () => icon,
      sizeUnits: "meters",
      getSize: 0.60,
      billboard: true,
      pickable: false,
      parameters: { depthTest: false },
    });
  }, [userPin]);

  //////2026.05.以下1セクションを削除　　必要なら最小 const anchorCompassLayer = null;
//////  // --- レイヤ：基準のワイン（常時表示コンパス） ---
//////  const anchorCompassLayer = useMemo(() => {
//////    let x = null;
//////    let yUMAP = null;
//////
//////    // ① MapPage から渡されたロット別の基準点を優先
//////    if (basePoint && Number.isFinite(basePoint.x) && Number.isFinite(basePoint.y)) {
//////      x = Number(basePoint.x);
//////      yUMAP = Number(basePoint.y);
//////    } else {
//////      // ② なければ従来通り ANCHOR_JAN の座標にフォールバック
//////      const item = filteredData.find(d => janOf(d) === ANCHOR_JAN);
//////      if (!item || !Number.isFinite(xOf(item)) || !Number.isFinite(yOf(item))) {
//////        return null;
//////      }
//////      x = xOf(item);
//////     yUMAP = yOf(item);
//////    }
//////
//////    return new IconLayer({
//////      id: "anchor-compass",
//////      data: [{ position: [x, -yUMAP, 0] }],  // y は DeckGL 用に反転
//////      getPosition: d => d.position,
//////      getIcon: () => ({
//////        url: `${process.env.PUBLIC_URL || ""}/img/compass.png`,
//////        width: 310,
//////        height: 310,
//////        anchorX: 155,
//////        anchorY: 155,
//////      }),
//////      sizeUnits: "meters",
//////      getSize: 0.5,
//////      billboard: true,
//////      pickable: true,               // クリック可能にする
//////      onClick: () => {              // コンパスをタップしたら SliderPage を開く
//////        onOpenSlider?.();
//////      },
//////      parameters: { depthTest: false },
//////    });
//////  }, [filteredData, basePoint, onOpenSlider]);

  // --- 近傍探索（クリック時） ---
  const findNearestWine = useCallback(
    (coord) => {
      if (!coord || !Array.isArray(filteredData) || filteredData.length === 0) return null;
      const [cx, cy] = coord;
      let best = null,
        bestD2 = Infinity;
      for (const d of filteredData) {
        const x0 = xOf(d);
        const y0 = yOf(d);
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
        const x = x0, y = -y0;
        const dx = x - cx,
          dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = d;
        }
      }
      return best;
    },
    [filteredData]
  );

  // --- 操作終了時クランプ ---
  const onInteractionStateChange = useCallback(
    (state) => {
      interactingRef.current =
        !!state?.isDragging || !!state?.isPanning || !!state?.isZooming;
      if (!PAN_CLAMP) return;
      if (!interactingRef.current) {
        cancelAnimationFrame(clampRAF.current);
        clampRAF.current = requestAnimationFrame(() => {
          setViewState((curr) =>
            clampViewState(curr, panBounds, sizeRef.current, {
              xPx: edgeMarginXPx,
              yPx: edgeMarginYPx,
            })
          );
        });
      }
    },
    [panBounds, setViewState, edgeMarginXPx, edgeMarginYPx]
  );

  return (
    <DeckGL
      ref={setDeckRef}   // 親refがnullでも落ちない安全なref
      views={new OrthographicView({ near: -1, far: 1 })}
      viewState={viewState}
      style={{ position: "absolute", inset: 0 }}
      useDevicePixels
      // キャンバスサイズ保持
      onResize={({ width, height }) => {
        sizeRef.current = getEffectiveSizePx({ width, height });
        if (!PAN_CLAMP) return;
        if (interactingRef.current) return;
        setViewState((curr) =>
          clampViewState(curr, panBounds, sizeRef.current, {
            xPx: edgeMarginXPx,
            yPx: edgeMarginYPx,
          })
        );
      }}
      // ユーザー操作中/後：ズームだけ即時クランプ、パンは“ギリ見える”範囲に
      onViewStateChange={({ viewState: vs, interactionState }) => {
        const isInteracting =
          !!interactionState?.isDragging ||
          !!interactionState?.isPanning ||
          !!interactionState?.isZooming;
        interactingRef.current = isInteracting;

        const next = clampZoomOnly(vs);
        setViewState(next);
      }}
      onInteractionStateChange={onInteractionStateChange}
      controller={{
        dragPan: true,
        dragRotate: false,
        minZoom: ZOOM_LIMITS.min,
        maxZoom: ZOOM_LIMITS.max,
        inertia: false,
        doubleClickZoom: false,
        touchZoom: true,
        scrollZoom: true,
      }}
      onClick={(info) => {
        // コンパス画像タップは最優先で処理して終わる（二重処理防止）
        if (info?.layer?.id === "anchor-compass") {
          onOpenSlider?.();
          return;
        }

        const deckHost = localDeckRef.current;
        const picked = info?.object;
        const pickedJan =
          picked?.jan ??
          janOf(picked?.__raw ?? picked);

        if (pickedJan) {
          const pickedData =
            picked.__raw ??
            picked;
          onPickWine?.(pickedData);
          return;
        }

        // クリック座標（world）を取る
        // 1) deck.gl が渡してくれる world 座標があればそれを最優先
        // 2) 無ければ pixel → unproject（DeckGLインスタンスが必要）
        const deck = deckHost?.deck || deckHost || null;       
        const world =
          info?.coordinate ??
          (info?.pixel ? deck?.unproject?.(info.pixel) : null);
        if (!world) return;

        // 最近傍（world座標で）
        const nearest = findNearestWine(world);
        if (!nearest) return;

        // ピクセルしきい値でフィルタ（px→worldへ換算して距離比較）
        const worldThresh = pxToWorld(viewState.zoom, CLICK_NEAR_PX);
        const dx = xOf(nearest) - world[0];
        const dy = (-yOf(nearest)) - world[1];
        if (dx * dx + dy * dy > worldThresh * worldThresh) {
          // 近くに点が無いタップ → 何もしない
          return;
        }

        // しきい値内なら開く
        //////2026.05.以下1行と置き換え
//////        if (janOf(nearest) === ANCHOR_JAN) {
//////          onOpenSlider?.();
//////        } else {
//////          onPickWine?.(nearest);
//////        }
        onPickWine?.(nearest);
      }}

      pickingRadius={12}
      layers={[
        // 背景（紙テクスチャ）
        new BitmapLayer({
          id: "paper-bg",
          image: `${process.env.PUBLIC_URL || ""}/img/paper-bg.png`,
          bounds: bgBounds,
          opacity: 1,
          parameters: { depthTest: false },
        }),

         // グリッド線
        new LineLayer({
          id: "grid-lines-thin",
          data: thinLines,
          getSourcePosition: (d) => d.sourcePosition,
          getTargetPosition: (d) => d.targetPosition,
          getColor: [214, 214, 214, 255],
          getWidth: 0.5,
          widthUnits: "pixels",
        }),
        new LineLayer({
          id: "grid-lines-thick",
          data: thickLines,
          getSourcePosition: (d) => d.sourcePosition,
          getTargetPosition: (d) => d.targetPosition,
          getColor: [144, 144, 144, 255],
          getWidth: 0.5,
          widthUnits: "pixels",
        }),

        //////2026.05.以下1セクションを削除
//////        //////2026.04.以下の1セクション23行を追加
//////        // ①-0 base層の地模様タイル / 既存文脈セルと重ならない部分だけ
//////        (!highlight2D && !clusterColorMode) ? new IconLayer({
//////          id: "base-cell-tiles",
//////          data: baseOnlyCells,          
//////          getPosition: (d) => d.center,
//////          getIcon: () => ({
//////            url: TILE_GRAY,
//////            width: 32,
//////            height: 32,
//////            anchorX: 16,
//////            anchorY: 16,
//////          }),
//////          sizeUnits: "meters",
//////          getSize: GRID_CELL_SIZE,
//////          billboard: true,
//////          pickable: false,
////////////          parameters: { depthTest: false },
//////          updateTriggers: {
//////            getIcon: [GRID_CELL_SIZE],
//////            getPosition: [GRID_CELL_SIZE],
//////            getSize: [GRID_CELL_SIZE],
//////          },
//////        }) : null,

        // ① 既存文脈側のセル地模様タイル / セルの地模様（タイル）は「バブル無し かつ クラスタ色OFFのときだけ」表示
        (!highlight2D && !clusterColorMode) ? new IconLayer({
          id: "cell-tiles",
          data: cells,
          getPosition: (d) => d.center,
          getIcon: (d) => ({
            url: d.hasRating ? TILE_OCHRE : TILE_GRAY,
            width: 32,
            height: 32,
            anchorX: 16,
            anchorY: 16,
          }),
          sizeUnits: "meters",
          getSize: GRID_CELL_SIZE,
          billboard: true,
          pickable: false,
          parameters: { depthTest: false },
          updateTriggers: {
            getIcon: [GRID_CELL_SIZE],   // もしくは updateTriggers 自体を削除でOK
            getPosition: [GRID_CELL_SIZE],
            getSize: [GRID_CELL_SIZE],
          },
        }) : null,

        // ② 商品打点に付くバブル（highlight2D 選択時のみ）
        highlight2D
          ? new ScatterplotLayer({
              id: `point-bubbles-${highlight2D}`,
              data: pointBubbles,                 // { position, t }
              getPosition: d => d.position,
              radiusUnits: "meters",
              // ★ 3段階（下位20%/中間60%/上位20%）
              getRadius: d => {
                const R_SMALL = 0.06;  // 下位サイズ
                const R_MED   = 0.10;  // 中間サイズ
                const R_LARGE = 0.22;  // 上位サイズ
                const t = Math.max(0, Math.min(1, d.t));  // 0..1（分位点クリップ＆ガンマ後）
                if (t < 0.50) return R_SMALL;      // 下位50%
                if (t < 0.90) return R_MED;        // 上位10%
                return R_LARGE;
              },
              getFillColor: (d) => {
                // クラスタ配色ONのときだけ、クラスタごとの色でバブルを描く
                if (clusterColorMode && Number.isFinite(d.cluster)) {
                  const c = getClusterRGBA(d.cluster) || [210,210,205,255];
                  // バブルは少し透けさせたいのでαを上書き（好みで調整）
                  return [c[0], c[1], c[2], 150];
                }
                // 通常は従来どおりグレー
                return [210, 210, 205, 150];
              },
              stroked: false,
              getLineWidth: 0,
              pickable: false,
              parameters: { depthTest: false },
              updateTriggers: {
                getRadius: [HEAT_GAMMA], // t生成はHEAT_GAMMA/CLIP依存（pointBubblesで計算）
                getFillColor: [clusterColorMode],
              },
            })
          : null,

        // ピン/コンパス
        userPinCompassLayer,
        compassLayer,
//////        anchorCompassLayer,

        //////2026.04.以下の2点を 以下の3点と置き換え（baseLayer, mainLayer, ecPointLayer）
//        // 打点（店舗商品の ●グレイ）
//        mainLayer,
//
//        // EC専用商品の ●オレンジ
//        ecPointLayer,

        // base（土台の全打点追加 → グレイ）
//////        baseLayer,

        // 打点 店舗商品の●（既存グレー → オレンジ）
        mainLayer,

        // EC専用商品の●（既存オレンジ → 黄色）
//////        ecPointLayer,

        // 飲みたい ★赤（store/ec の上に重ねる）
        wishStarLayer,

        // 選択中のみ dot.svg を重ねる
        ...selectedDotLayers,

        // 評価リング
        ...ratingCircleLayers,
      ]}
    />
  );
});
export default MapCanvas;
