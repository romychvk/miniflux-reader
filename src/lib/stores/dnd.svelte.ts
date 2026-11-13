export type DragType = 'feed' | 'category' | null;

// A feed lands in category `catId` at `insertIndex` among its feeds. A category lands before or
// after the category `catId` (as its sibling), or into it as its last subcategory
// (caps.nestedCategories).
export type DropTarget =
	| { type: 'feed'; catId: number; insertIndex: number }
	| { type: 'category'; catId: number; position: 'before' | 'after' | 'into' };

function createDndStore() {
	let dragType = $state<DragType>(null);
	let dragId = $state<number | null>(null);
	let dragSourceCatId = $state<number | null>(null);
	let dropTarget = $state<DropTarget | null>(null);

	function startDrag(type: 'feed' | 'category', id: number, sourceCatId?: number) {
		dragType = type;
		dragId = id;
		dragSourceCatId = sourceCatId ?? null;
	}

	function setDropTarget(target: DropTarget | null) {
		dropTarget = target;
	}

	function reset() {
		dragType = null;
		dragId = null;
		dragSourceCatId = null;
		dropTarget = null;
	}

	return {
		get dragType() { return dragType; },
		get dragId() { return dragId; },
		get dragSourceCatId() { return dragSourceCatId; },
		get dropTarget() { return dropTarget; },
		startDrag,
		setDropTarget,
		reset
	};
}

export const dnd = createDndStore();
