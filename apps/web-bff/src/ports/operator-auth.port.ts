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
  }): Promise<OperatorIdentity | null>;
}
