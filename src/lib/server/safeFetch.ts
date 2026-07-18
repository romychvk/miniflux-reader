import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { lookup as dnsLookupCb } from 'node:dns';
import ipaddr from 'ipaddr.js';

// Guarded fetch for arbitrary user-supplied URLs (the fetch-page / og-image / rss-bridge
// endpoints). It is NOT for Miniflux-targeted requests (proxy, /v1/me) — those are pinned to
// ALLOWED_MINIFLUX_SERVER instead, because a self-hosted Miniflux may legitimately live on a
// private address, which this blocklist would (correctly) reject.
//
// Protections:
//   - scheme allowlist (http/https only), re-checked on every redirect hop;
//   - DNS resolution + rejection of non-public addresses (loopback, private, CGNAT, link-local
//     incl. cloud metadata 169.254.169.254, ULA, multicast, reserved) for IPv4 and IPv6;
//   - manual redirect following so each hop's address is validated (a public URL can 3xx to an
//     internal one), plus a hop cap;
//   - a validating DNS lookup wired into the actual socket connect, so the IP we vetted is the IP
//     we connect to — closing the classic resolve-then-reconnect (DNS-rebinding) gap for hostnames;
//   - a hard timeout and a streaming byte cap (reading is aborted once the cap is hit, so a hostile
//     endpoint can't stream forever or blow up memory — this also caps decompression bombs).

export type SafeFetchReason = 'scheme' | 'blocked' | 'dns' | 'redirects' | 'timeout' | 'upstream';

export class SafeFetchError extends Error {
	readonly reason: SafeFetchReason;
	constructor(reason: SafeFetchReason, message?: string) {
		super(message ?? reason);
		this.name = 'SafeFetchError';
		this.reason = reason;
	}
	// True when the caller asked for something we refuse (map to 4xx); false for upstream/network
	// failures (map to 5xx).
	get isPolicy(): boolean {
		return this.reason === 'scheme' || this.reason === 'blocked' || this.reason === 'dns' || this.reason === 'redirects';
	}
}

// A client-safe, IP-free description for each failure.
export function describeSafeFetchError(e: SafeFetchError): string {
	switch (e.reason) {
		case 'scheme':
			return 'Only http(s) URLs are allowed';
		case 'blocked':
			return 'That address is not allowed';
		case 'dns':
			return 'Could not resolve the host';
		case 'redirects':
			return 'Too many redirects';
		case 'timeout':
			return 'The source took too long to respond';
		default:
			return 'Failed to fetch the URL';
	}
}

export interface SafeFetchResult {
	status: number;
	ok: boolean;
	contentType: string | null;
	body: string;
}

export interface SafeFetchOptions {
	headers?: Record<string, string>;
	maxBytes: number;
	timeoutMs?: number;
	maxRedirects?: number;
}

// Public-unicast only. ipaddr.js classifies everything else (loopback, private, CGNAT, linkLocal,
// uniqueLocal/ULA, multicast, reserved, unspecified, broadcast) as a non-'unicast' range, so we
// allow only 'unicast'. IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped so a mapped private v4 is
// still caught; other embedded-v4 forms (6to4/teredo) report their own non-'unicast' range.
function isAllowedIp(ip: string): boolean {
	let addr: ipaddr.IPv4 | ipaddr.IPv6;
	try {
		addr = ipaddr.parse(ip);
	} catch {
		return false; // unparseable → fail closed
	}
	if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
		addr = (addr as ipaddr.IPv6).toIPv4Address();
	}
	return addr.range() === 'unicast';
}

