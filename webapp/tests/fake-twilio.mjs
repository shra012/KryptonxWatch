// A stand-in for Twilio's REST API so the alert tests never spend the hackathon
// credit. It speaks just enough of Messages.json: basic auth, a form body, and a
// JSON reply carrying a message sid.
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 4010);
const sent = [];
createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/__sent") return json(200, sent);
  const match = req.url?.match(/^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/);
  if (req.method !== "POST" || !match) return json(404, { message: "not found" });
  if (!(req.headers.authorization ?? "").startsWith("Basic ")) return json(401, { message: "missing credentials", code: 20003 });
  let raw = ""; req.on("data", c => { raw += c; });
  req.on("end", () => {
    const form = new URLSearchParams(raw);
    const body = form.get("Body") ?? "";
    if (body.length > 160) return json(400, { message: `body is ${body.length} characters, over one segment`, code: 21617 });
    const message = { sid: `SM${sent.length.toString().padStart(32, "0")}`, to: form.get("To"), from: form.get("From"), body, account: match[1] };
    sent.push(message); json(201, message);
  });
}).listen(port, "127.0.0.1", () => console.log(`fake twilio on ${port}`));
