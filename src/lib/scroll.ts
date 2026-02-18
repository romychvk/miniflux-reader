let scrollDirection: 'up' | 'down' = 'down';
let lastScrollY = 0;
let listenerCount = 0;

function onScroll() {
	const currentScrollY = window.scrollY;
	scrollDirection = currentScrollY > lastScrollY ? 'down' : 'up';
	lastScrollY = currentScrollY;
}

export function getScrollDirection(): 'up' | 'down' {
	return scrollDirection;
}

export function addScrollTracker() {
	if (listenerCount === 0) {
		window.addEventListener('scroll', onScroll, { passive: true });
	}
	listenerCount++;
}

export function removeScrollTracker() {
	listenerCount--;
	if (listenerCount <= 0) {
		listenerCount = 0;
		window.removeEventListener('scroll', onScroll);
	}
}
