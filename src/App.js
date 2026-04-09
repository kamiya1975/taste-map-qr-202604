// src/App.js
import React, { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import { bootstrapIdentity } from "./utils/auth";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import { initLotIdFromUrl } from "./utils/lot";

// Pages
import IntroPage from "./pages/IntroPage";
import MapPage from "./pages/MapPage";
import ProductPage from "./pages/ProductPage";
import EcReturnPage from "./pages/EcReturnPage";
import SliderPage from "./pages/SliderPage";
import StorePage from "./pages/StorePage";
import UserTastePage from "./pages/UserTastePage";
import ScanAndProductFlow from "./pages/ScanAndProductFlow";
import CartPage from "./pages/CartPage";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    bootstrapIdentity();
    initLotIdFromUrl(); 

    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true; // iOS

    const navType = performance.getEntriesByType?.("navigation")?.[0]?.type;
    const isColdStart =
      !sessionStorage.getItem("tm_started_once") &&
      (navType === "navigate" || navType === "reload" || !navType);

    // ※ PWA起動時だけ /map へ寄せる。reset-password は例外扱いでも良いが、
    //   基本はブラウザから開く想定なのでこのままでも大きな問題はない。
    if (isStandalone && isColdStart && location.pathname !== "/map") {
      navigate("/map", { replace: true });
    }
    sessionStorage.setItem("tm_started_once", "1");
  }, [navigate, location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<IntroPage />} />
      <Route path="/store" element={<StorePage />} />
      <Route path="/slider" element={<SliderPage />} />
      {/*2026.04.以下2行を以下の5行と置き換え
      <Route path="/map" element={<MapPage />} />
      <Route path="/products/:jan" element={<ProductPage />} />
      */}
      <Route path="/map" element={<MapPage />} />
      {/* 展示会モデル: 背景Mapつき商品表示 */}
      <Route path="/products/:jan" element={<MapPage />} />
      {/* iframe専用の商品ページ */}
      <Route path="/product-frame/:jan" element={<ProductPage />} />

      <Route path="/ec/return" element={<EcReturnPage />} />
      <Route path="/taste-log" element={<UserTastePage />} />
      <Route path="/scan-flow" element={<ScanAndProductFlow />} />
      <Route path="/cart" element={<CartPage />} />

      {/* ★ 404より前に置く */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* それ以外は /map に飛ばす */}
      <Route path="*" element={<Navigate to="/map" replace />} />
    </Routes>
  );
}
