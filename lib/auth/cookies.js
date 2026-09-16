export function setAuthCookies(response, tokens) {
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
  response.cookies.set('auth_token', tokens?.accessToken || '', { ...options, maxAge: tokens ? 900 : 0 });
  response.cookies.set('refreshToken', tokens?.refreshToken || '', { ...options, maxAge: tokens ? 604800 : 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
