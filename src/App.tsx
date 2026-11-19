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
        {/* a slightly grainy edge for pencil notes */}
        <filter id="grain" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="6" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.8" />
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
          <button id="homeBtn" className="mark" type="button" aria-label="back to all pages">pages</button>
          <button id="openBtn" className="mark" type="button" aria-label="open a 3d scan">open</button>
          <button id="flipBtn" className="mark" type="button" aria-label="flip scan orientation">flip</button>
        </div>
        <nav className="margin bottom-left" aria-label="Memory tools">
          <button id="noteBtn" className="mark tool" type="button" aria-label="Add or edit a note" aria-pressed="false">note</button>
          <button id="drawBtn" className="mark tool" type="button" aria-label="Draw on the memory" aria-pressed="false">draw</button>
          <button id="drawColorBtn" className="mark draw-color" type="button" aria-label="Drawing color: black">ink · black</button>
          <button id="undoBtn" className="mark" type="button" aria-label="Undo last drawing stroke">undo</button>
        </nav>
        <div className="margin bottom-center">
          <button id="floatBtn" className="mark tool on" type="button" aria-label="float through the memory" aria-pressed="true">float</button>
        </div>
        <div className="margin bottom-song" aria-label="page song">
          <button id="songPick" className="mark" type="button" aria-label="choose a song for this page">song</button>
          <button id="songPlay" className="mark" type="button" hidden aria-label="play or pause the page song">play</button>
          <span id="songAsk" hidden>
            remove song? <button id="songYes" className="yes" type="button">yes</button> <button id="songNo" className="no" type="button">no</button>
          </span>
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
          <span id="seal" className="seal" aria-label="page number">
            <svg id="sealRing" viewBox="0 0 22 24" aria-hidden="true" />
            <span id="sealNum">01</span>
          </span>
        </footer>
        {/* the scrapbook: every page as a torn print with its seal, title and date */}
        <section id="home" aria-label="all pages">
          <div className="margin top-left">
            <button id="homeOpenBtn" className="mark" type="button" aria-label="open a 3d scan as a new page">open</button>
          </div>
          <div className="margin bottom-left ink-settings">
            <button id="inkFeelToggle" className="mark" type="button" aria-expanded="false" aria-controls="inkFeelMenu">ink · breathing</button>
            <div id="inkFeelMenu" className="ink-feel-menu" role="group" aria-label="Ink movement" hidden>
              <span className="ink-feel-caption">how the hand-drawn ink moves</span>
              <button id="feelStill" className="mark feel" type="button" aria-pressed="false" title="Keep the ink still">still</button>
              <button id="feelBreathing" className="mark feel on" type="button" aria-pressed="true" title="Let the ink redraw softly">breathing</button>
              <button id="feelSketchy" className="mark feel" type="button" aria-pressed="false" title="Add a playful pencil wobble">sketchy</button>
            </div>
          </div>
          <ol id="covers" />
          <p id="homeEmpty">no pages yet. open a scan to begin one.</p>
        </section>

        <input type="file" id="fileInput" accept=".spz,.ply,.splat,.ksplat,.sog" />
        <input type="file" id="songInput" accept="audio/mpeg,audio/mp4,audio/wav,.mp3,.m4a,.wav" />
        <audio id="pageSong" loop preload="auto" />

        <div id="editor" role="dialog" aria-modal="true" aria-label="Memory note editor">
          <div className="slip" id="slip">
            <svg className="box" id="slipBox" aria-hidden="true" />
            <div className="editor-kicker">a note from this place</div>
            <div className="style-pickers" role="group" aria-label="Note style">
              <button id="stylePencil" className="style-picker mark on" type="button" aria-pressed="true">pencil</button>
              <button id="styleWhisper" className="style-picker mark" type="button" aria-pressed="false">whisper</button>
            </div>
            <div className="note-color-pickers" role="group" aria-label="Note ink color">
              <span>ink</span>
              <button id="noteInkBlack" className="color-picker mark on" type="button" aria-pressed="true">black</button>
              <button id="noteInkWhite" className="color-picker mark" type="button" aria-pressed="false">white</button>
            </div>
            <div className="connector-control">
              <label htmlFor="connectorReach">connector <output id="connectorValue" htmlFor="connectorReach">100%</output></label>
              <input id="connectorReach" type="range" min="0.3" max="2.5" step="0.05" value="1" aria-label="Connector length" />
              <div className="connector-ends" aria-hidden="true"><span>short</span><span>long</span></div>
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
                <button id="smallerBtn" type="button" aria-label="Make the note smaller">smaller</button>
                <button id="largerBtn" type="button" aria-label="Make the note larger">larger</button>
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
