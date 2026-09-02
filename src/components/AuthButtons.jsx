import { useEffect, useRef, useState } from 'react';
import { isGoogleConfigured, isFacebookConfigured, renderGoogleButton, loginWithFacebook, loginWithGoogleIdToken, loginWithFacebookAccessToken } from '../lib/auth.js';

// "Continue with Google" / "Continue with Meta" — used on both Onboarding (for first-time
// users) and Profile (for anyone who skipped it there). Renders nothing at all if neither
// provider has been configured (see worker/README.md) — same gracefully-optional pattern as
// the push-notification toggle. Note: Meta's actual login product is still called "Facebook
// Login" in their developer platform (there's no separate "Meta Login" API) — "Continue with
// Meta" here is just this app's button label, calling the same SDK.
export function AuthButtons({ onLoggedIn, setToast }) {
  const googleRef = useRef(null);
  const [fbBusy, setFbBusy] = useState(false);
  const showGoogle = isGoogleConfigured();
  const showFacebook = isFacebookConfigured();

  useEffect(() => {
    if (!showGoogle || !googleRef.current) return;
    let cancelled = false;
    renderGoogleButton(googleRef.current, async (idToken) => {
      try {
        const result = await loginWithGoogleIdToken(idToken);
        onLoggedIn(result);
      } catch (e) {
        setToast(e.message || 'Google sign-in failed');
      }
    }).catch(() => { if (!cancelled) setToast('Could not load Google sign-in'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGoogle]);

  async function handleFacebook() {
    setFbBusy(true);
    try {
      const accessToken = await loginWithFacebook();
      const result = await loginWithFacebookAccessToken(accessToken);
      onLoggedIn(result);
    } catch (e) {
      setToast(e.message || 'Facebook sign-in failed');
    } finally {
      setFbBusy(false);
    }
  }

  if (!showGoogle && !showFacebook) return null;

  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      {showGoogle && <div ref={googleRef} style={{ display: 'flex', justifyContent: 'center' }} />}
      {showFacebook && (
        <button className="tl-btn" onClick={handleFacebook} disabled={fbBusy}
          style={{ width: '100%', background: '#1877F2', border: 'none', borderRadius: 999, padding: '11px 0', color: '#fff', fontWeight: 700, fontSize: 13.5, opacity: fbBusy ? 0.7 : 1 }}>
          {fbBusy ? 'Connecting…' : 'Continue with Meta'}
        </button>
      )}
    </div>
  );
}
