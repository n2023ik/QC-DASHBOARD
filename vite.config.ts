import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function sheetDataProxy(appScriptUrl: URL | null) {
  return {
    name: "sheet-data-proxy",
    configureServer(server) {
      server.middlewares.use("/sheet-data", async (req, res) => {
        if (!appScriptUrl) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: "VITE_APP_SCRIPT_URL is not configured" }));
          return;
        }

        try {
          const target = new URL(appScriptUrl.toString());
          const incomingUrl = new URL(req.url ?? "", "http://localhost");
          incomingUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

          const response = await fetch(target, {
            method: req.method,
            redirect: "follow",
            headers: {
              accept: req.headers.accept ?? "application/json",
              "content-type": req.headers["content-type"] ?? "text/plain;charset=utf-8",
            },
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });

          res.statusCode = response.status;
          res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appScriptUrl = env.VITE_APP_SCRIPT_URL ? new URL(env.VITE_APP_SCRIPT_URL) : null;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [sheetDataProxy(appScriptUrl), react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
