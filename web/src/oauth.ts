export interface OAuthCallbackFields {
  code?: string;
  error?: string;
  errorDescription?: string;
  iss?: string;
  state?: string;
}

/** Add an OAuth response to a previously validated callback URI. */
export function buildOAuthCallbackUrl(
  redirectUri: string,
  fields: OAuthCallbackFields,
): string {
  const callback = new URL(redirectUri);
  const values: Array<[string, string | undefined]> = [
    ["code", fields.code],
    ["error", fields.error],
    ["error_description", fields.errorDescription],
    ["state", fields.state],
    ["iss", fields.iss],
  ];
  for (const [name, value] of values) {
    if (value !== undefined) callback.searchParams.set(name, value);
  }
  return callback.toString();
}
