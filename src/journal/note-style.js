export function normalizeNoteStyle(note) {
  // Preserve whisper notes; older bubble notes move to the current pencil look.
  if (note.style !== "whisper" && note.style !== "pencil") note.style = "pencil";
  return note;
}

export function normalizeLineFeel(v) {
  return v === "still" || v === "sketchy" ? v : "breathing";
}
