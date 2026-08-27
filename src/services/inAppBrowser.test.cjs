const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizePoplurBrowserUrl,
  resolvePoplurBrowserTargetUrl,
  shouldAllowPoplurBrowserRequest,
} = require('./inAppBrowser.ts');

test('admits only credential-free HTTPS addresses', () => {
  assert.equal(
    normalizePoplurBrowserUrl('https://example.com/news?story=1'),
    'https://example.com/news?story=1',
  );
  assert.equal(normalizePoplurBrowserUrl('https://user:secret@example.com/news'), null);
  assert.equal(normalizePoplurBrowserUrl('http://example.com/news'), null);
  assert.equal(normalizePoplurBrowserUrl('file:///tmp/news.html'), null);
});

test('applies the 2,048-character address bound', () => {
  assert.ok(normalizePoplurBrowserUrl('https://example.com/'.padEnd(2048, 'x')));
  assert.equal(normalizePoplurBrowserUrl('https://example.com/'.padEnd(2049, 'x')), null);
});

test('keeps allowed target-window navigation in the current browser', () => {
  assert.equal(
    resolvePoplurBrowserTargetUrl('https://shop.example.com/drop'),
    'https://shop.example.com/drop',
  );
  assert.equal(resolvePoplurBrowserTargetUrl('poplur://profile'), null);
  assert.equal(resolvePoplurBrowserTargetUrl('https://buyer:token@shop.example.com/drop'), null);
});

test('uses the same policy for every top-level WebView request', () => {
  assert.equal(shouldAllowPoplurBrowserRequest('https://example.com/next'), true);
  assert.equal(shouldAllowPoplurBrowserRequest('http://example.com/next'), false);
  assert.equal(shouldAllowPoplurBrowserRequest('intent://example.com/next'), false);
});