// net.connect uses this to resolve hostnames; by validating every resolved address here and
// returning it, undici/net connects to exactly the IP we vetted (rebinding closed). IP-literal
// hosts skip lookup entirely, so those are checked separately in assertHopAllowed().
const validatingLookup: net.LookupFunction = (hostname, options, callback) => {
	const cb = callback as (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
	dnsLookupCb(hostname, { ...(options as object), all: true }, (err, addresses) => {
		if (err) return cb(err);
		const list = addresses as unknown as { address: string; family: number }[];
		if (!list.length) return cb(new Error('SSRF_NOADDR'));
		for (const a of list) {
			if (!isAllowedIp(a.address)) return cb(new Error(`SSRF_BLOCKED:${a.address}`));
		}
		if ((options as { all?: boolean })?.all) return cb(null, list);
		return cb(null, list[0].address, list[0].family);
	});
};

function assertHopAllowed(url: URL): void {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new SafeFetchError('scheme', `unsupported scheme ${url.protocol}`);
	}
	// IP-literal hosts bypass validatingLookup (net.connect skips DNS for them), so vet them here.
	// URL.hostname keeps the brackets around an IPv6 literal ([::1]); strip them so net.isIP sees it.
	const host = url.hostname.replace(/^\[(.+)\]$/, '$1');
	if (net.isIP(host) && !isAllowedIp(host)) {
		throw new SafeFetchError('blocked', host);
	}
}

function classifyError(e: unknown): SafeFetchError {
	if (e instanceof SafeFetchError) return e;
	const err = e as { name?: string; code?: string; message?: string };
	const msg = err?.message ?? String(e);
	if (msg.startsWith('SSRF_BLOCKED')) return new SafeFetchError('blocked', msg);
	if (msg.startsWith('SSRF_NOADDR')) return new SafeFetchError('dns', 'no address');
	if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR') {
		return new SafeFetchError('timeout', 'request timed out');
	}
	return new SafeFetchError('upstream', msg);
}

function performRequest(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const mod = url.protocol === 'https:' ? https : http;
		const req = mod.request(url, { method: 'GET', headers, lookup: validatingLookup, signal }, resolve);
		req.on('error', reject);
		req.end();
	});
}

function decompress(res: IncomingMessage): Readable {
	const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
	if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
	if (enc === 'deflate') return res.pipe(zlib.createInflate());
	if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
	return res;
}

// Reads (and decompresses) the response body up to maxBytes, then stops — a cap on the DECODED
// size, so a decompression bomb is bounded too. Destroys the socket so the connection is freed.
async function readCappedText(res: IncomingMessage, maxBytes: number): Promise<string> {
	const stream = decompress(res);
	const chunks: Buffer[] = [];
	let total = 0;
	try {
		for await (const chunk of stream) {
			const buf = chunk as Buffer;
			const remaining = maxBytes - total;
			if (buf.length >= remaining) {
				chunks.push(buf.subarray(0, remaining));
				total = maxBytes;
				break;
			}
			chunks.push(buf);
			total += buf.length;
		}
	} finally {
		res.destroy();
		if (stream !== res) stream.destroy();
	}
	return Buffer.concat(chunks).toString('utf-8');
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
	const { headers = {}, maxBytes, timeoutMs = 12_000, maxRedirects = 4 } = opts;

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SafeFetchError('scheme', 'invalid url');
	}

	const signal = AbortSignal.timeout(timeoutMs);

	for (let hop = 0; ; hop++) {
		assertHopAllowed(url);

		let res: IncomingMessage;
		try {
			res = await performRequest(url, headers, signal);
		} catch (e) {
			throw classifyError(e);
		}

		const status = res.statusCode ?? 0;
		const location = res.headers.location;
		if (status >= 300 && status < 400 && location) {
			res.destroy();
			if (hop >= maxRedirects) throw new SafeFetchError('redirects', 'too many redirects');
			try {
				url = new URL(Array.isArray(location) ? location[0] : location, url);
			} catch {
				throw new SafeFetchError('upstream', 'invalid redirect location');
			}
			continue;
		}

		let body: string;
		try {
			body = await readCappedText(res, maxBytes);
		} catch (e) {
			throw classifyError(e);
		}
		const ct = res.headers['content-type'];
		return {
			status,
			ok: status >= 200 && status < 300,
			contentType: (Array.isArray(ct) ? ct[0] : ct) ?? null,
			body
		};
	}
}
