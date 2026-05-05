// src/components/panels/MapGuidePanelContent.jsx
// マップガイド（マップの説明）パネル
// - 説明文 と 表示アイコン
import React from "react";

/* --- 説明文左の 小さなアイコン群（SVG/CSSで再現） --- */
// 嗜好位置（しずく型）
const IconPin = ({ size = 22, fill = "#F7931E", stroke = "#FFFFFF", strokeWidth = 2, innerFill = "#FFFFFF" }) => (
  <svg width={size} height={size} viewBox="0 0 64 96" style={{ display: "block" }}>
    <path
      d="M32 4 C19 4 9 14 9 28 C9 47 32 79 32 79 C32 79 55 47 55 28 C55 14 45 4 32 4 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
    <circle cx="32" cy="28" r="9" fill={innerFill} />
  </svg>
);
// 基準のワイン（コンパス）
const IconGuide = ({ size = 18 }) => (
  <img
    src={`${process.env.PUBLIC_URL || ""}/icons/icon-192.png`}
    alt=""
    width={size}
    height={size}
    style={{ display: "block" }}
  />
);
// 店舗商品（グレイドット）
const IconDot = ({ color = "#9aa0a6", size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8" fill={color} />
  </svg>
);
// EC商品（オレンジドット）
const IconDotOrange = ({ size = 12, color = "#F7931E" }) => (
  <IconDot size={size} color={color} />
);
// 配置範囲（四角斜線）
const IconArea = ({ size = 12 }) => (
  <div
    style={{
      width: size, height: size, borderRadius: 2,
      border: "1px solid rgba(0,0,0,.25)",
      background: "repeating-linear-gradient(45deg, rgba(0,0,0,.15) 0 2px, transparent 2px 6px)",
    }}
  />
);
// 評価（評価丸印と背景）
const IconSwirl = ({ size = 20 }) => (
  <img src={`${process.env.PUBLIC_URL || ""}/img/map-guide.svg`} alt="" width={size} height={size} />
);
//
const Row = ({ icon, children }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px" }}>
    <div style={{ width: 22, display: "flex", justifyContent: "center" }}>{icon}</div>
    <div style={{ fontSize: 14.5, lineHeight: 1.85, color: "#222" }}>{children}</div>
  </div>
);
// 飲みたい（星）
const IconWishStar = ({ size = 12, color = "#B23567" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    style={{ display: "block" }}
    aria-hidden="true"
  >
    <path
      d="M32 6
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
      fill={color}
    />
  </svg>
);
// 味わいグループ（カラーパレット）
const IconColour = ({ size = 18 }) => (
  <img
    src={`${process.env.PUBLIC_URL || ""}/img/icon-colour.png`}
    alt=""
    width={size}
    height={size}
    style={{ display: "block" }}
  />
);
// バブル（グレイ下三角）
const IconBubbleTriangle = ({ size = 18, color = "#9aa0a6" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
    <path d="M12 18L5 8h14l-7 10z" fill={color} />
  </svg>
);

export default function MapGuidePanelContent() {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      {/* 冒頭説明 */}
      <p style={{ margin: "6px 4px 12px", lineHeight: 1.9, fontSize: 14.5, fontWeight: 600, color: "#222" }}>
        基準のワインを出発点に、様々なワインを評価しながら自分の好みの位置を育てていく——
        そんな“風味の地図”を歩くイメージで使えます。
      </p>

      {/* ライトカード */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e6ded2", overflow: "hidden" }}>
        <Row icon={<IconPin />}>
          あなたの嗜好位置の目安
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconGuide />}>
          基準のワインの風味位置<br></br>タップでスライダー調整できます
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconDot color="#9aa0a6" />}>
          店舗で買えるワイン
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />
        {/* 2026.05.
        <Row icon={<IconDotOrange size={12} />}>
          ECで買えるワイン
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />
        */}
        <Row icon={<IconArea />}>
          打点範囲の目安
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconSwirl />}>
          評価したワイン
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconWishStar />}>
          飲みたいワイン
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconColour />}>
          味わいグループの色分け<br></br>タップで切替できます
        </Row>
        <div style={{ height: 1, background: "#e6ded2" }} />

        <Row icon={<IconBubbleTriangle />}>
          要素の強さをバブルで表現<br></br>バブルが大きいほどその特徴が強いです
        </Row>
      </div>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "#111" }}>
          よくある質問
        </h3>
        {[
          ["位置情報を許可しないと使えない？", "許可しなくても利用できます。位置情報は評価記録などの目的で、同意がある場合に限り取得されます。"],
          ["検索パネルの商品は何の一覧？", "マップに打点されている商品の一覧です。QRの店舗または輸入元に紐づく商品が表示されます。"],
          ["評価の取り消しってできる？", "はい、できます。商品ページで濃くなっている評価部分をタップすると評価が消えます。"],
          ["商品ページの「飲みたい」を押すとどうなるの？", "評価・飲みたい一覧パネルに追加され、あとから探しやすくなります。評価すると飲みたいフラグが外れて評価アイコンへ変わります。"],
          ["打点が小さくて押せないときは？", "スマホ画面をピンチアウトするとマップを拡大できます。また検索パネルの商品一覧からも詳細を開けます。"],
        ].map(([q, a]) => (
          <div key={q} style={{ borderTop: "1px solid rgba(0,0,0,.08)", padding: "14px 4px" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Q. {q}</div>
            <div style={{ fontSize: 14, lineHeight: 1.75, color: "#222" }}>A. {a}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
