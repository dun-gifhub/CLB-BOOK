import crypto from "node:crypto";

const SECRET = process.env.SESSION_SECRET || "";

/* ---------------- Mat khau ---------------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(test, "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- Phieu dang nhap (JWT don gian, tu ky) ---------------- */
export function makeToken(payload, hours = 12) {
  const body = JSON.stringify({ ...payload, exp: Date.now() + hours * 3600 * 1000 });
  const b = Buffer.from(body).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
  return `${b}.${sig}`;
}
export function readToken(token) {
  if (!token || !token.includes(".")) return null;
  const [b, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

/** Middleware: chi cho quan tri vien (token khong co uid, role admin). */
export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const p = readToken(token);
  if (!p || p.role !== "admin") return res.status(401).json({ error: "Bạn cần đăng nhập bằng tài khoản quản trị." });
  next();
}

/** Middleware: chi cho nguoi muon da dang nhap (token co uid). */
export function requireAccount(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const p = readToken(token);
  if (!p || p.role !== "docgia" || !p.uid) return res.status(401).json({ error: "Bạn cần đăng nhập tài khoản người mượn." });
  req.uid = p.uid;
  next();
}
