const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

process.env.ADMIN_PORTAL_PASSWORD = process.env.ADMIN_PORTAL_PASSWORD || 'test-admin-password';
process.env.COMMUNITY_GALLERY_CACHE_FILE = process.env.COMMUNITY_GALLERY_CACHE_FILE
  || path.join(os.tmpdir(), `turtlelab-community-gallery-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
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
  assert.match(setCookieHeader, /turtlelab\.sid=/);
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

test('community gallery submission flow supports admin review and public filtering', async (t) => {
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

  const submitResponse = await fetch(`${baseUrl}/api/gallery/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Gallery User',
      email: 'gallery.user@example.com',
      prompt: 'draw a house and tree',
      code: 'penup()\nhome()\npendown()\nforward(40)',
      metadata: {
        title: 'My drawing',
        description: 'A house and a tree',
        explanation: 'The turtle drew a simple house and tree.'
      }
    })
  });
  assert.equal(submitResponse.status, 201);
  const submitPayload = await submitResponse.json();
  assert.equal(typeof submitPayload.id, 'string');

  const publicBeforeAccept = await fetch(`${baseUrl}/api/gallery`);
  const publicBeforePayload = await publicBeforeAccept.json();
  assert.equal(publicBeforePayload.items.length, 0);

  const unauthorizedAdminList = await fetch(`${baseUrl}/api/admin/submissions`);
  assert.equal(unauthorizedAdminList.status, 401);

  const adminListResponse = await fetch(`${baseUrl}/api/admin/submissions`, {
    headers: { 'X-Admin-Password': 'test-admin-password' }
  });
  assert.equal(adminListResponse.status, 200);
  const adminListPayload = await adminListResponse.json();
  assert.equal(adminListPayload.items.length, 1);
  assert.equal(adminListPayload.items[0].email, 'gallery.user@example.com');

  const decisionResponse = await fetch(`${baseUrl}/api/admin/submissions/${encodeURIComponent(submitPayload.id)}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': 'test-admin-password'
    },
    body: JSON.stringify({ decision: 'accept' })
  });
  assert.equal(decisionResponse.status, 200);
  const decisionPayload = await decisionResponse.json();
  assert.equal(decisionPayload.item.status, 'accepted');
  assert.equal(Array.isArray(decisionPayload.item.tags), true);

  const publicAfterAccept = await fetch(`${baseUrl}/api/gallery`);
  const publicAfterPayload = await publicAfterAccept.json();
  assert.equal(publicAfterPayload.items.length, 1);
  assert.equal(Object.hasOwn(publicAfterPayload.items[0], 'email'), false);
});
