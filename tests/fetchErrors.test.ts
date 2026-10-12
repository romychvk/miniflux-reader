import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainError, httpFailureMessage, pageWall } from '../src/lib/fetchErrors.ts';

test('pageWall: Cloudflare challenge page', () => {
	const body = '<!DOCTYPE html><html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=1"></script><script>window._cf_chl_opt={}</script>';
	assert.equal(pageWall(403, body), 'cloudflare');
	assert.equal(pageWall(503, body), 'cloudflare');
});

test('pageWall: another vendor, or no wall', () => {
	assert.equal(pageWall(403, '<html><title>Access Denied</title>Reference #18.abc'), 'bot');
	assert.equal(pageWall(403, '<html><body>Forbidden</body></html>'), null);
	// A 200 or a 404 is the site's own answer, whatever the body says.
	assert.equal(pageWall(404, '<title>Just a moment...</title>'), null);
	assert.equal(pageWall(200, 'challenges.cloudflare.com'), null);
});

test('httpFailureMessage: the wall wins over the status', () => {
	assert.match(httpFailureMessage(403, 'cloudflare'), /Cloudflare bot check.*\(HTTP 403\)/);
	assert.match(httpFailureMessage(403, 'bot'), /bot check.*\(HTTP 403\)/);
	assert.match(httpFailureMessage(403), /refused the request \(HTTP 403\)/);
	assert.match(httpFailureMessage(410), /does not exist \(HTTP 410\)/);
	assert.match(httpFailureMessage(429), /try again later/);
	assert.match(httpFailureMessage(502), /having trouble.*HTTP 502/);
	assert.equal(httpFailureMessage(418), 'The site answered HTTP 418');
});

test('explainError: Miniflux shorthand, with the API path the client appends', () => {
	assert.equal(
		explainError('fetcher: blocked by Cloudflare challenge (403 status code) (entries/22666/fetch-content)'),
		httpFailureMessage(403, 'cloudflare')
	);
	assert.equal(explainError('fetcher: access forbidden (403 status code)'), httpFailureMessage(403));
	assert.equal(explainError('fetcher: resource not found (404 status code) (entries/1/fetch-content)'), httpFailureMessage(404));
	assert.equal(explainError('fetcher: unexpected status code (418 status code)'), httpFailureMessage(418));
});

test("explainError: this app's own server shorthand", () => {
	assert.equal(explainError('Source returned 403 (entries/82025/fetch-content)'), httpFailureMessage(403));
	assert.equal(explainError('Source returned 503'), httpFailureMessage(503));
	const worded = httpFailureMessage(403, 'cloudflare');
	assert.equal(explainError(`${worded} (entries/82025/fetch-content)`), worded);
});

test('explainError: anything else is left as it is, path included', () => {
	for (const msg of ['Failed to re-fetch content', 'Unauthorized (me)', 'fetcher: empty response body', 'No article content found (entries/5/fetch-content)']) {
		assert.equal(explainError(msg), msg);
	}
});
