/**
 * Request/response types for the schedulingOAuth Lambda.
 */

export type OAuthAction = 'exchange' | 'refresh' | 'fetchEventTypes' | 'disconnect';

export interface OAuthRequest {
  arguments: {
    action: OAuthAction;
    params: OAuthParams;
  };
}

export interface OAuthParams {
  /** OAuth authorization code (for 'exchange' action) */
  code?: string;
  /** OAuth redirect URI used during authorization (for 'exchange' action) */
  redirectUri?: string;
  /** Provider identifier */
  providerId?: 'CALENDLY' | 'CAL_COM';
  /** SchedulingConnection ID (for 'refresh', 'fetchEventTypes', 'disconnect') */
  connectionId?: string;
  /** OAuth state parameter for CSRF protection (for 'exchange' action) */
  state?: string;
  /** PKCE code verifier (for 'exchange' action — required by Calendly) */
  codeVerifier?: string;
}

export interface OAuthResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

/** Event type from the provider's account */
export interface ProviderEventType {
  id: string;
  name: string;
  durationMinutes: number;
  url: string;
}

/** Token response from provider's OAuth token endpoint */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  created_at?: number;
}
