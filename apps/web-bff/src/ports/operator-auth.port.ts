export interface BeginOperatorLoginResult {
  readonly authorizationUrl: string;
  readonly transactionCookie: string;
}

export interface CompleteOperatorLoginResult {
  readonly sessionCookie: string;
  readonly returnTo: string;
}

export interface OperatorIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
}

export interface ReadOperatorSessionResult {
  readonly identity: OperatorIdentity;
  /** Present only when Cognito rotated/refreshed provider tokens. */
  readonly refreshedSessionCookie: string | null;
}

export interface OperatorAuthPort {
  begin(input: {
    readonly returnTo: string;
  }): Promise<BeginOperatorLoginResult>;
  complete(input: {
    readonly code: string;
    readonly state: string;
    readonly transactionCookie: string;
  }): Promise<CompleteOperatorLoginResult>;
  readSession(input: {
    readonly sessionCookie: string;
  }): Promise<ReadOperatorSessionResult | null>;
  /** Revokes the encrypted refresh token before sending the browser to SSO logout. */
  logout(input: {
    readonly sessionCookie: string;
  }): Promise<{ readonly logoutUrl: string }>;
}
