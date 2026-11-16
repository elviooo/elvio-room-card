// Entwickler-Proxy: Unter http://localhost:<PORT> erscheint Home Assistant (alles wird an
// HA_URL weitergereicht, auch der WebSocket), und DEV_PATH liefert die Karte aus dem Repo als
// <elvio-room-card-dev>. Gleicher Ursprung wie HA, weil Browser in einer http-Seite keine
// Skripte von localhost oder anderen Rechnern laden (Private Network Access).
// Start: HA_URL=http://<ha-adresse> node tools/dev-server.mjs   (Port über PORT=…, Standard 8765)
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { pipeline } from "node:stream";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8765);
const FILE = fileURLToPath(new URL("../elvio-room-card.js", import.meta.url));
export const DEV_PATH = "/elvio-dev/elvio-room-card-dev.js";

export function devBuild(src) {
  return src
    .replace('customElements.define("elvio-room-card",', 'customElements.define("elvio-room-card-dev",')
    .replace('  type: "elvio-room-card",', '  type: "elvio-room-card-dev",')
    .replace('  name: "Elvio Raumkarte",', '  name: "Elvio Raumkarte (Entwicklung)",');
}

export function isDevPath(url) {
  return String(url || "").split("?")[0] === DEV_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.HA_URL) {
    console.error("HA_URL fehlt, z. B. HA_URL=http://192.168.1.10:8123 node tools/dev-server.mjs");
    process.exit(1);
  }
  let target;
  try {
    target = new URL(process.env.HA_URL);
  } catch {
    console.error(`HA_URL ungültig: "${process.env.HA_URL}" – mit http:// angeben, z. B. http://192.168.1.10:8123`);
    process.exit(1);
  }
  if (target.protocol !== "http:") {
    console.error("HA_URL: nur http:// wird unterstützt");
    process.exit(1);
  }
  const port = Number(target.port || 80);
  const server = createServer(async (req, res) => {
    if (isDevPath(req.url)) {
      // Datei kann kurz fehlen, wenn git oder ein Editor sie gerade schreibt – der Proxy soll weiterlaufen.
      try {
        const src = devBuild(await readFile(FILE, "utf8"));
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end(src);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Entwicklerkarte nicht lesbar: ${err.message}`);
      }
      return;
    }
    const up = request(
      { host: target.hostname, port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        // pipeline räumt beide Seiten auf, wenn eine abbricht (Client weg, HA bricht mitten in der Antwort ab).
        pipeline(r, res, () => {});
      },
    );
    up.on("error", (err) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`HA nicht erreichbar: ${err.message}`);
    });
    pipeline(req, up, () => {});
    res.on("close", () => up.destroy());
  });
  // WebSocket (/api/websocket): Handshake neu schreiben (Host von HA), danach roh durchreichen.
  server.on("upgrade", (req, socket, head) => {
    const up = connect(port, target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries({ ...req.headers, host: target.host })) lines.push(`${k}: ${v}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    // Schließt oder bricht eine Seite ab, fliegt die andere mit raus – sonst bleiben halboffene Sockets liegen.
    const closeBoth = () => {
      up.destroy();
      socket.destroy();
    };
    up.on("error", (err) => {
      console.error(`WebSocket zu HA fehlgeschlagen: ${err.message}`);
      closeBoth();
    });
    socket.on("error", closeBoth);
    up.on("close", closeBoth);
    socket.on("close", closeBoth);
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`HA mit Entwicklerkarte: http://localhost:${PORT}/  (Karte: ${DEV_PATH})`));
}
