/**
 * LoadingSplash — Full-screen branded loading screen shown during auth initialization.
 *
 * Intentionally lightweight — no WebGL shaders here to avoid competing with
 * Layout's LiquidMetal on page load. Just the logo on a dark background.
 * Layout's pipe background fades in after the splash dissolves.
 */

import Logo from './Logo';

interface LoadingSplashProps {
  fadingOut?: boolean;
}

export function LoadingSplash({ fadingOut = false }: LoadingSplashProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.6s ease-out',
        pointerEvents: fadingOut ? 'none' : 'auto',
      }}
    >
      {/* Centered logo with pulse animation */}
      <div
        style={{
          width: 80,
          height: 80,
          opacity: 0,
          animation: 'splash-fade-in 0.6s ease-out forwards, splash-pulse 2s ease-in-out 0.6s infinite',
          zIndex: 1,
        }}
      >
        <Logo />
      </div>

      <style>{`
        @keyframes splash-fade-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes splash-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
