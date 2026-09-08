# Implementation notes

For anyone reading the source to learn from it, or changing it. The README
covers how to use the thing; this covers why it is built the way it is, what
has been checked, and what has not.

## Things worth keeping, not "cleaning up"

Each of these is load-bearing and looks like cruft.

- **The clip path lives on an untransformed wrapper.** Moving it onto the face
  makes the clip travel with the face and exposes eyes and mouths outside the
  body outline. There is a comment in `FormFriends.tsx` saying so.
- **The sleep stagger runs on real `setTimeout` calls, not CSS delays.**
  Browsers were unreliable at restarting delayed animations when a class and
  an attribute flip in the same render. Each stage change has to land in its
  own style recalculation. Infinite loops resume fine; only finite delayed
  animations misbehaved.
- **`face` and `drift` are two separate transform layers.** One follows the
  gaze, one carries autonomous micro-motion (glances, sneak peeks, the sad
  rock). Collapsing them into one transform makes them fight.
- **Reduced motion deliberately keeps blinking and the mouth twitch.** That is
  a judgement call, not an oversight - see the comment at the bottom of the
  stylesheet.
- **The controller never receives a field's value.** The password bindings
  listen for focus and blur only. Keep it that way.
- **The gaze is written to the DOM, not held in state.** See Performance in
  the README. Putting it back in `useState` re-renders everything under the
  hook's component once per animation frame.
- **Clip-path ids are prefixed with `useId`.** SVG ids are document-global, so
  two scenes on one page would otherwise clip each other's faces. The prefix
  is sanitised because `useId` emits `:` (React 18) or `«»` (React 19), which
  `url(#...)` references handle inconsistently.
- **`sceneRef` and `formRef` are typed `React.Ref`, not `RefObject`.** React 18
  and 19 disagree about whether a ref's type includes `null`, and `Ref` is the
  one shape both accept on a `ref=` attribute without a cast. The cost is that
  a consumer cannot read `.current` off them.

## Adding a character

Four is hard-coded in a few places. A fifth means:

- an entry in `CHARS` in `FormFriends.tsx` (body path, fill, eye and mouth
  positions, chip anchor);
- widening the `CharId` union and adding its `TIRED_AT` / `ASLEEP_AT` offsets;
- per-character rows in the stylesheet: face travel (`--fm`, `--fmy`), lean
  (`--bl`), look-away direction for `shy`/`peek`, idle glance vector, blink
  clock, bob / shake / hop delays;
- a `--ff-char-5` colour.

## Adding a mood

A mood is a value of `Mood`, a row in `eyeState` / `mouthKind` in the
component, and `[data-mood="..."]` rules in the stylesheet. If it should be
reachable from the hook, add a setter there too.

## What has been checked

Typechecked (`tsc --noEmit`), built (`vite build`) and driven in a browser.
Console has no errors or React warnings.

Every mood was verified by reading `data-mood` off the scene after driving
the form, rather than by eye:

| Checked | Result |
|---|---|
| initial | `idle` |
| password focused | `shy` |
| password revealed | `peek` |
| password re-focused **while revealed** | `peek`, not `shy` |
| focus moved to an ordinary field | `look` |
| ordinary field blurred | `idle` |
| ordinary field focused after `error` or `success` | `look` (recovers) |
| blur handing off to the reveal toggle (click) | pose kept, no flash |
| Tab from password to the reveal toggle | pose kept |
| blur to any other field | pose resets |
| failed submit | `error` |
| correct submit | `success` |
| left idle | falls asleep, eyes shut, `z`s float |
| light / dark / system theme | all three resolve; the ground shadow, chip and `z`s change with them |
| gaze on field focus | moves off the resting value, and the faces inherit it |
| gaze written to React | nothing: the `<svg>` carries no inline style at all |
| tab hidden | `data-ff-paused` lands on the container |
| every mood pinned from the demo buttons | `data-mood` matches |
| two scenes on one page | clip ids differ |
| pointer follow, foreground window | faces and pupils track the pointer smoothly |

Performance was measured before and after moving the gaze out of React
state: 100 gaze updates cause zero renders and one layout read.

### Checking it yourself in a hidden tab

Some of the above cannot be seen in a tab the browser considers hidden, which
is what most headless drivers give you:

- `requestAnimationFrame` is suspended, so the pointer-follow path does not
  run end to end.
- `ResizeObserver` does not deliver.
- CSS transitions do not advance, so computed `transform` values are frozen at
  their start. Read the inherited custom property instead; it does change.
- `element.focus()` fires no focus event when the document itself is not
  focused. Dispatch a bubbling `FocusEvent('focusin')` instead - React listens
  for that.

## Known gaps

- **The rect invalidation on layout change is lightly tested.** A
  `ResizeObserver` watches the scene element and its `offsetParent`, because
  window resize and scroll alone miss the scene *moving* - an error banner
  appearing above it, a mobile keyboard, a web font landing. Without it a
  stale rect aims the gaze at the wrong place. To check: cache a rect by
  focusing a field, change the scene container's width, focus again, and
  confirm the gaze vector differs.
- **The observer binds the element it saw on mount.** If the scene is
  conditionally rendered and remounts, the observer still watches the old node.
  Nothing in this repo does that; a host might.
- **A consumer running the `react-hooks/refs` lint rule will get an error.**
  `sceneRef` and `formRef` are returned as ref objects, and the rule flags
  `ref={friends.sceneRef}` even though attaching it is legitimate. The fix is
  to hold the element in an internal ref and return a **callback ref**
  instead, destructured before use (`const { attachScene } = friends`, then
  `ref={attachScene}`). Doing that would also remove the React 18/19 typing
  awkwardness above.
- **No library build.** `vite.config.ts` only serves the demo. The intended
  path is to copy the three files; a proper build with type declarations would
  be needed to publish to npm. `package.json` has `private: true` until then.
- **No tests.** The checks in the table above were run by hand in a browser
  console. They should become real tests, since they are exactly the things a
  refactor would break. Also worth covering: the reduced-motion rules, and the
  sleep stagger firing in order.
- **`drowsy` has only been seen in passing.** The full idle sequence works -
  all four asleep with the `z`s floating - but the intermediate drowsy stage
  at 18s has not been observed on its own.
- **The dome's "tired-sad lids" on error are cosmetic only.** `eyeState`
  returns `half` for the dome, but `[data-mood="error"] .ff-lid` out-specifies
  `.ff-lid--half`, so it gets the same 6px lid as everyone else. Harmless;
  fix by adding an error-specific `.ff-lid--half` rule if you want the
  difference back.
