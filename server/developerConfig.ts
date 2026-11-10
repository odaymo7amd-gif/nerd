// هوية المطوّر الوحيدة. الربط بمعرّف رقمي ثابت من بيئة الخادم فقط،
// وليس بالبريد أو اسم العرض. لا يُرسل هذا المعرّف إلى الواجهة.
const DEFAULT_DEVELOPER_USER_ID = 11;

export function developerUserId(): number {
  const raw = Number(process.env.ADMIN_USER_ID ?? process.env.DEVELOPER_USER_ID);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DEVELOPER_USER_ID;
}

export function isDeveloperIdentity(userId: number, role: string): boolean {
  return userId === developerUserId() && role === 'admin';
}
