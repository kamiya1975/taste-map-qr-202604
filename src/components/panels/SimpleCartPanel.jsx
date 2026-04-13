// src/components/panels/SimpleCartPanel.jsx
// カートUI（パネル）　　カートパネル
import React, { useMemo, useEffect, useState } from "react";
import { useSimpleCart } from "../../cart/simpleCart";
import { createCartWithMeta } from "../../lib/shopifyCart";
import { checkAvailabilityByJan } from "../../lib/shopifyInventory";
import { buildShopifyCartMeta } from "../../lib/shopifyMeta";

// 決済後の遅延クリア用キー
const LS_CLEAR_KEY = "tm_cart_clear_at";   // 例: 1700000000000 (ms)
function scheduleCartClear(msFromNow = 5000) {
  try { localStorage.setItem(LS_CLEAR_KEY, String(Date.now() + msFromNow)); } catch {}
}
function consumeIfDueClear(cb) {
  try {
    const v = Number(localStorage.getItem(LS_CLEAR_KEY) || 0);
    if (v && Date.now() >= v) {
      localStorage.removeItem(LS_CLEAR_KEY);
      cb?.();
      return true;
    }
  } catch {}
  return false;
}

// 未ログイン表示
function getTokenSafe() {
  try {
    return localStorage.getItem("app.access_token") || "";
  } catch {
    return "";
  }
}

function AuthRequiredMessage({ label = "カート" }) {
  return (
    <div style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 16, lineHeight: 1.8 }}>
        {label}の表示にはログインが必要です。マイアカウントからログインして再度お試しください。
      </div>
    </div>
  );
}

const SHOP_DOMAIN =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SHOPIFY_SHOP_DOMAIN) ||
  process.env.REACT_APP_SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_SHOP_DOMAIN ||
  "tastemap.myshopify.com";

