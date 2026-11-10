// طبقة إرسال البريد. مفصولة عن بقية الكود ليصبح ربط مزوّد البريد
// (Resend / SMTP / Supabase) مسألة إعداد متغيرات بيئة دون تغيير المنطق.
//
// الوضع الحالي: إذا لم يكن EMAIL_API_KEY مضبوطًا، يُسجَّل محتوى الرسالة في
// سجل الخادم فقط (تسليم تطويري)، وتُبلَّغ الواجهة بذلك بشفافية.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  delivered: boolean;
  reason?: string;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log('\n[nerd/mailer] لم يتم ضبط مزوّد البريد بعد. محتوى الرسالة:');
    console.log(`  إلى: ${message.to}`);
    console.log(`  الموضوع: ${message.subject}`);
    console.log(`  النص: ${message.text}\n`);
    return { delivered: false, reason: 'email_provider_not_configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('[nerd/mailer] فشل الإرسال:', response.status, body.slice(0, 400));
      return { delivered: false, reason: `provider_error_${response.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error('[nerd/mailer] خطأ في الاتصال بمزوّد البريد:', error);
    return { delivered: false, reason: 'provider_unreachable' };
  }
}
