// src/components/panels/MyPagePanelContent.jsx
// アプリガイド（メニュー一覧）パネル
import React from "react";

const ICONS = {
  compass: "/img/bar.svg",
  mapGuide: "/img/tizu.svg",
  account: "/img/account.svg",
  store:   "/img/store.svg",
//2026.05.  miles:   "/img/icon-cart2.png",
//2026.05.  faq:     "/img/faq.svg",
  refresh: "/img/refresh.svg"
};

function Row({ icon, label, onClick, last = false, iconSize = 25 }) {
  return (
    <div style={{ width: "100%" }}>
      <button
        onClick={onClick}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "30px 18px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 28,              // ← アイコン枠を固定（ここを調整）
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          <img
            src={icon}
            alt=""
            style={{ width: iconSize, height: iconSize, objectFit: "contain", display: "block" }}
          />        </div>
        <span style={{ fontSize: 15, color: "#111" }}>{label}</span>
      </button>
      {!last && <div style={{ height: 1, background: "rgba(0,0,0,0.12)" }} />}
    </div>
  );
}

export default function MyPagePanelContent({
  onClose,
  onOpenCart,
  onOpenSlider,
  onOpenMapGuide,
  onOpenStore,
  onOpenAccount,
//2026.05.  onOpenMiles,
//2026.05.  onOpenFaq,
  onOpenRefresh,
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
      <Row
        icon={ICONS.mapGuide}
        label="マップガイド + よくある質問"
        onClick={() => onOpenMapGuide?.()} 
      />
      <Row
        icon={ICONS.account}
        label="マイアカウント"
        onClick={() => onOpenAccount?.()}
      />
      <Row
        icon={ICONS.store}
        label="お気に入り店舗登録"
        onClick={() => onOpenStore?.()}
      />
      {/* 2026.05.
      <Row
        icon={ICONS.miles}
        label="獲得マイル"
        onClick={() => onOpenMiles?.()}
        iconSize={40}
      />
      */}
      {/* 2026.05.
      <Row
        icon={ICONS.faq}
        label="よくある質問"
        onClick={() => onOpenFaq?.()} 
      />
      */}
      <Row
        icon={ICONS.refresh}
        label="更新ボタンについて"
        onClick={() => onOpenRefresh?.()}
        iconSize={46}
        last
      />    
    </div>
  );
}
