import { activeBorrows, queueNotification, pendingNotifications, markNotification } from "./db.js";
import { sendSMS, sendEmail, smsBody, emailBody, emailSubject, smsConfigured, emailConfigured } from "./notify.js";

const on = (v, d = true) => (v === undefined ? d : String(v) === "1" || String(v) === "true");

export function todayISO(tz = process.env.TIMEZONE || "Asia/Ho_Chi_Minh") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export function dayDiff(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

/** Tinh trang thai hien tai cua mot luot muon */
export function statusOf(rec, today = todayISO(), warnDays = 3) {
  if (rec.status === "returned") return "returned";
  const d = dayDiff(today, rec.due_date);
  if (d < 0) return "overdue";
  if (d === 0) return "due_today";
  if (d <= warnDays) return "due_soon";
  return "borrowing";
}

/** Moc nhac ung voi ngay hom nay, hoac null neu hom nay khong phai nhac */
function ruleFor(rec, today) {
  const d = dayDiff(today, rec.due_date);
  if (d === 3 && on(process.env.NOTIFY_BEFORE_3)) return "truoc3";
  if (d === 1 && on(process.env.NOTIFY_BEFORE_1)) return "truoc1";
  if (d === 0 && on(process.env.NOTIFY_ON_DUE)) return "dunghan";
  if (d < 0 && on(process.env.NOTIFY_OVERDUE)) return "quahan";
  return null;
}

/** Buoc 1: tao hang cho — luot da tra thi khong tao gi ca */
export function buildQueue(today = todayISO()) {
  let created = 0;
  for (const rec of activeBorrows.all()) {
    const rule = ruleFor(rec, today);
    if (!rule) continue;
    const overdue = dayDiff(today, rec.due_date) < 0;

    if ((process.env.SMS_PROVIDER || "none") !== "none" && rec.phone) {
      if (queueNotification({
        borrow_record_id: rec.id, type: "sms", rule_key: rule, run_date: today,
        recipient: rec.phone, subject: null, body: smsBody(rec, overdue),
      })) created++;
    }
    if ((process.env.EMAIL_PROVIDER || "none") !== "none" && rec.email) {
      if (queueNotification({
        borrow_record_id: rec.id, type: "email", rule_key: rule, run_date: today,
        recipient: rec.email, subject: emailSubject(rec), body: emailBody(rec, overdue).text,
      })) created++;
    }
  }
  return created;
}

/** Buoc 2: gui that. Chi danh dau "sent" khi nha cung cap xac nhan. */
export async function flushQueue() {
  const rows = pendingNotifications.all();
  const out = { sent: 0, failed: 0, unconfigured: 0, total: rows.length };

  for (const n of rows) {
    if (n.type === "sms" && !smsConfigured()) {
      markNotification(n.id, "unconfigured", "Chưa cấu hình SMS");
      out.unconfigured++; continue;
    }
    if (n.type === "email" && !emailConfigured()) {
      markNotification(n.id, "unconfigured", "Chưa cấu hình Email");
      out.unconfigured++; continue;
    }

    const res = n.type === "sms"
      ? await sendSMS(n.recipient, n.body)
      : await sendEmail(n.recipient, n.subject || "Thông báo hạn trả sách", n.body,
          n.body.replace(/\n/g, "<br>"));

    if (res.ok) { markNotification(n.id, "sent", null); out.sent++; }
    else { markNotification(n.id, "failed", res.reason); out.failed++; }
  }
  return out;
}

export async function runDailyCheck() {
  const today = todayISO();
  const created = buildQueue(today);
  const result = await flushQueue();
  const line = `[${new Date().toISOString()}] Kiểm tra ngày ${today}: tạo ${created} thông báo, gửi thành công ${result.sent}, thất bại ${result.failed}, chưa cấu hình ${result.unconfigured}.`;
  console.log(line);
  return { today, created, ...result };
}
