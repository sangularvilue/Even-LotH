import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import express from "express";
import cors from "cors";
import QRCode from "qrcode";
import { fetchHoursIndex, fetchHourContent } from "./scraper.js";
import { cacheGet, cacheSet } from "./cache.js";
import type { HoursIndex, HourContent } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, "..");
const LITURGY_ROOT = resolve(SERVER_ROOT, "..");
const PORT = 3210;

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

async function startTunnel(
  port: number
): Promise<{ url: string; process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://127.0.0.1:${port}`],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const timeout = setTimeout(
      () => reject(new Error("Tunnel timed out after 30s")),
      30000
    );

    const handleOutput = (data: Buffer) => {
      const match = data
        .toString()
        .match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve({ url: match[0], process: proc });
      }
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function isCloudflaredInstalled(): Promise<boolean> {
  try {
    execSync("cloudflared --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function main() {
  const distDir = resolve(LITURGY_ROOT, "dist");

  if (!existsSync(distDir)) {
    console.log("Building glasses app...");
    execSync("npm run build", { cwd: LITURGY_ROOT, stdio: "inherit" });
  }

  const app = express();
  app.use(cors());

  // API routes
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/hours", async (req, res) => {
    try {
      const date = (req.query.date as string) || todayDate();
      const cacheKey = `hours:${date}`;
      const cached = cacheGet<HoursIndex>(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const hours = await fetchHoursIndex(date);
      const result: HoursIndex = { date, hours };
      cacheSet(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error("Error fetching hours:", error);
      res.status(500).json({ error: "Failed to fetch hours index" });
    }
  });

  app.get("/api/hour/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      const date = (req.query.date as string) || todayDate();
      const cacheKey = `hour:${slug}:${date}`;
      const cached = cacheGet<HourContent>(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const content = await fetchHourContent(slug, date);
      cacheSet(cacheKey, content);
      res.json(content);
    } catch (error) {
      console.error(`Error fetching hour ${req.params.slug}:`, error);
      res.status(500).json({ error: "Failed to fetch hour content" });
    }
  });

  // Serve built glasses app
  app.use(express.static(distDir));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(resolve(distDir, "index.html"));
  });

  const server = app.listen(PORT, "0.0.0.0", async () => {
    const localUrl = `http://${getLocalIP()}:${PORT}`;
    let connectUrl = localUrl;

    if (await isCloudflaredInstalled()) {
      try {
        console.log("Starting Cloudflare tunnel...");
        const tunnel = await startTunnel(PORT);
        connectUrl = tunnel.url;
        console.log(`Tunnel URL: ${tunnel.url}`);

        process.on("SIGINT", () => {
          tunnel.process.kill();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          tunnel.process.kill();
          process.exit(0);
        });
      } catch (err) {
        console.warn(
          "Tunnel failed, using local URL:",
          (err as Error).message
        );
      }
    }

    const qr = await QRCode.toString(connectUrl, {
      type: "terminal",
      small: true,
    });
    console.log("\nScan this QR code with your Even G2 glasses:\n");
    console.log(qr);
    console.log(`URL: ${connectUrl}`);
    console.log(`Local: ${localUrl}\n`);
  });

  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

main();
