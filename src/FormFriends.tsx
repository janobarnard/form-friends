import { useEffect, useId, useRef, useState } from "react";

// Four geometric characters in soft pastels - a little crowd that reacts to
// the form beside them. Expressiveness comes from three layers working
// together:
//   1. whole FACES slide around the body toward the gaze target (clipped to
//      the body silhouette), with pupils adding parallax on top;
//   2. per-character reactions – each looks away its own way on passwords,
//      two sneak peeks back, blinks run on separate clocks;
//   3. body language – everyone leans toward the field they watch, droops
//      (the triangle crumples) on an error, hops on success.
// Gaze + pose plumbing lives in form-friends.css ([data-mood] + CSS
// custom properties); this file owns geometry and the per-character state
// matrices.
// Purely decorative – aria-hidden; motion respects prefers-reduced-motion.

export type Mood = "idle" | "look" | "shy" | "peek" | "error" | "success" | "sleep" | "drowsy";

export interface FormFriendsProps {
  mood: Mood;
  /**
   * Gaze vector, each axis -1..1 (x: left→right, y: up→down).
   *
   * OPTIONAL, and normally omitted. useFormFriends writes the gaze straight
   * to the DOM as CSS custom properties on the scene container, because
   * routing pointer movement through React re-rendered the whole page sixty
   * times a second. Pass this only if you are driving the gaze yourself
   * without the hook - and if you do, know that it costs a render per change.
   */
  look?: { x: number; y: number };
  /**
   * Optional name per character, in CHARS order, shown as a chip on hover.
   * Omit it (the default) and the cast stays nameless - which is what you
   * want unless the names mean something in your product.
   */
  labels?: readonly string[];
}

// The cast, and the temperament each one plays:
//   1 the triangle – big and central, a little aloof
//   2 the wall – upright, would never peek at a password
//   3 the dome – steady, unshakeable
//   4 the coin – small, quick, can't resist a sneak peek
// Colours come from CSS custom properties so a host app can restyle the
// whole cast without touching this file. Adding a character means an entry
// in CHARS plus its per-character rows in the stylesheet (face travel,
// lean, look-away direction, blink clock).
// Defaults are the fallback half of each var(), so the component works with
// no stylesheet variables set at all.
const CHAR_1 = "var(--ff-char-1, #b7c4ec)"; // periwinkle
const CHAR_2 = "var(--ff-char-2, #d3b6e0)"; // lilac
const CHAR_3 = "var(--ff-char-3, #e3b7cd)"; // rose
const CHAR_4 = "var(--ff-char-4, #a9d6cf)"; // mint
const INK = "var(--ff-ink, #1c2030)"; // pupils, mouths – dark on every pastel

type CharId = 1 | 2 | 3 | 4;
type EyeState = "open" | "closed" | "half";
type MouthKind = "smile" | "o" | "flat" | "frown" | "squiggle" | "open";

// How tired each character currently is. Falling asleep is staggered by
// REAL timers in the component (not CSS delays – Chrome proved unreliable
// at restarting delayed animations on combined class+attribute flips), so
// each stage change lands in its own style recalc and transitions fire.
type SleepStage = "awake" | "tired" | "asleep";

// Per-character offsets: tiredness and sleep spread through the group.
const TIRED_AT: Record<CharId, number> = { 1: 200, 2: 1500, 3: 2700, 4: 3600 };
const ASLEEP_AT: Record<CharId, number> = { 1: 300, 2: 1600, 3: 2600, 4: 3800 };

// Eyes stay OPEN in the shy pose: everyone pointedly looks away instead
// (directions in the stylesheet) and the coin sneaks the occasional dart back.
function eyeState(char: CharId, m: Mood, stage: SleepStage): EyeState {
  if (m === "sleep" || m === "drowsy") {
    return stage === "asleep" ? "closed" : stage === "tired" ? "half" : "open";
  }
  if (m === "success") return "closed";
  if (m === "error") return char === 3 ? "half" : "open"; // the dome: tired-sad lids
  return "open";
}

function mouthKind(char: CharId, m: Mood, stage: SleepStage): MouthKind {
  if (m === "success") return "open";
  if (m === "sleep" || m === "drowsy") {
    if (stage === "awake") return "smile";
    return char === 3 && stage === "asleep" ? "o" : "flat"; // one gentle snorer
  }
  if (m === "error") return ({ 1: "frown", 2: "flat", 3: "frown", 4: "squiggle" } as const)[char];
  if (m === "shy" || m === "peek") return char === 1 ? "flat" : "o";
  return "smile";
}

