import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Serves and builds the demo page. There is no separate library build: the
// library is three files under src/, meant to be copied into your project.
// See NOTES.md.
//
// `npm run build:pages` builds with the GitHub Pages base path.
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/form-friends/" : "/",
  plugins: [react()],
}));
