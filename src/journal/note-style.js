export function normalizeNoteStyle(note) {
  note.style = note.style === "line" ? "line" : "thought";
  return note;
}
