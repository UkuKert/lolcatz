import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
const base = process.env.TEST_URL || 'http://gateway:8080';
const headers = { Authorization: 'Bearer lolcatz-local', 'Content-Type': 'application/json' };
async function request(path, options = {}, status = 200) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  assert.equal(response.status, status, `${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function expectStatus(path, options, status) {
  const response = await fetch(base + path, options);
  assert.equal(response.status, status, `${path}: ${await response.text()}`);
}
const id = 'test' + Date.now().toString(36);
let image;
try {
  await expectStatus('/api/admin/boards', { method: 'POST', body: '{}' }, 401);
  await expectStatus('/api/admin/me', { headers: { Authorization: 'Bearer forged' } }, 401);
  assert.equal((await request('/api/admin/me', { headers })).role, 'admin');
  await expectStatus('/api/admin/boards', { method: 'POST', headers, body: JSON.stringify({ id: 'search', name: 'Reserved' }) }, 400);
  await request('/api/browse/boards'); // Warm the cache before mutation.
  await request('/api/admin/boards', { method: 'POST', headers, body: JSON.stringify({ id, name: 'Integration test' }) }, 201);
  assert.ok((await request('/api/browse/boards')).some(b => b.id === id));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const jpeg = await readFile(new URL('./pixel.jpg', import.meta.url));
  image = await request(`/api/upload/bulk/test.jpg?board=${id}&title=${id}`, { method: 'PUT', headers: { Authorization: headers.Authorization, 'Content-Type': 'image/jpeg' }, body: jpeg });
  const ranked = await request('/api/browse/boards');
  assert.equal(ranked.find(b => b.id === id).count, 1);
  assert.deepEqual(ranked, [...ranked].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)));
  let post;
  for (let attempt = 0; attempt < 40; attempt++) {
    post = (await request(`/api/browse/images/${image.id}`)).image;
    if (post.exif) break;
    await setTimeout(250);
  }
  assert.equal(post.id, image.id);
  assert.equal(post.exif?.width, 2, 'EXIF worker must persist JPEG dimensions');
  assert.equal(post.exif?.height, 3);
  assert.ok((await request(`/api/search/search?q=${id}`)).some(i => i.id === image.id));
  await expectStatus(`/api/admin/boards/${id}`, { method: 'DELETE', headers }, 409);
  await expectStatus('/api/admin/boards/b', { method: 'DELETE', headers }, 409);
  await request(`/api/upload/images/${image.id}`, { method: 'DELETE', headers }, 204);
  image = null;
  assert.equal((await request('/api/browse/boards')).find(b => b.id === id).count, 0);
  await request(`/api/admin/boards/${id}`, { method: 'DELETE', headers }, 204);
  assert.ok(!(await request('/api/browse/boards')).some(b => b.id === id));
  await expectStatus(`/api/upload/bulk/test.png?board=${id}`, { method: 'PUT', headers: { Authorization: headers.Authorization, 'Content-Type': 'image/png' }, body: png }, 400);
  console.log('PASS: auth, board CRUD, reserved/default boards, upload, search, ranking, cache invalidation, EXIF processing, deletion');
} finally {
  if (image) await fetch(base + `/api/upload/images/${image.id}`, { method: 'DELETE', headers });
  await fetch(base + `/api/admin/boards/${id}`, { method: 'DELETE', headers });
}
