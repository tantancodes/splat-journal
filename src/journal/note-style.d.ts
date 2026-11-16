export type NoteStyle = "thought" | "line";

export function normalizeNoteStyle<T extends { style?: NoteStyle | string | null }>(
  note: T,
): T & { style: NoteStyle };
