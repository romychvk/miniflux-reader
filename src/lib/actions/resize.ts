export interface ResizableOptions {
	getCurrentValue: () => number;
	onResize: (value: number) => void;
	/** Set true for left-edge resize (ArticlePanel) where dragging right shrinks */
	invert?: boolean;
}

export function resizable(node: HTMLElement, options: ResizableOptions) {
	let activeCleanup: (() => void) | null = null;

	function onMouseDown(e: MouseEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startValue = options.getCurrentValue();

		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		node.classList.add('active');

		function onMouseMove(e: MouseEvent) {
			const delta = e.clientX - startX;
			options.onResize(options.invert ? startValue - delta : startValue + delta);
		}

		function onMouseUp() {
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
			node.classList.remove('active');
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			activeCleanup = null;
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		activeCleanup = onMouseUp;
	}

	node.addEventListener('mousedown', onMouseDown);

	return {
		destroy() {
			node.removeEventListener('mousedown', onMouseDown);
			activeCleanup?.();
		}
	};
}
