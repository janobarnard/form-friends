// The demo page. Nothing in this file is part of the library - but the form
// half of it is the shortest complete example of wiring one up, so it doubles
// as the reference integration. The controls above and below the scene exist
// to show every mood and restyle on demand.
import { useEffect, useState } from "react";
import { FormFriends, useFormFriends, type Mood } from "../src";

const REPO = "https://github.com/janobarnard/form-friends";

const MOODS: Mood[] = ["idle", "look", "shy", "peek", "error", "success", "drowsy", "sleep"];

type Theme = "system" | "light" | "dark";

// Palettes are nothing but the five --ff-* variables; a host restyles the cast
// the same way, from any stylesheet above the scene.
const PALETTES: Record<string, Record<string, string> | null> = {
  pastel: null, // the stylesheet defaults
  sunset: {
    "--ff-char-1": "#f5b8a0",
    "--ff-char-2": "#f6cf8f",
    "--ff-char-3": "#ec9fbf",
    "--ff-char-4": "#c9a9ea",
    "--ff-ink": "#2b1a2f",
  },
  ocean: {
    "--ff-char-1": "#9dd6ea",
    "--ff-char-2": "#a9c6ff",
    "--ff-char-3": "#86d9c9",
    "--ff-char-4": "#c5dcf5",
    "--ff-ink": "#0f2233",
  },
  mono: {
    "--ff-char-1": "#d8d9e3",
    "--ff-char-2": "#bcbfcc",
    "--ff-char-3": "#a3a6b8",
    "--ff-char-4": "#eceef5",
    "--ff-ink": "#14161c",
  },
};

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("ff-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* private mode, blocked storage - fall through */
  }
  return "system";
}

export default function Demo() {
  const friends = useFormFriends();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [note, setNote] = useState("");

  // Demo-only controls. `override` pins a mood so every pose can be shown on
  // demand; "live" hands control back to the hook.
  const [override, setOverride] = useState<Mood | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [palette, setPalette] = useState<keyof typeof PALETTES>("pastel");

  // The stylesheet's dark rules key off data-theme on <html>, or the system
  // preference when the attribute is absent - so that is all a toggle does.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem("ff-theme");
      else localStorage.setItem("ff-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setOverride(null);
    // "correct" is the password that works, so both endings are reachable.
    if (password === "correct") {
      friends.success();
      setNote("Signed in. Click a field to wake them back up.");
    } else {
      friends.error();
      setNote('Wrong password. The one that works is "correct".');
    }
  }

  const mood = override ?? friends.mood;

  return (
    // The palette goes on the page root, so the sign-in button and the logo
    // pick it up too - exactly as a host app would set it on :root.
    <div className="demo" style={(PALETTES[palette] ?? undefined) as React.CSSProperties | undefined}>
      <header className="demo__bar">
        <a className="demo__brand" href={REPO}>
          <span className="demo__logo" aria-hidden="true" />
          Form Friends
        </a>
        <nav className="demo__controls" aria-label="Demo controls">
          <div className="demo__seg" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="demo__seg" role="group" aria-label="Palette">
            {Object.keys(PALETTES).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={palette === p}
                onClick={() => setPalette(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <a className="demo__gh" href={REPO}>
            GitHub
          </a>
        </nav>
      </header>

      <div className="demo__body">
        <section className="demo__panel" aria-label="The characters">
          <div className="ff-stage" ref={friends.sceneRef}>
            <FormFriends mood={mood} />
          </div>

          <div className="demo__moods" role="group" aria-label="Pin a mood">
            <button
              type="button"
              className="demo__live"
              aria-pressed={override === null}
              onClick={() => setOverride(null)}
            >
              live
            </button>
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={override === m}
                onClick={() => setOverride(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="demo__mood">
            mood: <strong>{mood}</strong>
            {override && <span> (pinned)</span>}
          </p>
        </section>

        {/* --- the reference integration starts here --- */}
        <main className="demo__form" ref={friends.formRef}>
          <h1>Welcome back</h1>
          <p className="demo__hint">
            Move the pointer. Click into a field. Type a password, then reveal it.
            Get it wrong. Then leave the page alone for half a minute.
          </p>

          <form onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                value={email}
                {...friends.fieldProps({
                  onChange: (e) => setEmail(e.target.value),
                })}
              />
            </label>

            <label>
              Password
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="try: correct"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...friends.passwordProps()}
              />
            </label>

            <label className="demo__check">
              <input
                type="checkbox"
                checked={showPassword}
                {...friends.revealProps({
                  onChange: (e) => setShowPassword(e.target.checked),
                })}
              />
              Show password
            </label>

            <button type="submit">Sign in</button>
          </form>

          {note && <p className="demo__note">{note}</p>}
        </main>
        {/* --- reference integration ends --- */}
      </div>

      <footer className="demo__foot">
        Three files, React and CSS, no dependencies.{" "}
        <a href={REPO}>Copy them from the repo</a> - MIT licensed.
      </footer>
    </div>
  );
}
