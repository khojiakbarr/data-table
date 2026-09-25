import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"
import { sourceAliases } from "./vite.shared.ts"

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src"],
      exclude: ["src/demo", "src/docs", "**/*.test.*", "src/test-setup.ts", "src/vite-env.d.ts"],
      entryRoot: "src",
    }),
  ],
  resolve: { alias: sourceAliases },
  /*
   * `public/` belongs to the playground, not to the package. Vite copies it
   * into the build output by default, which put `dist/assets/logo.svg` into
   * the published tarball — harmless at 1.9kB, but a file with no reason to be
   * there, and the kind of thing that grows. The DEMO build
   * (`vite.demo.config.ts`) still wants it, and has its own config, so turning
   * it off here costs the playground nothing.
   */
  publicDir: false,
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
      cssFileName: "styles",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-table", "@tanstack/react-virtual"],
    },
    cssCodeSplit: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    /*
     * Vitest's 5s default is tuned for unit tests. A good part of this suite
     * is not: `src/demo/Playground.test.tsx` mounts the entire playground
     * against a fake server with simulated latency and drives it through
     * `userEvent`, which types a character at a time. Measured locally the
     * slowest of those lands at ~1.2s — comfortable, until a shared CI runner
     * multiplies it. One did exactly that and tripped the 5s ceiling, which
     * failed the Pages deploy while reporting a "timeout" rather than a bug,
     * the least informative way a suite can fail.
     *
     * 20s is headroom, not permission to be slow: a test that genuinely hangs
     * still fails, and the local timings above are the number to watch. If one
     * of these starts needing seconds on a developer's own machine, that is a
     * regression to investigate rather than a ceiling to raise again.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
