import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const translationSecretUrl =
  "https://api.openai.com/v1/realtime/translations/client_secrets";

await loadEnvFile();

const port = Number(process.env.PORT || 3000);

const languages = new Map([
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["hi", "Hindi"],
  ["ru", "Russian"],
  ["id", "Indonesian"],
  ["vi", "Vietnamese"]
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

async function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const text = await readFile(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    const current = process.env[key]?.trim();
    if (key && (current === undefined || current === "" || current === "=")) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function safeUserId(req) {
  const address = req.socket.remoteAddress || "local-user";
  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  return `interpreter-deck-${hash.toString(16)}`;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function createTranslationSession(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Invalid JSON body." });
    return;
  }

  const targetLanguage = String(body.targetLanguage || "es").toLowerCase();
  if (!languages.has(targetLanguage)) {
    sendJson(res, 400, {
      error: `Unsupported target language: ${targetLanguage}`,
      supported: Object.fromEntries(languages)
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === "=" || apiKey.includes("your-key")) {
    sendJson(res, 500, {
      error:
        "OPENAI_API_KEY is not set. Add it to your environment before starting the server."
    });
    return;
  }

  const response = await fetch(translationSecretUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safeUserId(req)
    },
    body: JSON.stringify({
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" }
          },
          output: { language: targetLanguage }
        }
      }
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    sendJson(res, response.status, {
      error: json.error?.message || "OpenAI session creation failed.",
      details: json
    });
    return;
  }

  const value = json.value || json.client_secret?.value || json.client_secret;
  if (!value) {
    sendJson(res, 502, {
      error: "OpenAI response did not include a client secret.",
      details: json
    });
    return;
  }

  sendJson(res, 200, {
    value,
    client_secret: value,
    language: targetLanguage,
    languageLabel: languages.get(targetLanguage)
  });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.normalize(path.join(publicDir, relativePath));
  const insidePublic =
    filePath === publicDir || filePath.startsWith(`${publicDir}${path.sep}`);
  const fileStats = insidePublic
    ? await stat(filePath).catch(() => null)
    : null;

  if (!insidePublic || !fileStats?.isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/languages") {
      sendJson(res, 200, Object.fromEntries(languages));
      return;
    }

    if (req.method === "POST" && req.url === "/session") {
      await createTranslationSession(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error." });
  }
});

server.listen(port, () => {
  console.log(`Interpreter Deck running at http://localhost:${port}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log("Set OPENAI_API_KEY before starting a translation session.");
  }
});
