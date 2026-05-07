/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */

// src/components/panels/SearchPanel.jsx
// 検索パネル　（バーコードカメラ検索も一部含む）
// - 初期一覧は 選択した店舗（EC連携有無含む）商品一覧
// - 検索対象は 上記初期一覧の商品の中から
// - バーコードカメラ検索 の検索対象は tdb_product（DB全商品）の中から
import React, { useMemo, useState, useEffect, useRef } from "react";
import Drawer from "@mui/material/Drawer";
import { normalizeJP } from "../../utils/search";
import { drawerModalProps, paperBaseStyle, DRAWER_HEIGHT } from "../../ui/constants";
import ListRow from "../ui/ListRow";
import PanelHeader from "../ui/PanelHeader";
import BarcodeScanner from "../BarcodeScanner";
import { fetchProductByJan } from "../../api/appSearch";


const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

// ==== 初期一覧(A: あなた向け)のためのローカルキー候補 ====
const RECENT_KEYS = [
  "searchPanel.recentViewedJans",
  "recentViewedJans",
  "app.recentViewedJans",
  "tastemap.recentViewedJans",
];
const WISHLIST_KEYS = [
  "app.wishlistCache",
  "wishlistCache",
  "tastemap.wishlistCache",
];

export default function SearchPanel({
  open,
  onClose,
  data = [],
  onPick,
  onScanClick,         // 互換のため残す（未使用でもOK）
  // 任意：MapPage から渡せるなら渡す（無くてもOK）
  userRatings,         // 例: { [jan]: { rating, updated_at? } } / { [jan]: number } でもOK扱い
  wishlistCache,       // 例: { [jan]: true }（DB正の表示キャッシュ）
  recentViewedJans,    // 例: ["4964...", ...]
}) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // バーコードスキャナ
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeItem, setBarcodeItem] = useState(null); // DBから取れた1件（表示用）
  const [barcodeErr, setBarcodeErr] = useState("");

  // 初期一覧（選択店舗の対象JAN）の “DB正” 情報を保持
  const [miniByJan, setMiniByJan] = useState(() => new Map());

  // パネルが閉じられたら状態をリセット
  useEffect(() => {
    if (!open) {
      setQ("");
      setQDebounced("");
      setLoading(false);
      setErrorMsg("");
      setMiniByJan(new Map());
      setScannerOpen(false);
      setBarcodeItem(null);
      setBarcodeErr("");      
    }
  }, [open]);

  // 入力のデバウンス
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setQDebounced(q), 260);
    return () => clearTimeout(id);
  }, [q, open]);

  const scrollRef = useRef(null);
  const SCROLL_KEY = "searchPanel.scrollTop";

  // ===== ローカル保存の読み出し（安全）=====
  const safeParse = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  const loadRecentFromStorage = () => {
    for (const k of RECENT_KEYS) {
      const raw = (typeof window !== "undefined" && localStorage.getItem(k)) || "";
      if (!raw) continue;
      const v = safeParse(raw);
      if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
      // 文字列 "a,b,c" も許容
      if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
    }
    return [];
  };

  const loadWishlistFromStorage = () => {
    for (const k of WISHLIST_KEYS) {
      const raw = (typeof window !== "undefined" && localStorage.getItem(k)) || "";
      if (!raw) continue;
      const v = safeParse(raw);
      if (v && typeof v === "object") return v; // { jan: true } 想定
    }
    return null;
  };

  // “あなた向け”の素材（props優先→localStorage）
  const recentJans = useMemo(() => {
    if (Array.isArray(recentViewedJans) && recentViewedJans.length) {
      return recentViewedJans.map((x) => String(x || "").trim()).filter(Boolean);
    }
    return loadRecentFromStorage();
  }, [open, Array.isArray(recentViewedJans) ? recentViewedJans.join("|") : ""]);

  const wishlistObj = useMemo(() => {
    if (wishlistCache && typeof wishlistCache === "object") return wishlistCache;
    return loadWishlistFromStorage();
  }, [open, wishlistCache]);

  // rating: {jan: {rating}} / {jan: number} 両対応に寄せる
  const ratingMap = useMemo(() => {
    const src = userRatings && typeof userRatings === "object" ? userRatings : null;
    if (!src) return new Map();
    const m = new Map();
    Object.entries(src).forEach(([jan, v]) => {
      const key = String(jan || "").trim();
      if (!key) return;
      const r = (typeof v === "number") ? v : Number(v?.rating ?? 0);
      if (Number.isFinite(r) && r > 0) m.set(key, r);
    });
    return m;
  }, [userRatings]);

  // ===== points.csv(UMAP) 側の揺れを吸収して「表示/遷移に必要なキー」に正規化 =====
  const getJan = (d) => {
    const v =
      d?.jan_code ??
      d?.JAN ??
      d?.jan ??
      d?.barcode ??
      d?.BARCODE ??
      d?.code ??
      null;
    return v === null || v === undefined ? "" : String(v).trim();
  };

  // temp_name は絶対に拾わない（仮名なので）
  const getNameFromLocal = (d) => {
    const v =
      d?.name_kana ??
      d?.name ??
      d?.商品名 ??
      d?.["商品名"] ??
      null;
    return v === null || v === undefined ? "" : String(v).trim();
  };

  const normalizeWineType = (v) => {
    const t = (v === null || v === undefined) ? "" : String(v).trim().toLowerCase();
    // DBの wine_type 以外は落とす（色の暴発防止）
    return ["red", "white", "sparkling", "rose"].includes(t) ? t : "";
  };

  // ==========================
  // ローカル検索（初期一覧の中から検索）
  // ==========================
  const buildSearchText = (item) => {
    // mini拡張で増えたカラムを確実に拾う
    // （古い別名も一応残して取りこぼしを防ぐ）
    const parts = [
      // IDs
      item?.jan_code,
      item?.JAN,

      // names
      item?.name_kana,
      item?.name,
      item?.name_eng,

      // producer
      item?.producer_name,
      item?.producer_name_eng,
      item?.producer, // 旧別名

      // origin / variety
      item?.country,
      item?.region,
      item?.appellation,     // 旧別名
      item?.grape_variety,
      item?.variety,         // 旧別名

      // notes
      item?.comment,
      item?.importer,        // もし今後入るなら

      // other
      item?.vintage,
      item?.color,
      item?.wine_type,
      item?.Type,            // 旧互換
    ];

    return normalizeJP(
      parts
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v).trim())
        .filter(Boolean)
        .join(" ")
    );
  };

  const localFilter = (items, query) => {
    const nq = normalizeJP(query || "");
    if (!nq) return items;
    return items.filter((it) => buildSearchText(it).includes(nq));
  };

  // 初期一覧JAN一覧（ユニーク）
  const initialJans = useMemo(() => {
    const s = new Set();
    (Array.isArray(data) ? data : []).forEach((d) => {
      const jan = getJan(d);
      if (jan) s.add(jan);
    });
    return Array.from(s);
  }, [data]);

  // 初期一覧のために DB(mini) を一括取得（open時＆検索語なしのとき中心に使う）
  useEffect(() => {
    if (!open) return;
    // data が無いなら何もしない
    if (!initialJans.length) {
      setMiniByJan(new Map());
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const token =
          (typeof window !== "undefined" &&
            (localStorage.getItem("app.access_token") || "")) ||
          "";

        // 量が多い場合は分割（URL長制限対策）
        const CHUNK = 200;
        const merged = new Map();

        for (let i = 0; i < initialJans.length; i += CHUNK) {
          const chunk = initialJans.slice(i, i + CHUNK);
          const params = new URLSearchParams();
          params.set("jan_codes", chunk.join(","));

          const res = await fetch(
            `${API_BASE}/api/qr/map-products/mini?${params.toString()}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              signal: controller.signal,
            }
          );

          if (!res.ok) throw new Error(`mini HTTP ${res.status}`);
          const json = await res.json();
          const items = Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : []);

          items.forEach((p) => {
            const jan = String(p?.jan_code || "").trim();
            if (!jan) return;
            merged.set(jan, {
              ...p,
              jan_code: jan,
              JAN: jan,
              name_kana: String(p?.name_kana || p?.name || "").trim(),
              wine_type: normalizeWineType(p?.wine_type),
            });
          });
        }

        if (cancelled) return;
        setMiniByJan(merged);
      } catch (e) {
        if (cancelled || e?.name === "AbortError") return;
        console.error("[SearchPanel] mini fetch error:", e);
        // mini が取れなくてもアプリは動かしたいので、空Mapにするだけ
        setMiniByJan(new Map());
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, initialJans.join("|")]);

  const normalizeLocalItem = (d) => {
    const jan = getJan(d);
    const mini = jan ? miniByJan.get(jan) : null;
    // 表示名は DB(mini) を最優先（temp_name禁止）
    const name =
      (mini?.name_kana || "").trim() ||
      (mini?.name || "").trim() ||
      getNameFromLocal(d) ||
      jan;
    // wine_type も DB(mini) を最優先（points側の Type は信用しない）
    const wineType = normalizeWineType(mini?.wine_type);
    return {
      // UMAP/points（座標など）を残しつつ
      ...d,
      // DB(mini) を上書き（初期一覧→詳細でも情報が揃う）
      ...(mini || {}),
      JAN: jan,
      jan_code: jan,
      name_kana: name,
      商品名: name,     // ListRow互換
      wine_type: wineType,
      Type: wineType,   // 旧互換
    };
  };
  
  // UMAP データを JAN → item のマップにしておく（必ず正規化して格納）
  const janToLocal = useMemo(() => {
    const m = new Map();
    (Array.isArray(data) ? data : []).forEach((d) => {
      const nd = normalizeLocalItem(d);
      const key = nd.jan_code;
      if (!key) return;
      if (!m.has(key)) m.set(key, nd);
    });
    return m;
  }, [data, miniByJan]);

  // バーコードスキャン結果を SearchPanel の item 形式に寄せる（ListRow互換）
  const normalizeBarcodeItem = (p) => {
    if (!p) return null;
    const jan = String(p?.jan_code || "").trim();
    const wineType = normalizeWineType(p?.wine_type);
    const name = String(p?.name_kana || "").trim() || jan;
    return {
      ...p,
      JAN: jan,
      jan_code: jan,
      name_kana: name,
      商品名: name,
      wine_type: wineType,
      Type: wineType,
      // UMAP座標は無い前提（中心移動しない）
    };
  };

  // ==========================
  // 初期一覧（検索語なし）
  // Mapに描画されている集合（data）と同等（= janToLocal の全件）
  // ==========================
  const initialFromMap = useMemo(() => {
    const all = Array.from(janToLocal.values()).filter((x) => !!x?.jan_code);
    all.sort((a, b) => {
      const na = String(a?.name_kana || "").trim() || String(a?.jan_code || "");
      const nb = String(b?.name_kana || "").trim() || String(b?.jan_code || "");
      return na.localeCompare(nb, "ja");
    });
    return all;
  }, [janToLocal]);

  // 検索結果を UMAP データとマージ
  const results = useMemo(() => {
    const trimmed = (qDebounced || "").trim();
    const nq = normalizeJP(trimmed);

    // バーコードスキャン結果がある & 検索語が空なら、バーコード結果を優先表示
    if (!nq && barcodeItem) {
      return [
        { __type: "header", title: "バーコード結果" },
        barcodeItem,
      ];
    }

    // 検索語がないとき：初期一覧をそのまま
    if (!nq) return initialFromMap;

    // 検索語があるとき：
    // 初期一覧（Mapに表示されている商品）からローカル検索
    return localFilter(initialFromMap, trimmed);
  }, [qDebounced, initialFromMap, barcodeItem]);

 const pickItem = (cand) => {
  if (!cand) return;
   // headerはスキップして次の実データを拾う
   if (cand?.__type === "header") {
    const next = results.find((x) => x && x.__type !== "header");
     if (next) onPick?.(next);
     return;
   }
   onPick?.(cand);
  };

  // 重複JAN/コードを除外してから表示用配列を作る
  const listed = useMemo(() => {
    // header行は index を振らない / 重複除外もしない
    let idx = 0;
    const rows = results.map((x) => {
      if (x?.__type === "header") return x;
      idx += 1;
      return {
        ...x,
        addedAt: x.addedAt || null,
        displayIndex: idx,
      };
    });
    const seen = new Map(); // key => true
    const out = [];
    for (const r of rows) {
      if (r?.__type === "header") {
        out.push(r);
        continue;
      }
      const k = String(
        r?.JAN ?? r?.jan_code ?? r?.code ?? r?.id ?? r?.jt_code ?? ""
      );
      if (k) {
        if (seen.has(k)) continue; // 重複はスキップ
        seen.set(k, true);
      }
      out.push(r);
    }
    return out;
  }, [results]);

  // スクロール位置復元
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const y = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
    if (Number.isFinite(y)) {
      requestAnimationFrame(() => {
        el.scrollTop = y;
      });
    }
  }, [open]);

  // スクロール位置保存
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - t < 80) return;
      t = now;
      sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop || 0));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  const HEADER_H = 42;
  const hasQuery = !!(qDebounced && qDebounced.trim());
  const localSearching = hasQuery && q !== qDebounced; // デバウンス中だけ「検索中…」

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      hideBackdrop
      sx={{ zIndex: 1450, pointerEvents: "none" }}
      BackdropProps={{ style: { background: "transparent", pointerEvents: "none" } }}
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
          height: DRAWER_HEIGHT,
          display: "flex",
          flexDirection: "column",
        },
        sx: { pointerEvents: "auto" },
      }}
    >
      <PanelHeader
        title="検索"
        icon="search2.svg"
        iconFallback="search2.svg"
        onClose={() => {
          setQ("");
          setQDebounced("");
          setErrorMsg("");
          setBarcodeItem(null);
          setBarcodeErr("");
          onClose?.();
        }}
      />

      {/* 検索行 */}
      <div
        style={{
          padding: "8px 12px 6px",
          borderBottom: "1px solid #eee",
          background: "#f9f9f9",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            border: "1px solid #ccc",
            borderRadius: 8,
            background: "#fff",
            padding: "6px 10px",
          }}
        >
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              sessionStorage.setItem(SCROLL_KEY, "0");
              // 手入力を始めたらバーコード結果は消す（混線防止）
              if (barcodeItem) setBarcodeItem(null);
              if (barcodeErr) setBarcodeErr("");              
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") pickItem(results.find(x => x?.__type !== "header"));
            }}
            placeholder="商品名 / タイプ / 産地 / 品種 / JAN で検索"
            style={{
              border: "none",
              outline: "none",
              width: "100%",
              fontSize: 16,
              paddingRight: 44,
              lineHeight: 1,
            }}
          />
          <button
            onClick={() => {
              setBarcodeErr("");
              setScannerOpen(true);
            }}
            title="バーコード読み取り"
            aria-label="バーコード読み取り"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 34,
              height: 22,
              borderRadius: 6,
              border: "1px solid #d0d0d0",
              background: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", gap: 2, height: 14, alignItems: "stretch" }}>
              {[3, 1, 2, 1, 2, 1].map((w, i) => (
                <span
                  key={i}
                  style={{ width: w, background: "#444", borderRadius: 1 }}
                />
              ))}
            </div>
          </button>
        </div>

        {localSearching && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>検索中…</div>
        )}
        {!loading && errorMsg && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#c00" }}>{errorMsg}</div>
        )}
        {!loading && !errorMsg && barcodeErr && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#c00" }}>{barcodeErr}</div>
        )}
      </div>

      {/* バーコードスキャナ（オーバーレイ） */}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={async (jan13) => {
          try {
            const token =
              (typeof window !== "undefined" &&
                (localStorage.getItem("app.access_token") || "")) ||
              "";

            const p = await fetchProductByJan({ jan: jan13, accessToken: token || undefined });
            if (!p) {
              setBarcodeItem(null);
              setBarcodeErr("該当商品がDBにありません。");
              return { ok: false };
            }

            setBarcodeItem(normalizeBarcodeItem(p));
            setBarcodeErr("");
            setQ("");
            setQDebounced("");
            return { ok: true };
          } catch (e) {
            console.error("[barcode jan search error]", e);
            setBarcodeItem(null);
            setBarcodeErr("バーコード検索に失敗しました。通信状況を確認してください。");
            return { ok: false };
          } finally {
            setScannerOpen(false);
          }
        }}
      />

      {/* リスト */}
      <div
        ref={scrollRef}
        style={{
          height: `calc(${DRAWER_HEIGHT} - ${HEADER_H}px - 52px)`,
          overflowY: "auto",
          padding: "6px 10px 12px",
          background: "#fff",
        }}
      >
        {hasQuery && !loading && !errorMsg && listed.length === 0 && (
          <div style={{ color: "#666", padding: "12px 6px" }}>
            該当する商品が見つかりません。
          </div>
        )}

        {!hasQuery && !loading && listed.length === 0 && (
          <div style={{ color: "#666", padding: "12px 6px" }}>
            商品データが読み込まれていません。
          </div>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {listed.map((item, idx) => {
            if (item?.__type === "header") {
              return (
                <li
                  key={`hdr-${item.title}-${idx}`}
                  style={{
                    padding: "10px 6px 6px",
                    fontSize: 13,
                    color: "#666",
                    fontWeight: 700,
                  }}
                >
                  {item.title}
                </li>
              );
            }

            return (
              <ListRow
                key={`${String(
                  item?.JAN ?? item?.jan_code ?? item?.code ?? item?.id ?? "row"
                )}-${idx}`}
                index={item.displayIndex}
                item={item}
                onPick={() => pickItem(item)}
                showDate={false}
                accentColor="#6b2e2e"
                hoverHighlight={true}
              />
            );
          })}
        </ul>
      </div>
    </Drawer>
  );
}
