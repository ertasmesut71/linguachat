import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

/**
 * Wraps a route so only authenticated users can access it.
 * Redirects to /login with a `from` state for post-login redirect.
 */
export default function ProtectedRoute({ children }) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