function Mouth({ cx, cy, kind, wide = 1 }: { cx: number; cy: number; kind: MouthKind; wide?: number }) {
  const w = 7 * wide;
  const stroke = { fill: "none" as const, stroke: INK, strokeWidth: 2.6, strokeLinecap: "round" as const };
  switch (kind) {
    case "frown":
      return <path d={`M ${cx - w} ${cy + 4} Q ${cx} ${cy - 5} ${cx + w} ${cy + 4}`} {...stroke} />;
    case "squiggle":
      return (
        <path
          d={`M ${cx - w} ${cy} q ${w / 3} -4 ${(w * 2) / 3} 0 t ${(w * 2) / 3} 0 t ${(w * 2) / 3} 0`}
          {...stroke}
        />
      );
    case "flat":
      return <path d={`M ${cx - w + 1} ${cy} L ${cx + w - 1} ${cy}`} {...stroke} />;
    case "o":
      return <circle cx={cx} cy={cy + 1} r={3} fill={INK} />;
    case "open":
      return <path d={`M ${cx - w} ${cy - 2} Q ${cx} ${cy + 10} ${cx + w} ${cy - 2} Z`} fill={INK} />;
    default:
      return <path d={`M ${cx - w} ${cy} Q ${cx} ${cy + 6} ${cx + w} ${cy}`} {...stroke} />;
  }
}

interface EyeProps {
  id: string;
  cx: number;
  cy: number;
  body: string;
  state: EyeState;
}

