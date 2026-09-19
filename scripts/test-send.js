import "dotenv/config";
import { sendSMS, sendEmail, smsConfigured, emailConfigured } from "../src/notify.js";

/* Gui thu mot SMS va mot email that, bao ro ket qua. */
const phone = process.env.TEST_PHONE;
const email = process.env.TEST_EMAIL;

console.log("=== KIEM TRA GUI THAT ===\n");

if (!smsConfigured()) {
  console.log("SMS   : CHUA CAU HINH — hay dien SMS_PROVIDER va khoa API trong .env");
} else if (!phone) {
  console.log("SMS   : da cau hinh, nhung thieu TEST_PHONE trong .env");
} else {
  const r = await sendSMS(phone, "Thu vien lop: day la tin nhan kiem tra he thong. Neu ban nhan duoc, cau hinh SMS da dung.");
  console.log(r.ok ? `SMS   : DA GUI THAT toi ${phone} (id ${r.id})` : `SMS   : THAT BAI — ${r.reason}`);
}

if (!emailConfigured()) {
  console.log("EMAIL : CHUA CAU HINH — hay dien EMAIL_PROVIDER va thong tin dang nhap trong .env");
} else if (!email) {
  console.log("EMAIL : da cau hinh, nhung thieu TEST_EMAIL trong .env");
} else {
  const r = await sendEmail(email, "Kiểm tra hệ thống thư viện",
    "Đây là email kiểm tra. Nếu bạn nhận được, cấu hình email đã đúng.",
    "<p>Đây là email kiểm tra. Nếu bạn nhận được, cấu hình email đã đúng.</p>");
  console.log(r.ok ? `EMAIL : DA GUI THAT toi ${email} (id ${r.id})` : `EMAIL : THAT BAI — ${r.reason}`);
}

console.log("\nLuu y: ket qua tren la phan hoi that tu nha cung cap, khong phai gia lap.");
process.exit(0);
