import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Separate config for the playground/demo *site*, as opposed to vite.config.ts
// which builds the published *library* (build.lib, entry src/index.ts). A single
// Vite config cannot do both: lib mode produces an unbundled ES module meant to be
// imported by a consumer's own bundler, while the demo is a self-contained static
// site with no bundler of its own downstream. The two builds must externalise
// dependencies differently (see below), so they cannot share one `build` block.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },

  // GitHub Pages serves project sites from https://<user>.github.io/<repo>/, not
  // from the domain root. Every asset URL Vite emits is resolved against `base`,
  // so an incorrect value here is invisible at `vite preview` (served from `/`)
  // and only breaks once deployed: a blank page with every script/style/font 404ing
  // against the wrong path. This must match the repo name exactly.
  base: "/data-table/",

  build: {
    // Build into its own directory, not `dist/` — that's the published npm
    // package output (see package.json "files") and must not be polluted
    // with demo HTML/JS.
    outDir: "demo-dist",
    // Unlike vite.config.ts, do NOT externalise React/TanStack here. The library
    // build externalises them because a consuming app supplies its own copies
    // (they're peerDependencies); the demo site has no such consumer and no
    // import map, so its dependencies must be bundled in or the deployed page
    // fails at runtime with unresolved bare specifiers.
  },
})
