import "dotenv/config";
import { readFileSync } from "node:fs";
import { createBorrow } from "../src/db.js";

/* Nap danh sach luot muon tu tep JSON xuat ra tu trang web.
   Dinh dang: [{ name, phone, email, book_code, book_name, borrow_date, due_date }, ...]
   Dung: npm run import danh-sach.json                                            */
const file = process.argv[2];
if (!file) { console.error("Thieu ten tep. Vi du: npm run import danh-sach.json"); process.exit(1); }

const rows = JSON.parse(readFileSync(file, "utf8"));
let ok = 0, skip = 0;
for (const r of rows) {
  try { createBorrow(r); ok++; }
  catch (e) { console.warn(`Bo qua ${r.book_code}: ${e.message}`); skip++; }
}
console.log(`Da nap ${ok} luot muon, bo qua ${skip}.`);
process.exit(0);
