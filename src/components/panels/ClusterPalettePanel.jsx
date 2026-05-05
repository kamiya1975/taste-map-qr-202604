// src/components/panels/ClusterPalettePanel.jsx
// クラスターパレット（味わいグループ）パネル
// - 文言は src/ui/constants.js にある
import React, { useMemo, useState } from "react";
import PanelShell from "./PanelShell";
import {
  CLUSTER_DRAWER_HEIGHT,
  CLUSTER_COLORS_FIXED,
  CLUSTER_META,         // 並び順をこの配列そのままにする
} from "../../ui/constants";

const COLLAPSED_HEIGHT = "calc(10svh - env(safe-area-inset-bottom))";

const rgbaToCss = (arr) => {
  if (!Array.isArray(arr)) return "rgba(200,200,200,1)";
  const [r, g, b, a = 255] = arr;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
};

const truncate = (s, n) => (!s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function ClusterPalettePanel({
  isOpen,
  onClose,
  height = CLUSTER_DRAWER_HEIGHT,
  onPickCluster = null,   // タップ時にクラスターIDを親へ通知
  clusterMeta = null,     // 未指定なら constants の CLUSTER_META を使う
  availableIds = null,    // 追加：表示対象を制限する（順序は維持）
  maxNameLen = 10,
  maxHintLen = 30,
  collapseKey,          // ★追加：外から「畳め」の合図
}) {
  const [collapsed, setCollapsed] = useState(false);

  React.useEffect(() => {
    if (!isOpen) setCollapsed(false);
  }, [isOpen]);

  // ★ collapseKey が変わったら「帯だけ」の状態にする
  React.useEffect(() => {
    if (!isOpen) return;
    if (collapseKey == null) return;
    setCollapsed(true); 
   }, [collapseKey, isOpen]);

  // ★ 並び順は「source（= CLUSTER_META等）の定義順」をそのまま使う
  const entries = useMemo(() => {
    const source = (clusterMeta ?? CLUSTER_META); // ここに希望順で定義しておく
    const allow = Array.isArray(availableIds) && availableIds.length > 0
      ? new Set(availableIds.map(Number))
      : null;

    return source
      .filter(m => (allow ? allow.has(Number(m.id)) : true))
      .map(m => {
        const id = Number(m.id);
        return {
          id,
          color: CLUSTER_COLORS_FIXED?.[id],
          name: truncate(m.name, maxNameLen),
          hint: truncate(m.hint, maxHintLen),
        };
      });
  }, [clusterMeta, availableIds, maxNameLen, maxHintLen]);

  return (
    <PanelShell
      isOpen={isOpen}
      onClose={onClose}
      title="味わいグループ"
      icon="icon-colour.png"
      height={collapsed ? COLLAPSED_HEIGHT : height}
      onHeaderClick={() => setCollapsed((v) => !v)}
      motionPreset="mui"
      animateHeight={true}
      heightDurationMs={225}
      zIndex={4000}
      hideClose={true}
      // 2026.05.以下を追加
      rightExtra={
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          aria-label={collapsed ? "展開" : "折りたたみ"}
          title={collapsed ? "展開" : "折りたたみ"}
          style={{
            border: "none",
            background: "transparent",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            padding: "4px 20px",
            color: "#666",
            WebkitTextFillColor: "#666", // 追加：iPhone対策
          }}
        >
          {collapsed ? "▲" : "▼"}
        </button>
      }
    >

      {!collapsed ? (
        <div style={{ padding: 12 }}>
          <p style={{ margin: "4px 0 12px", color: "#444", fontSize: 13 }}>
            グループ名をタッチすると、その味の場所にマップが移動します。
            </p>
        
          {/* カードを2カラムで並べるエリア */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              columnGap: 12,
              rowGap: 12,
            }}
          >
          {entries.map(({ id, color, name, hint }) => (
            <div
              key={id}
              style={{
                position: "relative",
                padding: "12px 12px 10px 14px",   // 左を大きめにあける
                borderRadius: 18,
                background: "#fff",

                //ボタン枠・軽い影
                boxShadow: "none",
                border: "none",
                outline: "none",
                WebkitTapHighlightColor: "transparent",

                cursor: onPickCluster ? "pointer" : "default",
              }}
              role="button"
              tabIndex={0}
              onClick={() => onPickCluster?.(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onPickCluster?.(id);
              }}
            >
              {/* 丸い色チップ（テキストの下に少し潜らせる） */}
              <div
                title={name || "クラスタ"}
                aria-label={name || "クラスタ"}
                style={{
                  position: "absolute",
                  left: -4,
                  top: -2,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: rgbaToCss(color),
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
                  zIndex: 0,           // 下のレイヤー
                  opacity: 0.75,   //半透明化
                }}
              />

              {/* テキスト（丸の上に乗せる） */}
              <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    color: "#222",
                    fontWeight: 700,
                    lineHeight: 1.3,
                    textShadow: "0 0 3px white, 0 0 2px white",
                  }}
                >
                  {name || "クラスタ"}
                </div>
                {hint && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#555",
                      lineHeight: 1.4,
                      marginTop: 4,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                   }}
                    title={hint}
                  >
                    {hint}
                  </div>
                )}
              </div>
            </div>
          ))}
          </div>

          <p style={{ marginTop: 12, color: "#666", fontSize: 12 }}>
            ※ 色分けと名称は、科学的な風味データをもとに分類したものです。
          </p>
        </div>
      ) : (
        <div style={{ padding: 12, color: "#666", fontSize: 12 }}>
          タップで展開します
        </div>
      )}
    </PanelShell>
  );
}
