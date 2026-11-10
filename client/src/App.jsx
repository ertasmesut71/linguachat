import { useEffect, useState, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { useChatStore } from "./store/chatStore";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import QRLoginPage from "./pages/QRLoginPage";
import ScanQRPage from "./pages/ScanQRPage";
import ProfilePage from "./pages/ProfilePage";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentCancel from "./pages/PaymentCancel";
import AppLayout from "./components/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import Spinner from "./components/ui/Spinner";

function AppInner() {
  const { user, isLoading, initialize } = useAuthStore();
  const { initSocket, disconnectSocket, fetchChats } = useChatStore();
  const [toast, setToast] = useState(null);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    if (user) { initSocket(); fetchChats(); }
    else { disconnectSocket(); }
    return () => { disconnectSocket(); };
  }, [user?.id]);

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    window.__linguachat_toast = showToast;
    return () => { delete window.__linguachat_toast; };
  }, [showToast]);

  if (isLoading) {
    return (
      <div className="loading-page">
        <Spinner size="lg" />
        <span className="loading-text">Loading LinguaChat...</span>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
        <Route path="/reset-password" element={user ? <Navigate to="/" replace /> : <ResetPasswordPage />} />
        <Route path="/qr-login" element={user ? <Navigate to="/" replace /> : <QRLoginPage />} />
        <Route path="/scan" element={<ProtectedRoute><ScanQRPage /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/payment/cancel" element={<PaymentCancel />} />
        <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
      </Routes>
      {toast && (
        <div className={`toast toast-${toast.type}`} onClick={() => setToast(null)}>
          {toast.message}
        </div>
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
