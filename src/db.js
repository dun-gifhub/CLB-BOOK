import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), "data/thu-vien.db");
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_code  TEXT NOT NULL UNIQUE,
  book_name  TEXT,
  author     TEXT,
  category   TEXT,
  status     TEXT NOT NULL DEFAULT 'available'   -- available | borrowed
);

CREATE TABLE IF NOT EXISTS borrow_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  book_id            INTEGER NOT NULL REFERENCES books(id),
  borrow_date        TEXT NOT NULL,
  due_date           TEXT NOT NULL,
  actual_return_date TEXT,
  status             TEXT NOT NULL DEFAULT 'borrowing',  -- borrowing | returned
  confirmed_by       TEXT,
  confirmed_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  borrow_record_id  INTEGER REFERENCES borrow_records(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,        -- sms | email
  rule_key          TEXT NOT NULL,        -- truoc3 | truoc1 | dunghan | quahan | thucong
  run_date          TEXT NOT NULL,        -- ngay chay, chong gui trung
  recipient         TEXT NOT NULL,
  subject           TEXT,
  body              TEXT NOT NULL,
  sent_at           TEXT,
  status            TEXT NOT NULL,        -- pending | sent | failed | unconfigured
  error_message     TEXT,
  UNIQUE (borrow_record_id, type, rule_key, run_date)
);

CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_records(status, due_date);
CREATE INDEX IF NOT EXISTS idx_notif_status  ON notifications(status);
`);

// Nang cap co so du lieu cu (neu co) len co cot tai khoan cho nguoi muon.
try { db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT"); } catch (e) { /* da co cot */ }
try { db.exec("ALTER TABLE users ADD COLUMN password_salt TEXT"); } catch (e) { /* da co cot */ }

/* ---------- Tai khoan nguoi muon (hoc sinh tu dang ky) ---------- */
export function findAccountByIdentifier(identifier) {
  const v = String(identifier || "").trim();
  return db.prepare(
    "SELECT * FROM users WHERE (phone = ? OR email = ?) AND password_hash IS NOT NULL"
  ).get(v, v.toLowerCase());
}

export function findUserByContact(phone, email) {
  return db.prepare("SELECT * FROM users WHERE phone = ? AND email = ?").get(phone, email);
}

export function createAccount({ name, phone, email, hash, salt }) {
  const existing = findUserByContact(phone, email);
  if (existing) {
    if (existing.password_hash) {
      const err = new Error("Số điện thoại hoặc Gmail này đã có tài khoản. Hãy đăng nhập.");
      err.code = "ACCOUNT_EXISTS";
      throw err;
    }
    db.prepare("UPDATE users SET name=?, password_hash=?, password_salt=? WHERE id=?")
      .run(name, hash, salt, existing.id);
    return existing.id;
  }
  return db.prepare(
    "INSERT INTO users (name, phone, email, created_at, password_hash, password_salt) VALUES (?,?,?,?,?,?)"
  ).run(name, phone, email, new Date().toISOString(), hash, salt).lastInsertRowid;
}

export function getUserById(id) {
  return db.prepare("SELECT id, name, phone, email, created_at FROM users WHERE id = ?").get(id);
}

/* ---------- Nguoi muon ---------- */
export function upsertUser({ name, phone, email }) {
  const found = db.prepare("SELECT id FROM users WHERE phone = ? AND email = ?").get(phone, email);
  if (found) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, found.id);
    return found.id;
  }
  return db.prepare("INSERT INTO users (name, phone, email, created_at) VALUES (?,?,?,?)")
    .run(name, phone, email, new Date().toISOString()).lastInsertRowid;
}

/* ---------- Kho sach ---------- */
export function upsertBook({ book_code, book_name, author, category }) {
  const code = String(book_code).trim().toUpperCase();
  const found = db.prepare("SELECT id FROM books WHERE book_code = ?").get(code);
  if (found) {
    db.prepare("UPDATE books SET book_name = COALESCE(NULLIF(?,''), book_name), author = COALESCE(NULLIF(?,''), author), category = COALESCE(NULLIF(?,''), category) WHERE id = ?")
      .run(book_name || "", author || "", category || "", found.id);
    return found.id;
  }
  return db.prepare("INSERT INTO books (book_code, book_name, author, category, status) VALUES (?,?,?,?, 'available')")
    .run(code, book_name || "", author || "", category || "").lastInsertRowid;
}

export function setBookStatus(bookId, status) {
  db.prepare("UPDATE books SET status = ? WHERE id = ?").run(status, bookId);
}

export function isBookBorrowed(code) {
  const row = db.prepare(`
    SELECT r.id FROM borrow_records r
    JOIN books b ON b.id = r.book_id
    WHERE UPPER(b.book_code) = UPPER(?) AND r.status = 'borrowing' LIMIT 1`).get(code);
  return !!row;
}

/* ---------- Luot muon ---------- */
export const listBorrows = db.prepare(`
  SELECT r.*, u.name, u.phone, u.email, b.book_code, b.book_name
  FROM borrow_records r
  JOIN users u ON u.id = r.user_id
  JOIN books b ON b.id = r.book_id
  ORDER BY r.created_at DESC`);

export const getBorrow = db.prepare(`
  SELECT r.*, u.name, u.phone, u.email, b.book_code, b.book_name
  FROM borrow_records r
  JOIN users u ON u.id = r.user_id
  JOIN books b ON b.id = r.book_id
  WHERE r.id = ?`);

export const activeBorrows = db.prepare(`
  SELECT r.*, u.name, u.phone, u.email, b.book_code, b.book_name
  FROM borrow_records r
  JOIN users u ON u.id = r.user_id
  JOIN books b ON b.id = r.book_id
  WHERE r.status = 'borrowing'`);

/** Chay mot ham trong giao dich; tu dong ROLLBACK neu co loi. */
function inTransaction(fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function createBorrow(input) {
  const { name, phone, email, book_code, book_name, borrow_date, due_date } = input;
  if (isBookBorrowed(book_code)) {
    const err = new Error(`Mã sách ${book_code} đang được người khác mượn.`);
    err.code = "BOOK_BUSY";
    throw err;
  }
  return inTransaction(() => {
    const userId = upsertUser({ name, phone, email });
    const bookId = upsertBook({ book_code, book_name, author: "", category: "" });
    const id = db.prepare(`INSERT INTO borrow_records
      (user_id, book_id, borrow_date, due_date, status, created_at)
      VALUES (?,?,?,?, 'borrowing', ?)`)
      .run(userId, bookId, borrow_date, due_date, new Date().toISOString()).lastInsertRowid;
    setBookStatus(bookId, "borrowed");
    return id;
  });
}

/** Nguoi muon tu tao luot muon bang chinh tai khoan cua minh (khong tao/doi ho so nguoi khac). */
export function createBorrowForAccount(userId, { book_code, book_name, borrow_date, due_date }) {
  if (isBookBorrowed(book_code)) {
    const err = new Error(`Mã sách ${book_code} đang được người khác mượn.`);
    err.code = "BOOK_BUSY";
    throw err;
  }
  return inTransaction(() => {
    const bookId = upsertBook({ book_code, book_name, author: "", category: "" });
    const id = db.prepare(`INSERT INTO borrow_records
      (user_id, book_id, borrow_date, due_date, status, created_at)
      VALUES (?,?,?,?, 'borrowing', ?)`)
      .run(userId, bookId, borrow_date, due_date, new Date().toISOString()).lastInsertRowid;
    setBookStatus(bookId, "borrowed");
    return id;
  });
}

export function myBorrows(userId) {
  return db.prepare(`
    SELECT r.*, u.name, u.phone, u.email, b.book_code, b.book_name
    FROM borrow_records r
    JOIN users u ON u.id = r.user_id
    JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC`).all(userId);
}

export function markReturned(id, { actual_return_date, confirmed_by }) {
  const rec = getBorrow.get(id);
  if (!rec) return null;
  inTransaction(() => {
    db.prepare(`UPDATE borrow_records
      SET status='returned', actual_return_date=?, confirmed_by=?, confirmed_at=?
      WHERE id = ?`).run(actual_return_date, confirmed_by || "Quản trị viên", new Date().toISOString(), id);
    setBookStatus(rec.book_id, "available");
  });
  return getBorrow.get(id);
}

/* ---------- Thong bao ---------- */
export function queueNotification(row) {
  try {
    return db.prepare(`INSERT INTO notifications
      (borrow_record_id, type, rule_key, run_date, recipient, subject, body, status)
      VALUES (@borrow_record_id, @type, @rule_key, @run_date, @recipient, @subject, @body, 'pending')`)
      .run(row).lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return null; // da tao hom nay roi
    throw e;
  }
}

export const pendingNotifications = db.prepare("SELECT * FROM notifications WHERE status = 'pending' ORDER BY id");

export function markNotification(id, status, errorMessage) {
  db.prepare("UPDATE notifications SET status = ?, sent_at = ?, error_message = ? WHERE id = ?")
    .run(status, status === "sent" ? new Date().toISOString() : null, errorMessage || null, id);
}

export const listNotifications = db.prepare(`
  SELECT n.*, u.name AS to_name FROM notifications n
  LEFT JOIN borrow_records r ON r.id = n.borrow_record_id
  LEFT JOIN users u ON u.id = r.user_id
  ORDER BY n.id DESC LIMIT 300`);
