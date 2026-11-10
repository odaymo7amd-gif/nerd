import { get, run } from '../db.ts';
import { hashPassword } from '../auth.ts';

const [email, password, usernameArg] = process.argv.slice(2);

if (!email || !password) {
  console.error('الاستخدام: npm run admin:create -- <email> <password> [username]');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('البريد الإلكتروني غير صحيح.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
  process.exit(1);
}

const username = (usernameArg ?? email.split('@')[0]).slice(0, 40);
const existing = get<{ id: number; role: string }>('SELECT id, role FROM users WHERE email = ? COLLATE NOCASE', email);

if (existing) {
  run('UPDATE users SET role = ?, password_hash = ?, is_active = 1 WHERE id = ?', 'admin', hashPassword(password), existing.id);
  run('DELETE FROM sessions WHERE user_id = ?', existing.id);
  console.log(`تم ترقية الحساب ${email} إلى مشرف وتعيين كلمة مرور جديدة.`);
} else {
  const created = run(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    username,
    email,
    hashPassword(password),
    'admin',
  );
  run('INSERT INTO user_statistics (user_id) VALUES (?)', created.lastInsertRowid);
  console.log(`تم إنشاء حساب مشرف: ${email} (اسم المستخدم: ${username})`);
}
