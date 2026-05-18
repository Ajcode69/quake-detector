import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import WorldViewPage from "./pages/WorldViewPage.jsx";
import LocationsPage from "./pages/LocationsPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import SystemHealthPage from "./pages/SystemHealthPage.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<WorldViewPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="health" element={<SystemHealthPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
