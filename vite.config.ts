import { defineConfig } from "vite";
import { cdnImagePlugin } from "./scripts/cdn-image";

export default defineConfig({
  base: "./",
  plugins: [cdnImagePlugin()],
});
