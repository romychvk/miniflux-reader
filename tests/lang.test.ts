import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLang, entryLang } from '../src/lib/lang.ts';
import type { Entry } from '../src/lib/types.ts';

// Shapes only what entryLang() reads.
function entry(language?: string, feedLanguage?: string): Entry {
	return { language, feed: { language: feedLanguage } } as unknown as Entry;
}

test('normalizeLang keeps well-formed tags', () => {
	assert.equal(normalizeLang('uk'), 'uk');
	assert.equal(normalizeLang('ukr'), 'ukr');
	assert.equal(normalizeLang('en-US'), 'en-US');
	assert.equal(normalizeLang('zh-Hant-TW'), 'zh-Hant-TW');
	assert.equal(normalizeLang(' en-GB '), 'en-GB');
});

// Shapes a 2.3.3 server already rejects or rewrites — handled here for older instances and
// because the value goes straight into an attribute.
test('normalizeLang repairs the shapes a server might let through', () => {
	assert.equal(normalizeLang('en_US'), 'en-US'); // underscore separator
	assert.equal(normalizeLang('ru-RU, en-US'), 'ru-RU'); // a list — first tag wins
});

test('normalizeLang rejects anything that is not a tag', () => {
	assert.equal(normalizeLang(undefined), undefined);
	assert.equal(normalizeLang(null), undefined);
	assert.equal(normalizeLang(''), undefined);
	assert.equal(normalizeLang('   '), undefined);
	assert.equal(normalizeLang('English'), undefined);
	assert.equal(normalizeLang('e'), undefined);
	assert.equal(normalizeLang('<script>'), undefined);
	assert.equal(normalizeLang('en" onload="x'), undefined);
});

test('entryLang prefers the entry, then the feed, then nothing', () => {
	assert.equal(entryLang(entry('uk', 'en')), 'uk');
	// Entries inserted before Miniflux 2.3.3 have no language; their feed does after a refresh.
	assert.equal(entryLang(entry(undefined, 'en-GB')), 'en-GB');
	assert.equal(entryLang(entry('', 'uk')), 'uk');
	// An unusable value on the entry falls through rather than suppressing the attribute.
	assert.equal(entryLang(entry('unknown', 'uk')), 'uk');
	assert.equal(entryLang(entry()), undefined);
});
