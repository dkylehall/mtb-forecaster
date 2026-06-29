import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// `base` is set for project-style static hosting (e.g. GitHub/GitLab Pages serve
// under /<repo>/). For root-domain hosting set it back to "/".
export default defineConfig({
  base: "./",
  plugins: [vue()],
  server: { port: 5173, open: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
