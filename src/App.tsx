import { useEffect, useRef } from "react";
import { mountJournal } from "./journal/engine";

// The interface stays declarative here; the journal engine attaches to these
// stable IDs after mount and owns the viewer, notes, drawing, and persistence.
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
        <filter id="rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
      </svg>

      <main className="journal-viewer" aria-label="Splat Journal memory viewer">
        <div id="stage" role="application" aria-label="Interactive 3D memory" />
        <svg id="ink" aria-hidden="true" />
        <div id="notes" aria-label="Memory notes" />
        <div id="status" role="status" aria-live="polite">loading</div>
        <div id="hint" role="status" aria-live="polite" />
        <button id="undoBtn" type="button" aria-label="Undo last drawing stroke">
          <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 8 4.5 11.5 8 15" />
            <path d="M5 11.5h8a5.5 5.5 0 0 1 0 11" />
          </svg>
          <span>undo</span>
        </button>
        <div id="stick" role="group" aria-label="Float navigation joystick">
          <svg viewBox="0 0 96 96" aria-hidden="true"><path className="pen" id="stickRing" /></svg>
          <div id="knob">
            <svg viewBox="0 0 36 36" aria-hidden="true"><path className="pen filled" id="knobRing" /></svg>
          </div>
        </div>
        <div id="mat" aria-hidden="true" />
        <svg id="frame" aria-hidden="true"><path className="pen" id="framePath" /></svg>

        <header className="journal-header">
          <div className="header-story">
            <div id="seal" aria-hidden="true">01</div>
            <div className="head-text">
              <div
                id="title"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                role="textbox"
                aria-label="Memory title. Tap to rename."
              />
              <div id="pageDate" />
            </div>
          </div>
          <div className="header-actions" aria-label="Memory actions">
            <button id="openBtn" className="header-action" type="button" aria-label="Open a 3D scan">
              <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 9V5.5h6M19.5 9V5.5h-6M4.5 15v3.5h6M19.5 15v3.5h-6" />
                <path d="M12 8v8m-3-3 3 3 3-3" />
              </svg>
              <span>open</span>
            </button>
            <button id="flipBtn" className="header-action" type="button" aria-label="Flip scan orientation">
              <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 8a7.5 7.5 0 0 1 13.2-2.2L20 8" />
                <path d="M20 4.5V8h-3.5M19 16a7.5 7.5 0 0 1-13.2 2.2L4 16" />
                <path d="M4 19.5V16h3.5" />
              </svg>
              <span>flip</span>
            </button>
          </div>
        </header>
        <div id="help" aria-live="polite" />

        <nav aria-label="Memory tools">
          <button id="floatBtn" className="on" type="button" aria-label="Explore the memory" aria-pressed="true">
            <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5 14 10l6.5 2-6.5 2-2 6.5L10 14l-6.5-2 6.5-2z" />
              <path d="m18.5 3 .6 2.1 2 .6-2 .6-.6 2.1-.6-2.1-2-.6 2-.6z" />
            </svg>
            <span>explore</span>
          </button>
          <button id="noteBtn" type="button" aria-label="Add or edit a note" aria-pressed="false">
            <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5.5c1.7-1.4 4.1-2 7-2s5.3.6 7 2c1.8 1.4 2.7 3.3 2.7 5.5s-.9 4.1-2.7 5.5c-1.7 1.4-4.1 2-7 2H9l-4.5 2 .9-4c-2.1-1.4-3.1-3.3-3.1-5.5S3.2 6.9 5 5.5Z" />
            </svg>
            <span>note</span>
          </button>
          <button id="drawBtn" type="button" aria-label="Draw on the memory" aria-pressed="false">
            <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 16.8-.9 4.1 4.1-.9L19 8.2l-3.2-3.2L4 16.8Z" />
              <path d="m13.9 7 3.2 3.2M4 16.8l3.2 3.2" />
            </svg>
            <span>draw</span>
          </button>
        </nav>
        <input type="file" id="fileInput" accept=".spz,.ply,.splat,.ksplat,.sog" />

        <div id="editor" role="dialog" aria-modal="true" aria-label="Memory note editor">
          <div className="slip" id="slip">
            <svg className="box" aria-hidden="true"><path className="pen" id="slipPath" /></svg>
            <div className="editor-kicker">a note from this place</div>
            <div className="style-pickers" role="group" aria-label="Floating note style">
              <button id="styleThought" className="style-picker on" type="button" aria-pressed="true">
                <svg className="style-icon" viewBox="0 0 28 22" aria-hidden="true">
                  <path d="M8.5 3.5c1.4-1 3.1-1.5 5.4-1.5 4.3 0 7.2 2.3 7.2 5.4s-2.9 5.4-7.2 5.4h-1.5" />
                  <circle cx="8.5" cy="15.8" r="1.2" />
                  <circle cx="6.1" cy="18.5" r="1.6" />
                  <circle cx="3.2" cy="20" r="1.8" />
                </svg>
                <span>thought</span>
              </button>
              <button id="styleLine" className="style-picker" type="button" aria-pressed="false">
                <svg className="style-icon" viewBox="0 0 28 22" aria-hidden="true">
                  <circle cx="3.5" cy="17" r="1.7" />
                  <path d="M5.5 16c5.2-.5 4.2-9.2 10-9.2h8" />
                  <path d="M16.5 17h7" />
                </svg>
                <span>line</span>
              </button>
            </div>
            <div className="tabs" role="tablist" aria-label="Note content">
              <button id="tabWrite" className="on" type="button" role="tab" aria-selected="true">type</button>
              <button id="tabDraw" type="button" role="tab" aria-selected="false">handwrite</button>
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
              <path className="pen" id="padBox" strokeDasharray="1 5" />
              <text id="padGhost" x="130" y="80" textAnchor="middle">write or doodle here</text>
              <g id="padInk" />
            </svg>
            <div className="actions">
              <button id="tearBtn" type="button">remove</button>
              <div>
                <button id="padUndo" type="button" aria-label="Undo handwriting stroke">undo</button>
                <button id="cancelBtn" type="button">cancel</button>
                <button id="saveBtn" type="button">save</button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
