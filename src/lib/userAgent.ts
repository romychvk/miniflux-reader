// User-Agent presets for the feed-level "Override Default User Agent" field.
//
// When a feed's user_agent is empty, Miniflux fetches with its own default UA.
// Some sites (notably reddit.com) rate-limit that default with HTTP 429, so a
// browser-like or otherwise distinct UA is often needed. These presets give
// one-click common values while the field itself stays freely editable for
// anything custom — e.g. an identified bot UA pointing at YOUR deployment:
//   Mozilla/5.0 (compatible; my-reader/1.0; +https://reader.example.com)

export interface UserAgentPreset {
	label: string;
	value: string;
}

// Sentinel select value meaning "the text field holds something not in the list".
export const CUSTOM_UA = '__custom__';

export const USER_AGENT_PRESETS: UserAgentPreset[] = [
	{ label: 'Default (Miniflux)', value: '' },
	{
		label: 'Chrome on Windows',
		value:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
	},
	{
		label: 'Firefox on Windows',
		value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0'
	},
	{
		label: 'Safari on iPhone',
		value:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
	},
	{
		label: 'Googlebot',
		value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
	}
];

// The select value for a given UA string: the matching preset's value (''
// included) if one matches exactly, otherwise the CUSTOM_UA sentinel.
export function matchUserAgentPreset(value: string): string {
	const v = value.trim();
	return USER_AGENT_PRESETS.some((p) => p.value === v) ? v : CUSTOM_UA;
}
