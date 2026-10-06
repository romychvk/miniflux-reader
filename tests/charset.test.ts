import { test } from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { charsetFromContentType, charsetFromHtmlMeta, charsetFromXmlDeclaration, decodeTextBytes } from '../src/lib/server/charset.ts';

test('an HTML page is decoded by its header, else its <meta>, else UTF-8', () => {
	const page = '<html><head><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=koi8-r"></head><body>Анонсировано</body></html>';
	const koi = iconv.encode(page, 'koi8-r');
	assert.equal(decodeTextBytes(koi, 'text/html; charset=koi8-r').text, page);
	const byMeta = decodeTextBytes(koi, 'text/html');
	assert.equal(byMeta.charset, 'koi8-r');
	assert.equal(byMeta.text, page);
	assert.equal(decodeTextBytes(iconv.encode('<meta charset=windows-1251><p>Привіт', 'windows-1251'), null).text, '<meta charset=windows-1251><p>Привіт');
	assert.equal(decodeTextBytes(Buffer.from('<p>ї</p>', 'utf-8'), 'text/html').text, '<p>ї</p>');
	assert.equal(decodeTextBytes(Buffer.from('<meta charset="utf-16"><p>ї</p>', 'utf-8'), null).charset, 'utf-8');
	assert.equal(decodeTextBytes(Buffer.from('{"a":"ї"}', 'utf-8'), 'application/json').text, '{"a":"ї"}');
});

test('a BOM beats the header, a declaration labels XML, an unknown label falls back to UTF-8', () => {
	const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<rss>ї</rss>', 'utf-8')]);
	assert.deepEqual(decodeTextBytes(bom, 'text/xml; charset=windows-1251'), { text: '<rss>ї</rss>', charset: 'utf-8' });
	const declared = decodeTextBytes(iconv.encode('<?xml version="1.0" encoding="windows-1251"?><rss>Привіт</rss>', 'windows-1251'), 'application/rss+xml');
	assert.equal(declared.charset, 'windows-1251');
	assert.ok(declared.text.includes('Привіт'));
	assert.equal(decodeTextBytes(Buffer.from('<p>ї</p>', 'utf-8'), 'text/html; charset=x-made-up').charset, 'utf-8');
});

test('label readers', () => {
	assert.equal(charsetFromContentType('text/html; charset="UTF-8"'), 'utf-8');
	assert.equal(charsetFromContentType('text/html'), null);
	assert.equal(charsetFromXmlDeclaration("<?xml version='1.0' encoding='KOI8-U'?>"), 'koi8-u');
	assert.equal(charsetFromHtmlMeta('<meta charset="UTF-8">'), 'utf-8');
	assert.equal(charsetFromHtmlMeta('<meta http-equiv="content-type" content="text/html; charset=KOI8-R">'), 'koi8-r');
	assert.equal(charsetFromHtmlMeta('<meta name="viewport" content="width=device-width">'), null);
});