function Eye({ id, cx, cy, body, state }: EyeProps) {
  const r = 9;
  return (
    <g>
      <clipPath id={id}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <circle cx={cx} cy={cy} r={r} fill="#ffffff" />
        <circle className="ff-pupil" cx={cx} cy={cy} r={4.4} fill={INK} />
        {/* the lid – body-coloured, parked above the eye, slides down */}
        <rect
          className={`ff-lid ff-lid--${state}`}
          x={cx - r - 1}
          y={cy - r * 3 - 1}
          width={r * 2 + 2}
          height={r * 2 + 2}
          fill={body}
        />
      </g>
      {/* relaxed/happy closed-eye line over a fully closed lid */}
      {state === "closed" && (
        <path
          className="ff-closedline"
          d={`M ${cx - 6} ${cy + 1} Q ${cx} ${cy + 6} ${cx + 6} ${cy + 1}`}
          fill="none"
          stroke={INK}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

function Brows({ lx, rx, y }: { lx: number; rx: number; y: number }) {
  // SAD brows – inner ends raised (inner-down would read angry, not upset).
  // Visible only on error (see the stylesheet).
  return (
    <g className="ff-brows" stroke={INK} strokeWidth={2.4} strokeLinecap="round">
      <path d={`M ${lx - 6} ${y + 4} L ${lx + 6} ${y}`} />
      <path d={`M ${rx + 6} ${y + 4} L ${rx - 6} ${y}`} />
    </g>
  );
}

interface CharDef {
  id: CharId;
  /** anchor for the optional hover chip: centred at x, chip sits above y */
  tag: { x: number; y: number };
  body: string; // path d
  fill: string;
  eyes: { lx: number; rx: number; y: number };
  mouth: { cx: number; cy: number; wide?: number };
}

const CHARS: CharDef[] = [
  // the triangle: big, central, unmissable
  {
    id: 1,
    tag: { x: 220, y: 30 },
    body: "M 220 36 L 330 252 L 110 252 Z",
    fill: CHAR_1,
    eyes: { lx: 198, rx: 242, y: 158 },
    mouth: { cx: 220, cy: 190, wide: 1.2 },
  },
  // the wall (back left): tall, upright, incorruptible
  {
    id: 2,
    tag: { x: 93, y: 112 },
    body: "M 67 118 h 52 a 7 7 0 0 1 7 7 v 127 h -66 V 125 a 7 7 0 0 1 7 -7 Z",
    fill: CHAR_2,
    eyes: { lx: 78, rx: 108, y: 160 },
    mouth: { cx: 93, cy: 186, wide: 0.8 },
  },
  // the dome (front right): a solid, unshakeable base
  {
    id: 3,
    tag: { x: 334, y: 192 },
    body: "M 268 264 A 66 66 0 0 1 400 264 Z",
    fill: CHAR_3,
    eyes: { lx: 315, rx: 353, y: 228 },
    mouth: { cx: 334, cy: 250, wide: 1 },
  },
  // the coin (front left): small, quick, always counting
  {
    id: 4,
    tag: { x: 160, y: 206 },
    body: "M 160 212 a 29 29 0 1 1 -0.01 0 Z",
    fill: CHAR_4,
    eyes: { lx: 151, rx: 170, y: 237 },
    mouth: { cx: 160, cy: 256, wide: 0.7 },
  },
];

export default function FormFriends({ mood, look, labels }: FormFriendsProps) {
  // Clip-path ids are document-global, so two scenes on one page would clip
  // each other. useId makes them unique; the sanitising keeps url(#...) refs
  // free of the ":" (React 18) and "«»" (React 19) characters useId emits.
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");

  // Staggered nodding-off, driven by real timers (see SleepStage note).
  const [stages, setStages] = useState<Record<CharId, SleepStage>>({
    1: "awake",
    2: "awake",
    3: "awake",
    4: "awake",
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (mood === "drowsy") {
      ([1, 2, 3, 4] as CharId[]).forEach((c) =>
        timers.current.push(setTimeout(() => setStages((s) => ({ ...s, [c]: "tired" })), TIRED_AT[c])),
      );
    } else if (mood === "sleep") {
      // entered from drowsy – everyone is tired; drop off one by one (the
      // resets ride the same timer rail: no synchronous setState in effects)
      timers.current.push(
        setTimeout(() => setStages({ 1: "tired", 2: "tired", 3: "tired", 4: "tired" }), 0),
      );
      ([1, 2, 3, 4] as CharId[]).forEach((c) =>
        timers.current.push(setTimeout(() => setStages((s) => ({ ...s, [c]: "asleep" })), ASLEEP_AT[c])),
      );
    } else {
      timers.current.push(
        setTimeout(() => setStages({ 1: "awake", 2: "awake", 3: "awake", 4: "awake" }), 0),
      );
    }
    return () => timers.current.forEach(clearTimeout);
  }, [mood]);
  const allAsleep = ([1, 2, 3, 4] as CharId[]).every((c) => stages[c] === "asleep");

  return (
    <svg
      className="ff-scene"
      data-mood={mood}
      viewBox="0 0 440 320"
      role="presentation"
      aria-hidden="true"
      /* Only set inline when a caller drives the gaze itself; the hook
         writes these onto the container instead, and they inherit. */
      style={
        look
          ? ({
              "--ff-lx": Math.max(-1, Math.min(1, look.x)),
              "--ff-ly": Math.max(-1, Math.min(1, look.y)),
            } as React.CSSProperties)
          : undefined
      }
    >
      <ellipse cx={225} cy={272} rx={180} ry={13} className="ff-ground" />
      {/* zzz over the tallest character once the whole cast is under */}
      {mood === "sleep" && allAsleep && (
        <g className="ff-zzz" fill={INK} fontFamily="ui-monospace, Menlo, monospace">
          <text className="ff-z ff-z-1" x={265} y={70} fontSize={15}>
            z
          </text>
          <text className="ff-z ff-z-2" x={283} y={52} fontSize={20}>
            z
          </text>
          <text className="ff-z ff-z-3" x={305} y={32} fontSize={26}>
            z
          </text>
        </g>
      )}
      {CHARS.map((c) => (
        <g key={c.id} className={`ff-char ff-char-${c.id} ff-stage-${stages[c.id]}`}>
          {/* body + face lean together toward the gaze target, so the face
              clip stays aligned while the whole character tips over */}
          <g className="ff-lean">
            <path className="ff-body" d={c.body} fill={c.fill} />
            <clipPath id={`${uid}-b${c.id}`}>
              <path d={c.body} />
            </clipPath>
            {/* the clip lives on an UNTRANSFORMED wrapper: a clip attached to
                the moving face would travel with it and expose features below
                the body silhouette (mouths floated free in dark mode). Inside:
                face follows the gaze (var transform), and the drift layer
                carries autonomous micro-motion (glances, sneak-peeks) so the
                two compose instead of fighting over one transform. */}
            <g clipPath={`url(#${uid}-b${c.id})`}>
            <g className="ff-face">
              <g className="ff-drift">
                <Brows lx={c.eyes.lx} rx={c.eyes.rx} y={c.eyes.y - 15} />
                <Eye
                  id={`${uid}-e${c.id}l`}
                  cx={c.eyes.lx}
                  cy={c.eyes.y}
                  body={c.fill}
                  state={eyeState(c.id, mood, stages[c.id])}
                />
                <Eye
                  id={`${uid}-e${c.id}r`}
                  cx={c.eyes.rx}
                  cy={c.eyes.y}
                  body={c.fill}
                  state={eyeState(c.id, mood, stages[c.id])}
                />
                <g className="ff-mouth">
                  <Mouth cx={c.mouth.cx} cy={c.mouth.cy} kind={mouthKind(c.id, mood, stages[c.id])} wide={c.mouth.wide} />
                </g>
              </g>
            </g>
            </g>
          </g>
          {labels?.[c.id - 1] && (
            /* hover chip - a quiet introduction, one character at a time */
            <g className="ff-tag">
              <rect
                x={c.tag.x - labels[c.id - 1].length * 3.6 - 8}
                y={c.tag.y - 17}
                width={labels[c.id - 1].length * 7.2 + 16}
                height={20}
                rx={10}
              />
              <text x={c.tag.x} y={c.tag.y - 3} textAnchor="middle">
                {labels[c.id - 1]}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}
