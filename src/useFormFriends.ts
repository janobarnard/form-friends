// The controller: everything that decides what the cast is feeling and where
// it is looking. Lifted out of the sign-in layout it was written for, so the
// component itself stays purely about geometry.
//
// Attach the two refs, wire the handlers into your fields, and the characters
// react: they follow the pointer, turn toward whichever field has focus, look
// away from password fields, sag on an error, celebrate on success, and nod
// off if nobody touches anything for a while.
//
// PERFORMANCE, and why the gaze never touches React state
// -------------------------------------------------------
// The first version of this held the gaze vector in `useState`. Moving the
// pointer therefore ran a React update per animation frame, which re-rendered
// the scene AND everything else under the same component - on a sign-in page,
// the whole form. Measured: one gaze update, one full re-render of the form
// subtree, plus one forced layout read. At 60Hz that is the entire page
// re-rendering sixty times a second so some eyes can move two pixels.
//
// So the gaze is written straight to the DOM as two CSS custom properties on
// the scene container, which inherit down to the characters. React state now
// holds only `mood`, which changes when a person does something rather
// than when a pointer moves.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Mood } from "./FormFriends";

export interface FormFriendsOptions {
  /** ms of no interaction before the cast looks tired. */
  drowsyAfterMs?: number;
  /** ms of no interaction before they fall asleep. Should exceed drowsyAfterMs. */
  sleepAfterMs?: number;
  /** How long the caret keeps their attention after a keystroke or a focus. */
  attentionMs?: number;
}

const DEFAULTS: Required<FormFriendsOptions> = {
  drowsyAfterMs: 18_000,
  sleepAfterMs: 28_000,
  attentionMs: 1_600,
};

/** Resting gaze: very slightly downward, so they are not staring blankly ahead. */
const REST = { x: 0, y: 0.1 };

/**
 * Idle timers are re-armed at most this often. `mousemove` fires at pointer
 * polling rate - 125Hz commonly, up to 1000Hz on a gaming mouse - and each
 * re-arm is two clearTimeout plus two setTimeout. Nothing needs that.
 */
const REARM_EVERY_MS = 500;

export interface FormFriendsController {
  /** Pass to <FormFriends mood={...} /> */
  mood: Mood;
  /**
   * Attach to the element the gaze is measured from AND written to (the scene
   * box). The gaze arrives as inherited CSS custom properties on this element,
   * which is what keeps pointer movement out of React's render path.
   *
   * Typed as React.Ref rather than RefObject on purpose: React 18 and 19
   * disagree about whether a ref's type includes null, and Ref is the one
   * shape both versions accept on a `ref=` attribute without a cast.
   */
  sceneRef: React.Ref<HTMLDivElement>;
  /** Attach to the container whose focus events should steer the gaze. */
  formRef: React.Ref<HTMLElement>;
  /** onChange of any non-password field: the cast keeps its eyes on the caret. */
  watch: () => void;
  /** onFocus of a password field: everyone looks away. */
  shy: () => void;
  /** onBlur of a password field. */
  unshy: () => void;
  /** A show-password toggle changed while a password field is in use. */
  peek: (showing: boolean) => void;
  /** Call when a submit fails. */
  error: () => void;
  /** Call when a submit succeeds. */
  success: () => void;
  /** Point the gaze at a screen coordinate. Writes to the DOM, no re-render. */
  lookAt: (clientX: number, clientY: number) => void;

  /**
   * Ready-made bindings, which handle the fiddly parts for you. Each takes
   * your own handlers and returns them wrapped, so nothing of yours is lost:
   *
   *   <input {...friends.fieldProps({ onChange: e => setEmail(e.target.value) })} />
   *
   * The individual handlers above stay available if you need something these
   * do not cover.
   */
  fieldProps: <T extends FieldOwn>(own?: T) => T & { onChange: ChangeHandler };
  passwordProps: <T extends PasswordOwn>(
    own?: T,
  ) => T & Required<Pick<PasswordOwn, "onFocus" | "onBlur">>;
  /**
   * For the show/hide-password control, which must be a **checkbox** - the
   * handler reads `checked` off the event. If yours is a button or a custom
   * toggle, skip this and call `peek(showing)` yourself, but still put a
   * `data-ff-reveal` attribute on it so the password field's blur knows to
   * leave the pose alone during the hand-off.
   */
  revealProps: <T extends RevealOwn>(
    own?: T,
  ) => T & { onChange: ChangeHandler; "data-ff-reveal": string };
}

type ChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => void;
interface FieldOwn {
  onChange?: ChangeHandler;
}
interface PasswordOwn {
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
}
type RevealOwn = FieldOwn;

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

export function useFormFriends(options: FormFriendsOptions = {}): FormFriendsController {
  const { drowsyAfterMs, sleepAfterMs, attentionMs } = { ...DEFAULTS, ...options };

  const [mood, setMood] = useState<Mood>("idle");
  const [covered, setCovered] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const sceneRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  // While this timestamp is in the future the caret holds their attention and
  // pointer movement is ignored.
  const attentionUntil = useRef(0);
  const raf = useRef(0);
  // Cached scene rect. Reading it inside the pointer handler forced a layout
  // every frame; it only actually changes when the page does.
  const rect = useRef<DOMRect | null>(null);

  // --- gaze: DOM only, never state ---------------------------------------
  const writeGaze = useCallback((x: number, y: number) => {
    const el = sceneRef.current;
    if (!el) return;
    el.style.setProperty("--ff-lx", String(clamp(x)));
    el.style.setProperty("--ff-ly", String(clamp(y)));
  }, []);

  const lookAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = sceneRef.current;
      if (!el) return;
      if (!rect.current) rect.current = el.getBoundingClientRect();
      const r = rect.current;
      if (!r.width || !r.height) return;
      writeGaze(
        (clientX - (r.left + r.width / 2)) / (r.width * 0.7),
        (clientY - (r.top + r.height / 2)) / (r.height * 0.7),
      );
    },
    [writeGaze],
  );

  // Resting gaze on mount, and drop the cached rect whenever the page moves
  // under us. Scroll is passive and only invalidates - no layout read here.
  //
  // Window resize and scroll are not enough on their own: the scene also moves
  // when something ELSE on the page changes size - an error banner appearing
  // above it, a mobile keyboard opening, a web font landing and reflowing. Miss
  // those and the cached rect is wrong for as long as nobody scrolls, which
  // shows up as a gaze that is quietly aimed at the wrong place. A
  // ResizeObserver on the element catches all of it.
  useEffect(() => {
    writeGaze(REST.x, REST.y);
    const invalidate = () => {
      rect.current = null;
    };
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, { passive: true });

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(invalidate);
      if (sceneRef.current) ro.observe(sceneRef.current);
      // The scene moves when its offset parent reflows, not only when it
      // resizes itself, so watch that too where there is one.
      const parent = sceneRef.current?.offsetParent;
      if (parent instanceof Element) ro.observe(parent);
    }

    return () => {
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate);
      ro?.disconnect();
    };
  }, [writeGaze]);

  // --- moods --------------------------------------------------------------
  const watch = useCallback(() => {
    setCovered(false);
    setMood("look");
    attentionUntil.current = Date.now() + attentionMs;
  }, [attentionMs]);

  const shy = useCallback(() => {
    setCovered(true);
    setMood("shy");
  }, []);

  const unshy = useCallback(() => {
    setCovered(false);
    setMood("idle");
  }, []);

  const peek = useCallback(
    (showing: boolean) => setMood(showing ? "peek" : covered ? "shy" : "idle"),
    [covered],
  );

  const error = useCallback(() => {
    setMood("error");
    attentionUntil.current = Date.now() + 2_500; // hold the look-away
    writeGaze(-0.55, 0.9); // eyes drop down and away
  }, [writeGaze]);

  const success = useCallback(() => setMood("success"), []);

  // --- bindings -----------------------------------------------------------
  // Two details here are easy to get wrong by hand, and both were learned on
  // a real sign-in page:
  //
  //  1. Focusing a password field that is already REVEALED should go to the
  //     peek pose, not the shy one. Looking away from a password everybody
  //     can already see reads as a bug.
  //  2. Clicking the show/hide control blurs the password field first. Left
  //     alone, that flashes back to pointer-following for one frame in the
  //     middle of the hand-off. So blur is ignored when focus is moving to
  //     something carrying data-ff-reveal, which revealProps adds for you.
  const fieldProps = <T extends FieldOwn>(own?: T) =>
    ({
      ...(own as T),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        own?.onChange?.(e);
        watch();
      },
    }) as T & { onChange: ChangeHandler };

  const passwordProps = <T extends PasswordOwn>(own?: T) =>
    ({
      ...(own as T),
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        own?.onFocus?.(e);
        if (revealed) peek(true);
        else shy();
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        own?.onBlur?.(e);
        const to = e.relatedTarget as HTMLElement | null;
        if (to?.closest("[data-ff-reveal]")) return;
        unshy();
      },
    }) as T & Required<Pick<PasswordOwn, "onFocus" | "onBlur">>;

  const revealProps = <T extends RevealOwn>(own?: T) =>
    ({
      ...(own as T),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        own?.onChange?.(e);
        setRevealed(e.target.checked);
        peek(e.target.checked);
      },
      "data-ff-reveal": "",
    }) as T & { onChange: ChangeHandler; "data-ff-reveal": string };

  // --- follow the pointer -------------------------------------------------
  // One rAF-gated DOM write per frame at most, and nothing here sets state.
  useEffect(() => {
    if (mood !== "idle" && mood !== "look") return;
    const onMove = (e: MouseEvent) => {
      if (Date.now() < attentionUntil.current) return;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => lookAt(e.clientX, e.clientY));
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf.current);
    };
  }, [mood, lookAt]);

  // --- nodding off --------------------------------------------------------
  // The re-arm is throttled: `mousemove` can fire a thousand times a second
  // and every one of these was clearing and setting two timers.
  useEffect(() => {
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    let lastArm = 0;
    const arm = () => {
      clearTimeout(t1);
      clearTimeout(t2);
      t1 = setTimeout(() => setMood((e) => (e === "idle" || e === "look" ? "drowsy" : e)), drowsyAfterMs);
      t2 = setTimeout(() => setMood((e) => (e === "drowsy" ? "sleep" : e)), sleepAfterMs);
      lastArm = Date.now();
    };
    const onActivity = () => {
      setMood((e) => (e === "sleep" || e === "drowsy" ? "idle" : e));
      if (Date.now() - lastArm < REARM_EVERY_MS) return;
      arm();
    };
    const events = ["mousemove", "keydown", "pointerdown", "focusin"] as const;
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    arm();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [drowsyAfterMs, sleepAfterMs]);

  // --- stop animating in a hidden tab -------------------------------------
  // The ambient loops cost the same whether anyone is looking or not.
  useEffect(() => {
    const sync = () => {
      const el = sceneRef.current;
      if (!el) return;
      if (document.visibilityState === "hidden") el.setAttribute("data-ff-paused", "");
      else el.removeAttribute("data-ff-paused");
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // --- steer on focus -----------------------------------------------------
  // Focusing any non-password field turns every head toward that field's REAL
  // position - no guessed geometry - and puts the cast in the `look` mood.
  // That is also how they recover from `error` and `success`: those hold
  // until the person touches the form again. Password fields are the shy
  // pose's job (see passwordProps).
  useEffect(() => {
    const col = formRef.current;
    if (!col) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      // The show/hide control is an input too. Focus landing on it is the
      // hand-off passwordProps.onBlur just let through - leave the pose alone.
      if (el instanceof Element && el.closest("[data-ff-reveal]")) return;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
      if (el instanceof HTMLInputElement && el.type === "password") return;
      const r = el.getBoundingClientRect();
      attentionUntil.current = Date.now() + attentionMs;
      lookAt(r.left + r.width * 0.25, r.top + r.height / 2);
      setMood("look");
    };
    const onFocusOut = () => {
      attentionUntil.current = 0; // the pointer takes over again
      setMood((m) => (m === "look" ? "idle" : m));
    };
    col.addEventListener("focusin", onFocusIn);
    col.addEventListener("focusout", onFocusOut);
    return () => {
      col.removeEventListener("focusin", onFocusIn);
      col.removeEventListener("focusout", onFocusOut);
    };
  }, [lookAt, attentionMs]);

  return {
    mood,
    sceneRef,
    formRef,
    watch,
    shy,
    unshy,
    peek,
    error,
    success,
    lookAt,
    fieldProps,
    passwordProps,
    revealProps,
  };
}
