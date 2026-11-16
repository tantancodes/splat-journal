import { useEffect, useRef } from "react";
import { mountJournal } from "./journal/engine";

// The interface stays declarative here; the journal engine attaches to these
// stable IDs after mount and owns the viewer, notes, drawing, and persistence.
// Every visible line (underlines, loops, joystick, slip edges) is drawn
// into the empty <svg> hosts below by the engine's pen, not by CSS borders.
export default function App() {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return; // StrictMode double-invokes effects in dev
    mounted.current = true;
    const dispose = mountJournal();
    return () => {
      mounted.current = false;
      dispose();
    };
  }, []);

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        {/* the seal's stamped edge: ink pressed unevenly into paper fibre */}
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="9" result="m" />
          <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3 2.75" result="holes" />
          <feComposite in="d" in2="holes" operator="in" />
        </filter>
      </svg>

      <main className="journal-viewer" aria-label="Splat Journal memory viewer">
        <div id="stage" role="application" aria-label="Interactive 3D memory" />
        {/* paper-toned haze over the scan: a soft vignette and a faint drifting light leak */}
        <div id="haze" aria-hidden="true" />
        <div id="leak" aria-hidden="true" />
        <svg id="ink" aria-hidden="true" />
        <div id="notes" aria-label="Memory notes" />
        <div id="status" role="status" aria-live="polite">loading</div>
        <div id="stick" role="group" aria-label="Float navigation joystick">
          <svg id="stickRing" viewBox="0 0 96 96" aria-hidden="true" />
          <div id="knob">
            <svg id="knobRing" viewBox="0 0 36 36" aria-hidden="true" />
          </div>
        </div>
        <div id="hint" role="status" aria-live="polite" />
        <div id="help" aria-live="polite" />

        {/* tools are words in the margins of the page */}
        <div className="margin top-left" aria-label="Memory actions">
          <button id="openBtn" className="mark" type="button" aria-label="Open a 3D scan">open</button>
          <button id="flipBtn" className="mark" type="button" aria-label="Flip scan orientation">flip</button>
        </div>
        <nav className="margin bottom-left" aria-label="Memory tools">
          <button id="noteBtn" className="mark tool" type="button" aria-label="Add or edit a note" aria-pressed="false">note</button>
          <button id="drawBtn" className="mark tool" type="button" aria-label="Draw on the memory" aria-pressed="false">draw</button>
          <button id="undoBtn" className="mark" type="button" aria-label="Undo last drawing stroke">undo</button>
        </nav>
        <div className="margin bottom-center">
          <button id="floatBtn" className="mark tool on" type="button" aria-label="Float through the memory" aria-pressed="true">float</button>
        </div>

        {/* the colophon: title, date and seal in the corner, as on a card */}
        <footer className="colophon">
          <div className="colophon-text">
            <div
              id="title"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              role="textbox"
              aria-label="Memory title. Tap to rename."
            />
            <svg id="titleLine" aria-hidden="true" />
            <span id="pageDate" />
          </div>
          <span id="seal" aria-hidden="true"><span>01</span></span>
        </footer>
        <input type="file" id="fileInput" accept=".spz,.ply,.splat,.ksplat,.sog" />

        <div id="editor" role="dialog" aria-modal="true" aria-label="Memory note editor">
          <div className="slip" id="slip">
            <svg className="box" id="slipBox" aria-hidden="true" />
            <div className="editor-kicker">a note from this place</div>
            <div className="style-pickers" role="group" aria-label="Floating note style">
              <button id="styleThought" className="style-picker mark on" type="button" aria-pressed="true">thought</button>
              <button id="styleLine" className="style-picker mark" type="button" aria-pressed="false">line</button>
            </div>
            <div className="tabs" role="tablist" aria-label="Note content">
              <button id="tabWrite" className="mark on" type="button" role="tab" aria-selected="true">type</button>
              <button id="tabDraw" className="mark" type="button" role="tab" aria-selected="false">handwrite</button>
            </div>
            <textarea id="noteText" maxLength={160} placeholder="what happened here?" aria-label="Write a memory note" />
            <div className="chips" aria-label="Quick note starters">
              <button className="chip" type="button">ate this</button>
              <button className="chip" type="button">10/10</button>
              <button className="chip" type="button">5/10</button>
              <button className="chip" type="button">sat here</button>
              <button className="chip" type="button">again!</button>
            </div>
            <svg id="pad" viewBox="0 0 260 150" aria-label="Handwriting pad">
              <g id="padBox" />
              <text id="padGhost" x="130" y="80" textAnchor="middle">write or doodle here</text>
              <g id="padInk" />
            </svg>
            <div className="actions">
              <button id="tearBtn" type="button">remove</button>
              <div>
                <button id="padUndo" type="button" aria-label="Undo handwriting stroke">undo</button>
                <button id="cancelBtn" type="button">cancel</button>
                <button id="saveBtn" className="mark" type="button">save</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
