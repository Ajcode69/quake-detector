import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e, fastLogin = false) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const targetEmail = fastLogin ? "admin@kc.com" : email;
      const targetPassword = fastLogin ? "admin123" : password;
      
      await login(targetEmail, targetPassword);
      // Force page reload to ensure all react query hooks initialize with new x-user-id
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center font-sans">
      <div className="w-full max-w-sm p-8 bg-surface-secondary border border-border rounded-xl shadow-2xl relative overflow-hidden">
        
        {/* Glow Effects */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/20 blur-[50px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/20 blur-[50px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-xl font-black text-white mb-3 shadow-lg">
              S
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">SeismicOps</h1>
            <p className="text-sm text-slate-400 mt-1 text-center">Monitoring & Telemetry Portal</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-3 rounded-lg mb-6 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                placeholder="operator@seismic.ops"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </form>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-surface-secondary px-2 text-slate-500">OR</span>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => handleLogin(e, true)}
            disabled={loading}
            className="w-full bg-surface border border-border hover:bg-surface-card text-white font-medium text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 group"
          >
            ⚡ <span className="group-hover:text-blue-400 transition-colors">Fast Login (Admin)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
