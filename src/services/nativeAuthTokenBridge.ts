export type NativeAuthTokenUser = {
  getIdToken(): Promise<string>;
};

export type NativeAuthTokenDetail = {
  token: string;
  expiresIn: number;
};

/**
 * Resolve the short-lived credential the embedded clay bundle needs for
 * authenticated server calls. The token stays in memory and is returned only
 * to the app-owned WebView that requested it.
 */
export async function nativeAuthTokenDetail(
  user: NativeAuthTokenUser | null,
): Promise<NativeAuthTokenDetail | null> {
  if (!user) return null;
  const token = await user.getIdToken();
  return token ? { token, expiresIn: 3600 } : null;
}
