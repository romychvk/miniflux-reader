// Where an opened article is shown. One answer at a time — "full window, alone" (zen) sits on the
// same axis as the split placements, which is why it is a mode here rather than a flag layered on
// top of one. Kept out of the runes store so the migration below stays unit-testable.

export type LayoutMode = 'two-column' | 'three-column' | 'expanded' | 'zen';

export const LAYOUT_MODES: LayoutMode[] = ['two-column', 'three-column', 'expanded', 'zen'];

export function parseLayoutMode(saved: string | null | undefined): LayoutMode | null {
	return saved && (LAYOUT_MODES as string[]).includes(saved) ? (saved as LayoutMode) : null;
}

// Zen first shipped as a separate persisted boolean that overrode the placement, so a reader could
// end up with "Right of feeds" selected while articles opened full-page. Fold that state in once:
// the flag only ever added anything on top of the full-page pane, so two-column + zen becomes 'zen'
// and every other pane keeps its own placement — which is what the reader was actually looking at.
export function migrateLegacyZen(mode: LayoutMode, legacyZen: string | null | undefined): LayoutMode {
	if (legacyZen !== 'true') return mode;
	return mode === 'two-column' ? 'zen' : mode;
}