export default function SimpleCartPanel({ onClose, isOpen = false }) {
  const { items, totalQty, updateQty, remove, clear } = useSimpleCart();
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  // --- 在庫結果を保持 ---
  // stockMap["JAN"] = { availableForSale, quantityAvailable|null, currentlyNotInStock }
  const [stockMap, setStockMap] = useState({});
  const [stockMsg, setStockMsg] = useState("");
  const [unresolved, setUnresolved] = useState([]);

  // --- 遅延クリアの実行（ページ再訪/復帰時でも動く） ---
  useEffect(() => {
    // 1) 今すでに期限が過ぎていたら即クリア
    consumeIfDueClear(() => clear());

    // 2) タブが戻ってきた時に再チェック
    const onVis = () => consumeIfDueClear(() => clear());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [clear]);

  // --- auth 監視（keepMounted対策） ---
  useEffect(() => {
    const syncAuth = () => {
      const token = getTokenSafe();
     const req = !token;
     setAuthRequired(req);
     if (req) {
       // ログアウト直後の残骸を消す
       setStockMap({});
       setStockMsg("");
       setUnresolved([]);
     }
    };
    syncAuth(); // 初期判定
    window.addEventListener("tm_auth_changed", syncAuth);
    return () => window.removeEventListener("tm_auth_changed", syncAuth);
  }, []);  

  // items の変更を安定キーに変換
  const itemsKey = useMemo(
    () =>
      Array.isArray(items)
        ? items.map(it => `${String(it?.jan || it?.jan_code || it?.JAN || "")}:${Number(it?.qty || 0)}`).join("|")
        : "",
    [items]
  );

  // カートOPEN時＋中身変化で在庫チェック
  useEffect(() => {
   if (authRequired) return;        // 未ログインなら在庫チェック自体しない
   if (!isOpen) return;             // （任意）開いてないなら無駄に叩かない

    let alive = true;
    (async () => {
      try {
        const uiItemsForStock = (Array.isArray(items) ? items : [])
          .map(it => ({ jan: String(it?.jan || it?.jan_code || it?.JAN || ""), qty: Number(it?.qty || 0) }))
          .filter(x => x.jan && x.qty > 0);

        if (!uiItemsForStock.length) {
          if (alive) { setStockMap({}); setUnresolved([]); setStockMsg(""); }
          return;
        }

        const { byJan, unresolved: u, apiErrors } = await checkAvailabilityByJan(uiItemsForStock);
        if (!alive) return;
        setStockMap(byJan || {});
        setUnresolved(u || []);
        setStockMsg(apiErrors && apiErrors.length ? apiErrors.join("\n") : "");
      } catch (e) {
        if (!alive) return;
        setStockMsg(String(e?.message || e));
      }
    })();
    return () => { alive = false; };
 }, [authRequired, isOpen, itemsKey, items]);

  // 決済開始
  async function handleCheckout() {
   if (authRequired) return;

   const token = getTokenSafe();
   if (!token) {
     setAuthRequired(true);
     alert("決済に進むにはログインが必要です。");
     return;
   }

    if (busy) return;
    setBusy(true);
    try {
      // 決済直前: 最終在庫チェック
      const uiItemsForStock = (Array.isArray(items) ? items : [])
        .map(it => ({ jan: String(it?.jan || it?.jan_code || it?.JAN || ""), qty: Number(it?.qty || 0) }))
        .filter(x => x.jan && x.qty > 0);

      const { byJan } = await checkAvailabilityByJan(uiItemsForStock);
      const shortages = [];
      for (const it of uiItemsForStock) {
        const st = byJan[it.jan];
        if (!st) continue;
        if (st.quantityAvailable == null) {
          if (!st.availableForSale) shortages.push(`${it.jan}: 在庫切れ`);
        } else if (st.quantityAvailable < it.qty) {
          shortages.push(`${it.jan}: 残り${st.quantityAvailable}点（必要${it.qty}点）`);
        }
      }
      if (shortages.length) {
        alert("在庫が不足しています。\n" + shortages.join("\n"));
        return;
      }

      // Storefront API 用に整形（line item properties は最小限）
      const uiItemsForCreate = (Array.isArray(items) ? items : []).map(it => ({
        jan: String(it?.jan || it?.jan_code || it?.JAN || ""),
        qty: Math.max(1, Number(it?.qty || 0)),
        properties: { source: "TasteMap" },
      })).filter(x => x.jan && x.qty > 0);

      const { checkoutUrl, unresolved: u } = await createCartWithMeta(uiItemsForCreate, buildShopifyCartMeta());

      if (Array.isArray(u) && u.length) {
        alert("一部JANが未解決です: " + u.join(", "));
      }
      if (checkoutUrl) {
        // ▼5秒後に空にする（遷移しても確実に実行されるよう localStorage 経由）
        scheduleCartClear(5000);
        // 同一タブ遷移まで“5秒タイマー”が生きている場合に備え、保険でローカルでも実行
        try { setTimeout(() => consumeIfDueClear(() => clear()), 5100); } catch {}
        
        window.location.href = checkoutUrl;
        return;
      }
      alert("カートURLが返りませんでした。");
    } catch (e) {
      alert("決済開始に失敗: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // 小計
  const subtotal = useMemo(() => {
    let s = 0;
    for (const it of Array.isArray(items) ? items : []) {
      s += (Number(it?.price) || 0) * (Number(it?.qty) || 0);
    }
    return s;
  }, [items]);

  const empty = !Array.isArray(items) || items.length === 0;

  if (authRequired) {
    return <AuthRequiredMessage label="カート" />;
  }

  return (
    <div style={{ padding: 12 }}>
      {!empty && stockMsg && (
        <div style={{ marginBottom: 8, padding: 8, border: "1px solid #f0ad4e", borderRadius: 8, background: "#fff7e6", color: "#8a6d3b" }}>
          在庫チェック注意: {stockMsg}
        </div>
      )}
      {!empty && unresolved.length > 0 && (
        <div style={{ marginBottom: 8, padding: 8, border: "1px solid #aaa", borderRadius: 8 }}>
          Variant未解決JAN: {unresolved.join(", ")}
        </div>
      )}

      {empty ? (
        <div style={{ padding: 12, color: "#555" }}>カートの中身は空です</div>
      ) : (
        <>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => {
              const jan = String(it?.jan || it?.jan_code || it?.JAN || "");
              const st  = stockMap[jan];

              // 表示ラベル
              let stockLabel = "";
              let stockColor = "#666";
              if (st) {
                if (st.quantityAvailable == null) {
                  stockLabel = st.availableForSale ? "在庫あり（数非公開）" : "在庫切れ";
                  stockColor = st.availableForSale ? "#2a7" : "#c00";
                } else {
                  const need = Number(it?.qty || 0);
                  if (st.quantityAvailable <= 0 || st.currentlyNotInStock) {
                    stockLabel = "在庫切れ";
                    stockColor = "#c00";
                  } else if (st.quantityAvailable < need) {
                    stockLabel = `残り ${st.quantityAvailable} 点（不足 ${need - st.quantityAvailable}）`;
                    stockColor = "#c60";
                  } else {
                    stockLabel = `在庫 ${st.quantityAvailable} 点`;
                    stockColor = "#2a7";
                  }
                }
              }

              return (
                <li key={jan} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #eee" }}>
                  <img
                    src={it?.imageUrl || `${process.env.PUBLIC_URL || ""}/img/${jan}.png`}
                    alt=""
                    style={{ width: 48, height: 48, objectFit: "contain", flexShrink: 0 }}
                    draggable={false}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it?.title || jan}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>JAN: {jan}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>価格: ¥{Number(it?.price || 0).toLocaleString()}</div>
                    {st && (
                      <div style={{ fontSize: 12, marginTop: 4, color: stockColor }}>
                        {stockLabel}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => updateQty(jan, Math.max(0, Number(it?.qty || 0) - 1))}
                      aria-label="数量を減らす"
                      style={{ width: 28, height: 28, border: "1px solid #111", borderRadius: 6, background: "#fff", cursor: "pointer" }}
                    >−</button>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={Number(it?.qty || 0)}
                      onChange={(e) => updateQty(jan, Number(e.target.value || 0))}
                      style={{ width: 44, height: 28, border: "1px solid #ccc", borderRadius: 6, textAlign: "center" }}
                    />
                    <button
                      onClick={() => updateQty(jan, Number(it?.qty || 0) + 1)}
                      aria-label="数量を増やす"
                      style={{ width: 28, height: 28, border: "1px solid #111", borderRadius: 6, background: "#fff", cursor: "pointer" }}
                    >＋</button>
                  </div>
                  <button
                    onClick={() => remove(jan)}
                    aria-label="削除"
                    title="削除"
                    style={{ marginLeft: 6, width: 28, height: 28, border: "1px solid #c00", color: "#c00", borderRadius: 6,
                      background: "#fff", cursor: "pointer", flexShrink: 0, display: "grid", placeItems: "center", padding: 0 }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      style={{ display: "block" }}
                    >
                      <path
                        d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zm-5 2h16v2H4V6z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontWeight: 700 }}>
            <div>合計点数: {totalQty}</div>
            <div>小計: ¥{subtotal.toLocaleString()}</div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => clear()}
              style={{ flex: 1, padding: "12px 10px", borderRadius: 10, border: "1px solid #111", background: "#fff", color: "#111", cursor: "pointer", fontWeight: 700 }}
              disabled={busy}
            >
              クリア
            </button>
            <button
              onClick={handleCheckout}
              disabled={busy || (Number(totalQty) || 0) <= 0}
              style={{
                flex: 2, padding: "12px 10px", borderRadius: 10, border: "1px solid #111",
                background: (Number(totalQty) || 0) > 0 && !busy ? "#111" : "#eee",
                color: (Number(totalQty) || 0) > 0 && !busy ? "#fff" : "#999",
                cursor: (Number(totalQty) || 0) > 0 && !busy ? "pointer" : "default",
                fontWeight: 700
              }}
              title={busy ? "処理中…" : (SHOP_DOMAIN ? `Shopify: ${SHOP_DOMAIN}` : "Shopifyドメイン未設定")}
            >
              {busy ? "送信中…" : "決済に進む"}
            </button>
          </div>

          {/* 注意文 */}
          <div
            style={{
              maxWidth: 560,
              margin: "20px auto 0",
              padding: "0 8px",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "#666",
              whiteSpace: "pre-line",
            }}
          >
            {"合計6本以上で送料無料。6本未満の送料は全国一律1,100円。\n\n決済画面で入力するメールアドレスは、アプリのログインIDと同じが必須。事前に確認して間違いのないようご注意ください。"}
          </div>
        </>
      )}
    </div>
  );
}
