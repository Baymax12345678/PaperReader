import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handlePaperApi } from "./src/server/paperApi";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "paper-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const handled = await handlePaperApi(request, response);
          if (!handled) next();
        });
      },
    },
  ],
});
