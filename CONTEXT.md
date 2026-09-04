# State Machine Editing

This context defines the statechart concepts represented by the editor and keeps visual language aligned with machine semantics.

## Language

**Atomic state**:
A state with no child states.
_Avoid_: Leaf node, regular state

**Compound parent state**:
A state that contains mutually exclusive child states and names one initial child state.
Its rendered boundary on the canvas may be called a frame.
_Avoid_: Visual group, container

**Initial state**:
The default state entered when its containing state starts. Initial status is scoped to one parent and does not prohibit incoming transitions.
_Avoid_: Start-only state, input state

**Initial child state**:
The child entered by default whenever its compound parent state is entered.
_Avoid_: Second starting point

**Final state**:
A state that completes its containing state and therefore has no outgoing transitions.
_Avoid_: Output state, end of every machine

**Transition**:
A directed response to an event, owned by its source state and targeting another state.
_Avoid_: Connection, link, wire
