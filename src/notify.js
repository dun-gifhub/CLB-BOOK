import nodemailer from "nodemailer";

/* ============================================================
   Nguyen tac: KHONG BAO GIO bao "da gui" neu nha cung cap
   chua xac nhan. Moi ham duoi day tra ve
     { ok: true }                      -> da gui that
     { ok: false, reason: "..." }      -> chua gui, kem ly do
   ============================================================ */

export function smsConfigured() {
  const p = (process.env.SMS_PROVIDER || "none").toLowerCase();
  if (p === "twilio") return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  if (p === "esms") return !!(process.env.ESMS_API_KEY && process.env.ESMS_SECRET_KEY && process.env.ESMS_BRANDNAME);
  return false;
}

export function emailConfigured() {
  const p = (process.env.EMAIL_PROVIDER || "none").toLowerCase();
  if (p === "gmail") return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  if (p === "smtp") return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return false;
}

/** Chuyen 0912345678 -> +84912345678 (Twilio yeu cau dang quoc te) */
function toE164(phone) {
  const d = String(phone).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("84")) return "+" + d;
  if (d.startsWith("0")) return "+84" + d.slice(1);
  return "+84" + d;
}

/* ---------------- SMS ---------------- */
export async function sendSMS(phone, text) {
  const provider = (process.env.SMS_PROVIDER || "none").toLowerCase();

  if (provider === "none" || !smsConfigured()) {
    return { ok: false, reason: "Chưa cấu hình SMS: hãy điền SMS_PROVIDER và khóa API trong tệp .env" };
  }

  try {
    if (provider === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const body = new URLSearchParams({ To: toE164(phone), From: process.env.TWILIO_FROM, Body: text });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `Twilio ${res.status}: ${data.message || "gửi thất bại"}` };
      if (data.status === "failed" || data.status === "undelivered") {
        return { ok: false, reason: `Twilio báo trạng thái ${data.status}` };
      }
      return { ok: true, id: data.sid };
    }

    if (provider === "esms") {
      const url = "https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApiKey: process.env.ESMS_API_KEY,
          SecretKey: process.env.ESMS_SECRET_KEY,
          Brandname: process.env.ESMS_BRANDNAME,
          SmsType: process.env.ESMS_SMS_TYPE || "2",
          Phone: String(phone).replace(/[^\d]/g, ""),
          Content: text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `eSMS ${res.status}` };
      // eSMS: CodeResult "100" la thanh cong, khac di la loi
      if (String(data.CodeResult) !== "100") {
        return { ok: false, reason: `eSMS CodeResult ${data.CodeResult}: ${data.ErrorMessage || "gửi thất bại"}` };
      }
      return { ok: true, id: data.SMSID };
    }

    return { ok: false, reason: `Nhà cung cấp SMS "${provider}" chưa được hỗ trợ` };
  } catch (e) {
    return { ok: false, reason: `Lỗi kết nối tới nhà cung cấp SMS: ${e.message}` };
  }
}

/* ---------------- Email ---------------- */
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const p = (process.env.EMAIL_PROVIDER || "none").toLowerCase();
  if (p === "gmail") {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s/g, "") },
    });
  } else if (p === "smtp") {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(to, subject, text, html) {
  if (!emailConfigured()) {
    return { ok: false, reason: "Chưa cấu hình Email: hãy điền EMAIL_PROVIDER và thông tin đăng nhập trong tệp .env" };
  }
  try {
    const t = getTransporter();
    const from = `"${process.env.MAIL_FROM_NAME || "Thư viện lớp"}" <${process.env.GMAIL_USER || process.env.SMTP_USER}>`;
    const info = await t.sendMail({ from, to, subject, text, html });
    if (info.rejected && info.rejected.length) {
      return { ok: false, reason: `Máy chủ thư từ chối địa chỉ: ${info.rejected.join(", ")}` };
    }
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, reason: `Gửi email thất bại: ${e.message}` };
  }
}

/* ---------------- Noi dung thong bao ---------------- */
export function viDate(iso) {
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

export function smsBody(rec, overdue) {
  return overdue
    ? `THONG BAO TRA SACH\nBan ${rec.name} dang muon sach ma ${rec.book_code}.\nHan tra ${viDate(rec.due_date)} da qua. Vui long tra sach som.`
    : `THONG BAO TRA SACH\nBan ${rec.name} dang muon sach ma ${rec.book_code}.\nHan tra: ${viDate(rec.due_date)}.\nVui long tra sach dung han.`;
}

export function emailSubject(rec) {
  return `🔔 Thông báo hạn trả sách – ${rec.book_code}`;
}

export function emailBody(rec, overdue) {
  const text =
`Xin chào ${rec.name},

Bạn đang mượn sách có mã ${rec.book_code}${rec.book_name ? ` (${rec.book_name})` : ""}.

Ngày mượn: ${viDate(rec.borrow_date)}
Hạn trả: ${viDate(rec.due_date)}

${overdue ? "⚠️ Sách đã quá hạn trả. Vui lòng trả sách sớm nhất có thể." : "Vui lòng trả sách đúng thời hạn."}

Đây là email tự động từ hệ thống quản lý mượn sách.`;

  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:15px;color:#102730;line-height:1.6">
  <p>Xin chào <b>${escapeHtml(rec.name)}</b>,</p>
  <p>Bạn đang mượn sách có mã <b>${escapeHtml(rec.book_code)}</b>${rec.book_name ? ` (${escapeHtml(rec.book_name)})` : ""}.</p>
  <table style="border-collapse:collapse">
    <tr><td style="padding:4px 12px 4px 0">Ngày mượn:</td><td><b>${viDate(rec.borrow_date)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0">Hạn trả:</td><td><b>${viDate(rec.due_date)}</b></td></tr>
  </table>
  <p style="padding:10px 14px;border-left:4px solid ${overdue ? "#c1392f" : "#e0a93c"};background:#f4f6f7">
    ${overdue ? "⚠️ Sách đã quá hạn trả. Vui lòng trả sách sớm nhất có thể." : "Vui lòng trả sách đúng thời hạn."}
  </p>
  <p style="color:#5a7079;font-size:13px">Đây là email tự động từ hệ thống quản lý mượn sách.</p>
</div>`;
  return { text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
