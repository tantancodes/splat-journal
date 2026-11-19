export type NoteStyle = "pencil" | "whisper";
export type LineFeel = "still" | "breathing" | "sketchy";

export function normalizeNoteStyle<T extends { style?: string | null }>(
  note: T,
): T & { style: NoteStyle };

export function normalizeLineFeel(v: unknown): LineFeel;
