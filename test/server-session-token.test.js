const test = require('node:test');
const assert = require('node:assert/strict');

const { server } = require('../server');

function cookieValue(setCookieHeader) {
  return String(setCookieHeader || '').split(';')[0];
}

test('session token API stores token in memory and never returns token value', async (t) => {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  t.after(() => {
    server.close();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const statusResponse = await fetch(`${baseUrl}/api/session/token-status`);
  assert.equal(statusResponse.status, 200);
  const setCookieHeader = statusResponse.headers.get('set-cookie');
  assert.match(setCookieHeader, /turtleflow\.sid=/);
  assert.match(setCookieHeader, /HttpOnly/i);
  const sessionCookie = cookieValue(setCookieHeader);

  const statusPayload = await statusResponse.json();
  assert.equal(statusPayload.hasToken, false);

  const setTokenResponse = await fetch(`${baseUrl}/api/session/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie
    },
    body: JSON.stringify({
      provider: 'openai',
      token: 'sk-example-token'
    })
  });
  assert.equal(setTokenResponse.status, 200);

  const secondStatusResponse = await fetch(`${baseUrl}/api/session/token-status`, {
    headers: { Cookie: sessionCookie }
  });
  const secondStatusPayload = await secondStatusResponse.json();
  assert.equal(secondStatusPayload.hasToken, true);
  assert.equal(secondStatusPayload.provider, 'openai');
  assert.equal(Object.hasOwn(secondStatusPayload, 'token'), false);

  const logoutResponse = await fetch(`${baseUrl}/api/session/token/logout`, {
    method: 'POST',
    headers: { Cookie: sessionCookie }
  });
  assert.equal(logoutResponse.status, 200);

  const finalStatusResponse = await fetch(`${baseUrl}/api/session/token-status`, {
    headers: { Cookie: sessionCookie }
  });
  const finalStatusPayload = await finalStatusResponse.json();
  assert.equal(finalStatusPayload.hasToken, false);
});

test('session token API stores custom provider model and base URL', async (t) => {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  t.after(() => {
    server.close();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const statusResponse = await fetch(`${baseUrl}/api/session/token-status`);
  const sessionCookie = cookieValue(statusResponse.headers.get('set-cookie'));

  const setTokenResponse = await fetch(`${baseUrl}/api/session/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie
    },
    body: JSON.stringify({
      provider: 'custom',
      token: 'custom-example-token',
      baseUrl: 'https://example.compatible-api.test/v1',
      model: 'my-custom-model'
    })
  });
  assert.equal(setTokenResponse.status, 200);

  const setTokenPayload = await setTokenResponse.json();
  assert.equal(setTokenPayload.model, 'my-custom-model');

  const secondStatusResponse = await fetch(`${baseUrl}/api/session/token-status`, {
    headers: { Cookie: sessionCookie }
  });
  const secondStatusPayload = await secondStatusResponse.json();
  assert.equal(secondStatusPayload.hasToken, true);
  assert.equal(secondStatusPayload.provider, 'custom');
  assert.equal(secondStatusPayload.baseUrl, 'https://example.compatible-api.test/v1');
  assert.equal(secondStatusPayload.model, 'my-custom-model');
  assert.equal(Object.hasOwn(secondStatusPayload, 'token'), false);
});
