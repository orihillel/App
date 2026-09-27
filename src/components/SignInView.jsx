import { COLORS } from '../lib/colors.js';
import { AuthButtons } from './AuthButtons.jsx';

// The first screen a new install sees, ahead of onboarding: sign in with Google (or Meta)
// before anything else. App.jsx only shows it when a login provider is configured -- without
// one there is nothing to sign in with, and a gate nobody can pass would lock everyone out of
// the whole app, so the app falls back to its old local-only first run instead.
//
// Signing in is required rather than offered: there is deliberately no "skip" here. What
// happens after depends on the account (see handleLoginResult in App.jsx): one with a go-to
// spot already synced lands straight on Home, a new one goes on to pick a go-to spot.
export function SignInView({ onLoggedIn, setToast }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 24, color: COLORS.foam, letterSpacing: '0.1em' }}>SURFCAST</div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 18, color: COLORS.foam, margin: '22px 0 0' }}>Sign in to get started</h1>
        <div style={{ fontSize: 13, color: COLORS.foamDim, marginTop: 10, lineHeight: 1.5 }}>
          Your go-to spot, alerts and sessions are saved to your account and follow you to every device.
        </div>
      </div>
      <AuthButtons onLoggedIn={onLoggedIn} setToast={setToast} />
      <div style={{ fontSize: 11, color: COLORS.foamDim, textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
        New here? Signing in creates your account.
      </div>
    </div>
  );
}
