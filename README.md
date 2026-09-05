# State Editor

A lightweight, local-first visual editor for small XState v6 state machines. It runs entirely in the browser and exports portable MachineJSON without requiring a server or account.

[Open the hosted editor](https://max-villafranca.github.io/state-editor/)

## What it supports

- Flat state machines and recursively nested compound parent states, each with an initial child
- Event-driven transitions
- Entry, exit, and transition actions with optional JSON parameters
- State and machine descriptions, tags, and metadata
- Visual node creation, duplication, renaming, positioning, and multi-selection
- Graph analysis for paths, node connections, and cycles with entry and exit context
- Manual simulation, undo/redo, minimap control, and light/dark themes
- Silent local recovery between browser sessions
- Project files that retain editor layout (`.se.json`)
- Clean XState MachineJSON exports (`.json`)

The editor intentionally omits parallel states, guards, actors, delayed transitions, eventless transitions, and executable inline code. Select sibling states at any depth and use **Create parent** in Properties to wrap them in a parent. **Remove from parent** moves a state up one level. Deleting a parent keeps its children and their transitions.

Parent states are the supported form of nesting: child transitions are edited in place, parent transitions are inherited by active children, and cross-boundary targets export with stable XState ids.

## Run locally

[Bun](https://bun.sh/) is recommended.

```bash
bun install
bun run dev
```

Then open the local address printed by Vite.

## Files and export

- **Save / Save As** writes a State Editor project file. It contains the machine plus node positions, viewport, and selection.
- **Export JSON** writes only the XState-compatible machine definition for use in another application.
- **Open** accepts either format. MachineJSON imports receive a fresh editor layout.

Local browser storage is used only as automatic recovery; it is not a replacement for saving a project file.

## Main controls

- Double-click empty canvas or use **Add state** to create a state.
- Drag from a state handle to another state to create a transition.
- Drag empty canvas to select fully enclosed nodes. Hold Shift while dragging inside a parent frame; a fully enclosed frame is selected as one unit.
- Middle-drag or hold Space while dragging to pan.
- Use `Ctrl/Cmd+Z` to undo and `Ctrl/Cmd+Shift+Z` to redo.
- Select a state or transition to edit its details in the inspector.
- Open **Analysis** to compare paths, inspect incoming or outgoing connections, and highlight cycle structure on the canvas.

## Compatibility

The supported export surface is contract-tested against the pinned XState v6 package. XState v6 is currently an alpha dependency, so upgrades should be deliberate and accompanied by the full test suite.

## Quality checks

```bash
bun run test
bun run lint
bun run build
```

Unit tests cover serialization, validation, XState runtime compatibility, and history behavior. Browser tests cover the main create, edit, save, export, simulation, selection, duplication, and recovery workflows.
