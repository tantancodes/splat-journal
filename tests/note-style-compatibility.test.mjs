import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoteStyle } from "../src/journal/note-style.js";

test("legacy notes without a style keep their content and become thought bubbles", () => {
  const legacy = { id: "old-note", p: [0.1, 0.2, 0.3], text: "first visit", strokes: null };
  const normalized = normalizeNoteStyle(legacy);

  assert.equal(normalized, legacy);
  assert.equal(normalized.style, "thought");
  assert.equal(normalized.text, "first visit");
  assert.deepEqual(normalized.p, [0.1, 0.2, 0.3]);
});

test("saved line annotations remain line annotations", () => {
  assert.equal(normalizeNoteStyle({ style: "line" }).style, "line");
});

test("unknown styles fall back safely without changing handwritten strokes", () => {
  const strokes = [[[2, 3], [8, 9]]];
  const note = normalizeNoteStyle({ style: "unknown", strokes });

  assert.equal(note.style, "thought");
  assert.equal(note.strokes, strokes);
});
