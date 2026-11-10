#!/usr/bin/env bash
# اختبار دخاني لواجهات الخادم الحقيقية (بدون متصفح).
# الاستخدام: BASE_URL=http://127.0.0.1:8787 bash scripts/api-smoke-test.sh
# اختياري: LOG_FILE=/tmp/nerd-server.log لاختبار مسار إعادة تعيين كلمة المرور.
set -uo pipefail

BASE="${BASE_URL:-http://127.0.0.1:8787}"
LOG_FILE="${LOG_FILE:-}"
JAR=$(mktemp)
ADMIN_JAR=$(mktemp)
BODY=$(mktemp)
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1 — $2"; }

# expect <name> <expected-code> <method> <path> <jar|-> [json-body] [extra-header]
# عند USE_AI_KEY=1 تُضاف ترويسة مفتاح المتصفح إلى الطلب (مفتاح الاختبار فقط).
expect() {
  local name="$1" want="$2" method="$3" path="$4" jar="$5" data="${6:-}" extra="${7:-}"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$BASE$path" -H 'Content-Type: application/json')
  if [ "$jar" != "-" ]; then args+=(-b "$jar" -c "$jar"); fi
  if [ "${USE_AI_KEY:-0}" = "1" ]; then args+=(-H "X-AI-Key: ${AI_KEY:-smoke-test-key}"); fi
  if [ -n "$extra" ]; then args+=(-H "$extra"); fi
  if [ -n "$data" ]; then args+=(-d "$data"); fi
  local code
  code=$(curl "${args[@]}")
  local payload
  payload=$(head -c 300 "$BODY")
  if [ "$code" = "$want" ]; then ok "$name"; else bad "$name" "توقّعنا $want وحصلنا $code — $payload"; fi
}

# json <path> : يقرأ آخر استجابة ويطبع قيمة مسار مثل user.id أو curricula.0.id
json() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let value = data;
    for (const part of process.argv[2].split(".")) {
      value = value?.[/^\d+$/.test(part) ? Number(part) : part];
    }
    console.log(typeof value === "object" ? JSON.stringify(value) : String(value));
  ' "$BODY" "$1"
}

case_id=$(date +%s)
EMAIL="smoke${case_id}@example.com"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin${case_id}@example.com}"

echo "== فحص الصحة =="
expect "خدمة الصحة تعمل" 200 GET /api/health -
expect "مستخدم غير مسجل يحصل على 401" 401 GET /api/auth/me -

echo "== الحسابات =="
expect "إنشاء حساب جديد" 201 POST /api/auth/register "$JAR" \
  "{\"username\":\"مستخدم اختبار ${case_id}\",\"email\":\"$EMAIL\",\"password\":\"Passw0rd123\",\"confirmPassword\":\"Passw0rd123\"}"
expect "منع تكرار البريد الإلكتروني" 409 POST /api/auth/register - \
  "{\"username\":\"آخر\",\"email\":\"$EMAIL\",\"password\":\"Passw0rd123\",\"confirmPassword\":\"Passw0rd123\"}"
expect "كلمة مرور غير متطابقة مرفوضة" 400 POST /api/auth/register - \
  "{\"username\":\"مستخدم\",\"email\":\"other${case_id}@example.com\",\"password\":\"Passw0rd123\",\"confirmPassword\":\"Passw0rd124\"}"
expect "الجلسة تعمل بعد التسجيل" 200 GET /api/auth/me "$JAR"

echo "== الإعداد الأولي والمناهج =="
expect "قراءة بيانات المناهج" 200 GET /api/meta "$JAR"
COUNTRY=$(json "countries.0.id")
CURRICULUM=$(json "curricula.0.id")
GRADE=$(json "curricula.0.grades.8.id")
SEMESTER=$(json "curricula.0.semesters.0.id")
S1=$(json "curricula.0.subjects.0.id")
S2=$(json "curricula.0.subjects.2.id")

expect "حفظ البيانات الدراسية" 200 PATCH /api/profile "$JAR" \
  "{\"countryId\":$COUNTRY,\"curriculumId\":$CURRICULUM,\"gradeLevelId\":$GRADE,\"semesterId\":$SEMESTER,\"subjectIds\":[$S1,$S2]}"
expect "الصفحة الرئيسية تعمل" 200 GET /api/home "$JAR"
expect "قائمة الميزات تعمل" 200 GET /api/features "$JAR"
expect "الإشعارات تعمل" 200 GET /api/notifications "$JAR"

echo "== الصلاحيات =="
expect "منع الطالب من إحصائيات الإدارة" 403 GET /api/admin/overview "$JAR"
expect "منع الطالب من قائمة المستخدمين" 403 GET /api/admin/users "$JAR"
expect "منع الطالب من تعديل مادة" 403 POST /api/admin/subjects "$JAR" '{"name":"اختبار","code":"TST","curriculumId":1}'

echo "== الإعدادات =="
expect "تغيير الوضع الليلي" 200 PATCH /api/settings "$JAR" '{"theme":"light"}'
expect "رفض قيمة مظهر غير صحيحة" 400 PATCH /api/settings "$JAR" '{"theme":"neon"}'
expect "رفض كلمة مرور قديمة خاطئة" 400 POST /api/auth/change-password "$JAR" \
  '{"currentPassword":"WrongPass1","newPassword":"NewPassw0rd1","confirmPassword":"NewPassw0rd1"}'

echo "== استعادة كلمة المرور =="
expect "طلب رابط استعادة" 200 POST /api/auth/forgot-password - "{\"email\":\"$EMAIL\"}"
expect "رفض رمز إعادة تعيين غير صحيح" 400 POST /api/auth/reset-password - \
  '{"token":"invalid-token-value","password":"NewPassw0rd1","confirmPassword":"NewPassw0rd1"}'

if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  RESET_TOKEN=$(grep -o 'reset-password?token=[A-Za-z0-9_-]*' "$LOG_FILE" | tail -1 | cut -d= -f2)
  if [ -n "${RESET_TOKEN:-}" ]; then
    expect "إعادة التعيين برمز صالح" 200 POST /api/auth/reset-password - \
      "{\"token\":\"$RESET_TOKEN\",\"password\":\"NewPassw0rd1\",\"confirmPassword\":\"NewPassw0rd1\"}"
    expect "الدخول بكلمة المرور الجديدة" 200 POST /api/auth/login - \
      "{\"email\":\"$EMAIL\",\"password\":\"NewPassw0rd1\",\"remember\":false}"
    expect "رفض إعادة استخدام نفس الرمز" 400 POST /api/auth/reset-password - \
      "{\"token\":\"$RESET_TOKEN\",\"password\":\"NewPassw0rd2\",\"confirmPassword\":\"NewPassw0rd2\"}"
  else
    bad "استخراج رمز إعادة التعيين" "لم يوجد رمز في سجل الخادم"
  fi
else
  echo "SKIP: اختبار مسار إعادة التعيين (LOG_FILE غير محدد)"
fi

# تأمين جلسة نشطة (مسار إعادة التعيين يُنهي كل الجلسات السابقة)
LOGIN_PAYLOAD=$(printf '{"email":"%s","password":"NewPassw0rd1","remember":false}' "$EMAIL")
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD" "$BASE/api/auth/login" || true

echo "== الكتب =="
PDF_FILE="${PDF_FIXTURE:-data/fixtures/test-book.pdf}"
IMG_FILE="${IMAGE_FIXTURE:-data/fixtures/test-page.png}"
OTHER_JAR=$(mktemp)
# حساب ثانٍ من البداية لاختبار عزل البيانات بين الحسابات
curl -s -o /dev/null -c "$OTHER_JAR" -b "$OTHER_JAR" -X POST -H 'Content-Type: application/json' \
  -d "$(printf '{"username":"طالب عزل %s","email":"other%s@example.com","password":"Passw0rd123","confirmPassword":"Passw0rd123"}' "$case_id" "$case_id")" \
  "$BASE/api/auth/register"

check_code() { # $1 name $2 expected $3 actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "توقّعنا $2 وحصلنا $3 — $(head -c 260 "$BODY")"; fi
}

upload_book() { # $1 title, rest: files
  local title="$1"; shift
  local args=(-s -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR"
    -F "title=$title" -F "subjectId=$S1" -F "gradeLevelId=$GRADE" -F "semesterId=$SEMESTER")
  local f
  for f in "$@"; do args+=(-F "files=@$f"); done
  curl "${args[@]}" "$BASE/api/books"
}

wait_ready() { # $1 bookId $2 attempts
  local id="$1" limit="${2:-45}" status=""
  local _
  for _ in $(seq 1 "$limit"); do
    curl -s -b "$JAR" "$BASE/api/books/$id" -o "$BODY"
    status=$(json 'book.status' 2>/dev/null || echo '')
    case "$status" in ready|failed) break ;; esac
    sleep 1
  done
  echo "$status"
}

if [ -f "$PDF_FILE" ]; then
  CODE=$(upload_book "كتاب اختبار PDF" "$PDF_FILE")
  check_code "رفع كتاب PDF" 201 "$CODE"
  BOOK_ID=$(json 'book.id' 2>/dev/null || echo '')
  STATUS=$(wait_ready "$BOOK_ID" 45)
  check_code "اكتملت معالجة PDF" ready "$STATUS"
  check_code "عدد صفحات PDF" 3 "$(json 'book.pagesCount')"
  CHUNKS=$(json 'book.chunksCount')
  if [ "${CHUNKS:-0}" -gt 0 ]; then ok "تم بناء مقاطع نصية مرتبطة بالصفحات"; else bad "مقاطع نصية" "0"; fi

  curl -s -b "$JAR" "$BASE/api/books/$BOOK_ID/pages/1" -o "$BODY"
  if grep -q 'NERD' "$BODY"; then ok "استخراج نص الصفحة الأولى"; else bad "استخراج نص الصفحة الأولى" "$(head -c 200 "$BODY")"; fi

  curl -s -b "$JAR" "$BASE/api/books/$BOOK_ID/search?q=NERD" -o "$BODY"
  FOUND=$(json 'results.length' 2>/dev/null || echo 0)
  if [ "${FOUND:-0}" -gt 0 ]; then ok "البحث داخل الكتاب"; else bad "البحث داخل الكتاب" "$(head -c 200 "$BODY")"; fi

  CODE=$(upload_book "نسخة مكررة" "$PDF_FILE")
  check_code "منع رفع الملف نفسه مرتين" 409 "$CODE"

  expect "تعديل بيانات الكتاب" 200 PATCH "/api/books/$BOOK_ID" "$JAR" '{"title":"كتاب اختبار معدّل","unitName":"الوحدة الأولى"}'

  expect "حساب ثانٍ لا يرى كتاب غيره" 404 GET "/api/books/$BOOK_ID" "$OTHER_JAR"
  expect "منع رفع كتاب بلا اسم" 400 POST /api/books "$JAR" '{"title":""}'

  expect "إعادة معالجة الكتاب" 202 POST "/api/books/$BOOK_ID/reprocess" "$JAR"
  check_code "اكتملت إعادة المعالجة" ready "$(wait_ready "$BOOK_ID" 45)"

  expect "حذف الكتاب" 200 DELETE "/api/books/$BOOK_ID" "$JAR"
  expect "الكتاب محذوف فعلًا" 404 GET "/api/books/$BOOK_ID" "$JAR"
else
  echo "SKIP: اختبارات الكتب (ملف PDF التجريبي غير موجود؛ شغّل: node scripts/make-test-fixtures.mjs)"
fi

if [ -f "$IMG_FILE" ]; then
  CODE=$(upload_book "كتاب صور" "$IMG_FILE")
  check_code "رفع صفحة مصورة" 201 "$CODE"
  IMG_BOOK=$(json 'book.id' 2>/dev/null || echo '')
  IMG_STATUS=$(wait_ready "$IMG_BOOK" 120)
  check_code "اكتملت معالجة الصورة بـ OCR" ready "$IMG_STATUS"
  if [ "$IMG_STATUS" = ready ]; then
    curl -s -b "$JAR" "$BASE/api/books/$IMG_BOOK/pages/1" -o "$BODY"
    if grep -qi 'NERD' "$BODY"; then ok "نص OCR مقروء"; else bad "نص OCR مقروء" "$(head -c 200 "$BODY")"; fi
  fi
  curl -s -o /dev/null -b "$JAR" -X DELETE "$BASE/api/books/$IMG_BOOK"
else
  echo "SKIP: اختبار OCR للصور (الملف التجريبي غير موجود؛ شغّل: python3 scripts/make-test-image.py)"
fi

expect "كتب الحساب الثاني فارغة" 200 GET /api/books "$OTHER_JAR"
OTHER_BOOKS=$(json 'books.length')
if [ "${OTHER_BOOKS:-1}" = "0" ]; then ok "لا تسريب لكتب المستخدمين الآخرين"; else bad "عزل الكتب" "عدد الكتب: $OTHER_BOOKS"; fi

echo "== الاختبارات اليدوية (بلا مزوّد) =="
expect "إنشاء اختبار يدوي بلا مزوّد" 201 POST /api/tests/manual "$JAR" \
  '{"title":"اختبار يدوي تجريبي","difficulty":"easy","questions":[{"type":"mcq","text":"ما ناتج جمع 2 + 3؟","options":["4","5","6"],"correctIndex":1,"explanation":"جمع بسيط"},{"type":"true_false","text":"الأرض مسطحة تمامًا.","correctIndex":1},{"type":"short","text":"اكتب عاصمة المملكة العربية السعودية","answer":"الرياض"}]}'
MANUAL_ID=$(json 'test.id' 2>/dev/null || echo '')
MANUAL_Q=$(json 'test.questions.length' 2>/dev/null || echo 0)
if [ "${MANUAL_Q:-0}" = "3" ]; then ok "الاختبار اليدوي يحفظ ثلاثة أسئلة"; else bad "أسئلة الاختبار اليدوي" "$MANUAL_Q — $(head -c 200 "$BODY")"; fi
if grep -q '"isCorrect"\|correctAnswer' "$BODY"; then
  bad "عدم كشف إجابات الاختبار اليدوي" "الاستجابة تحتوي حقول الإجابة الصحيحة"
else
  ok "إجابات الاختبار اليدوي غير مكشوفة قبل التسليم"
fi
MANUAL_ANSWERS=$(node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const questions = data.test?.questions ?? [];
  const findId = (question, text) => question.options.find((option) => option.text === text)?.id;
  const answers = questions.map((question) => {
    if (question.type === "short") return { questionId: question.id, text: "  الرياض  " };
    if (question.type === "true_false") return { questionId: question.id, optionId: findId(question, "خطأ") };
    return { questionId: question.id, optionId: findId(question, "5") };
  });
  console.log(JSON.stringify({ answers }));
' "$BODY")
expect "بدء محاولة على الاختبار اليدوي" 201 POST "/api/tests/$MANUAL_ID/attempts" "$JAR"
MANUAL_ATTEMPT=$(json 'attempt.id' 2>/dev/null || echo '')
expect "تسليم الاختبار اليدوي" 200 POST "/api/tests/$MANUAL_ID/attempts/$MANUAL_ATTEMPT/submit" "$JAR" "$MANUAL_ANSWERS"
MANUAL_SCORE=$(json 'summary.score' 2>/dev/null || echo '')
if [ "$MANUAL_SCORE" = "100" ]; then
  ok "تصحيح تام للاختيار وصح/خطأ والإجابة القصيرة بعد تطبيع النص"
else
  bad "تصحيح الاختبار اليدوي" "$MANUAL_SCORE — $(head -c 200 "$BODY")"
fi
expect "رفض اختبار يدوي فيه سؤال ناقص" 422 POST /api/tests/manual "$JAR" \
  '{"questions":[{"type":"mcq","text":"سؤال بخيارين فقط؟","options":["أ","ب"],"correctIndex":0}]}'
expect "حذف الاختبار اليدوي" 200 DELETE "/api/tests/$MANUAL_ID" "$JAR"

echo "== بنك الأسئلة =="
expect "إنشاء اختبار يدوي لتغذية البنك" 201 POST /api/tests/manual "$JAR" \
  '{"title":"بنك الأسئلة","questions":[{"type":"mcq","text":"ما عاصمة الأردن؟","options":["عمّان","إربد","الزرقاء"],"correctIndex":0},{"type":"short","text":"اكتب تعريف الخلية","answer":"وحدة بناء الكائن الحي"}]}'
BANK_SOURCE_TEST=$(json 'test.id' 2>/dev/null || echo '')
expect "بنك الأسئلة يعرض الأسئلة المحفوظة" 200 GET /api/bank "$JAR"
BANK_TOTAL=$(json 'total' 2>/dev/null || echo 0)
if [ "${BANK_TOTAL:-0}" -ge 2 ]; then ok "أسئلة الاختبار ظهرت في البنك"; else bad "عدد أسئلة البنك" "$BANK_TOTAL"; fi
BANK_Q=$(node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const found = (data.questions ?? []).find((q) => q.type === "mcq" && (q.options ?? []).length >= 2);
  console.log(found ? found.id : "");
' "$BODY")
if [ -n "$BANK_Q" ]; then ok "البنك يعرض الخيارات والإجابة الصحيحة"; else bad "خيارات سؤال البنك" "$(head -c 200 "$BODY")"; fi
if [ -n "$BANK_Q" ]; then
  expect "بناء اختبار من سؤال محفوظ" 201 POST /api/bank/tests "$JAR" "{\"questionIds\":[$BANK_Q]}"
  BANK_NEW_TEST=$(json 'test.id' 2>/dev/null || echo '')
  expect "رفض حذف سؤال داخل اختبار محفوظ" 409 DELETE "/api/bank/questions/$BANK_Q" "$JAR"
  if [ -n "$BANK_NEW_TEST" ] && [ "$BANK_NEW_TEST" != "undefined" ]; then
    expect "حذف اختبار البنك" 200 DELETE "/api/tests/$BANK_NEW_TEST" "$JAR"
  fi
  if [ -n "$BANK_SOURCE_TEST" ] && [ "$BANK_SOURCE_TEST" != "undefined" ]; then
    expect "حذف الاختبار اليدوي المصدر" 200 DELETE "/api/tests/$BANK_SOURCE_TEST" "$JAR"
  fi
  expect "حذف السؤال بعد زوال الاختبارات" 200 DELETE "/api/bank/questions/$BANK_Q" "$JAR"
else
  bad "معرّف سؤال في البنك" "$(head -c 200 "$BODY")"
fi

echo "== الذكاء الاصطناعي =="
expect "حالة الذكاء الاصطناعي تعمل" 200 GET /api/ai/status "$JAR"
KEY_SOURCE=$(json 'keySource' 2>/dev/null || echo '')
if [ "$KEY_SOURCE" = "client" ]; then ok "الخادم يعلن أن المفتاح يأتي من متصفح المستخدم"; else bad "مصدر مفتاح AI" "$KEY_SOURCE"; fi
if [ "$(json 'configured' 2>/dev/null)" = "true" ]; then ok "الخادم يعلن جاهزية طبقة AI بلا مفتاح مالك"; else bad "جاهزية طبقة AI" "$(head -c 160 "$BODY")"; fi
# مفتاح الاختبار يُمرّر في ترويسة X-AI-Key فقط؛ لا يُطبع أبدًا في السجل
AI_KEY="${AI_KEY:-smoke-test-key-1234567890}"
AI_BOOK=""

if [ -f "$PDF_FILE" ]; then
  CODE=$(upload_book "كتاب الذكاء الاصطناعي" "$PDF_FILE")
  if [ "$CODE" = "201" ]; then
    AI_BOOK=$(json 'book.id')
    AI_STATUS=$(wait_ready "$AI_BOOK" 45)
    if [ "$AI_STATUS" != "ready" ]; then bad "تجهيز كتاب للذكاء الاصطناعي" "$AI_STATUS"; fi
  else
    bad "رفع كتاب لاختبار الذكاء الاصطناعي" "$CODE $(head -c 160 "$BODY")"
  fi
fi

# بلا مفتاح: رفض صريح، ولا يُستخدم أي مفتاح بديل من الخادم
expect "طلب تلخيص بلا مفتاح يعطي 401" 401 POST /api/summaries "$JAR" "{\"bookId\":${AI_BOOK:-1},\"detailLevel\":\"short\"}"
if [ "$(json 'error.code' 2>/dev/null)" = "ai_key_missing" ]; then ok "رسالة المفتاح الناقص مميّزة برمز ai_key_missing"; else bad "رمز المفتاح الناقص" "$(head -c 200 "$BODY")"; fi
expect "مفتاح قصير غير صالح يعطي 401" 401 POST /api/summaries "$JAR" "{\"bookId\":${AI_BOOK:-1},\"detailLevel\":\"short\"}" 'X-AI-Key: short'
expect "اختبار المحادثة بلا مفتاح يعطي 401" 401 POST /api/ai/chat "$JAR" '{"question":"ما هذا الدرس؟"}'
expect "توليد اختبار بلا مفتاح يعطي 401" 401 POST /api/tests "$JAR" "{\"bookId\":${AI_BOOK:-1},\"count\":5}"
expect "التحقق من مفتاح غير صالح يعطي 401" 401 POST /api/ai/verify-key "$JAR" '{}' 'X-AI-Key: invalid-key-1234567890'
expect "التحقق من مفتاح صالح ينجح" 200 POST /api/ai/verify-key "$JAR" '{}' "X-AI-Key: $AI_KEY"
if [ "$(json 'ok' 2>/dev/null)" = "true" ]; then ok "التحقق الحقيقي من المفتاح يرجع ok"; else bad "تحقق المفتاح" "$(head -c 200 "$BODY")"; fi
if [ "$(json 'verification' 2>/dev/null)" = "phrase" ]; then ok "التحقق يتم بكتابة النموذج عبارة التحقق"; else bad "طريقة التحقق" "$(head -c 200 "$BODY")"; fi
if [ "$(json 'phrase' 2>/dev/null)" = "انشر التطبيق لمساعدة الآخرين" ]; then ok "عبارة التحقق المُعادة مطابقة"; else bad "عبارة التحقق" "$(head -c 200 "$BODY")"; fi
if [ "${MOCK_AI:-0}" = "1" ]; then
  expect "حد استخدام المزوّد يعطي 429" 429 POST /api/ai/verify-key "$JAR" '{}' 'X-AI-Key: rate-limited-1234567890'
  expect "نفاد رصيد المفتاح يعطي 402" 402 POST /api/ai/verify-key "$JAR" '{}' 'X-AI-Key: quota-exceeded-1234567890'
  if [ "$(json 'error.code' 2>/dev/null)" = "ai_quota_exhausted" ]; then ok "رسالة نفاد الرصيد مميّزة برمز ai_quota_exhausted"; else bad "رمز نفاد الرصيد" "$(head -c 200 "$BODY")"; fi
  expect "مفتاح لا يكتب عبارة التحقق يُرفض" 422 POST /api/ai/verify-key "$JAR" '{}' 'X-AI-Key: no-phrase-key-1234567890'
  if [ "$(json 'error.code' 2>/dev/null)" = "ai_verification_failed" ]; then ok "سبب فشل كتابة العبارة مميّز برمز ai_verification_failed"; else bad "رمز فشل التحقق" "$(head -c 200 "$BODY")"; fi
fi

USE_AI_KEY=1

echo "== الدردشة الحرة و«اسأل المعلم» =="
expect "دردشة حرة بلا كتاب أو محتوى" 201 POST /api/ai/chat "$JAR" '{"question":"لماذا السماء زرقاء؟"}'
GENERAL_CONV=$(json 'conversation.id' 2>/dev/null || echo '')
if [ "$(json 'message.content' 2>/dev/null)" != "" ] && [ "$(json 'message.sources.length' 2>/dev/null)" = "0" ]; then
  ok "الدردشة تجيب بلا مصادر ولا تختلق مراجع"
else
  bad "إجابة الدردشة الحرة" "$(head -c 240 "$BODY")"
fi
if [ -n "$GENERAL_CONV" ] && [ "$GENERAL_CONV" != "undefined" ]; then
  expect "متابعة الدردشة الحرة بالسياق" 201 POST /api/ai/chat "$JAR" "{\"question\":\"أضف مثالًا بسيطًا.\",\"conversationId\":$GENERAL_CONV}"
  expect "حذف محادثة الدردشة" 200 DELETE "/api/ai/conversations/$GENERAL_CONV" "$JAR"
fi
expect "درس تفاعلي بلا مصدر" 201 POST /api/ai/teacher-lesson "$JAR" '{"question":"ما أسباب الحرب العالمية الثانية؟"}'
LESSON_TITLE=$(json 'lesson.lessonTitle' 2>/dev/null || echo '')
LESSON_SECTIONS=$(json 'lesson.sections.length' 2>/dev/null || echo 0)
if [ -n "$LESSON_TITLE" ] && [ "${LESSON_SECTIONS:-0}" -ge 3 ] && [ "${LESSON_SECTIONS:-0}" -le 8 ]; then
  ok "الدرس التفاعلي يعود بعنوان وأقسام"
else
  bad "بنية الدرس التفاعلي" "$(head -c 240 "$BODY")"
fi
if [ "$(json 'lesson.sourceTitle' 2>/dev/null)" = "null" ] || [ "$(json 'lesson.sourceTitle' 2>/dev/null)" = "undefined" ]; then
  ok "الدرس العام لا يدّعي مصدرًا"
else
  bad "مصدر الدرس العام" "$(json 'lesson.sourceTitle' 2>/dev/null)"
fi

if [ -n "$AI_BOOK" ]; then
  curl -s -b "$JAR" -H "X-AI-Key: $AI_KEY" "$BASE/api/ai/context?bookId=$AI_BOOK&q=study%20plan" -o "$BODY"
  RAG_COUNT=$(json 'results.length' 2>/dev/null || echo 0)
  if [ "${RAG_COUNT:-0}" -gt 0 ]; then ok "استرجاع المقاطع (RAG) من الكتاب"; else bad "استرجاع المقاطع" "$(head -c 200 "$BODY")"; fi
  if [ "$(json 'results.0.pageFrom' 2>/dev/null)" = "0" ]; then bad "أرقام الصفحات في نتائج الاسترجاع" "0"; else ok "أرقام الصفحات في نتائج الاسترجاع"; fi

  expect "توليد ملخص للكتاب" 201 POST /api/summaries "$JAR" "{\"bookId\":$AI_BOOK,\"detailLevel\":\"medium\"}"
  SUMMARY_ID=$(json 'summary.id' 2>/dev/null || echo '')
  PAGES_COUNT=$(json 'summary.pages.length' 2>/dev/null || echo 0)
  if [ "${PAGES_COUNT:-0}" -gt 0 ]; then ok "الملخص يحمل مراجع صفحات"; else bad "مراجع صفحات الملخص" "$PAGES_COUNT"; fi
  if [ "$(json 'summary.content' 2>/dev/null)" != "" ]; then ok "نص الملخص قادم من المزوّد"; else bad "نص الملخص" "$(head -c 160 "$BODY")"; fi
  if [ "${EXPECT_COST:-0}" = "1" ]; then
    COST=$(json 'usage.costUsd' 2>/dev/null || echo 0)
    if node -e "process.exit(Number(process.argv[1]) > 0 ? 0 : 1)" "$COST"; then ok "حساب التكلفة من الرموز"; else bad "حساب التكلفة" "$COST"; fi
  fi

  # المصدر الوهمي يعيد عمدًا مرجعًا للصفحة 999 لاختبار حذف المراجع خارج النطاق.
  ORIGINAL_AI_KEY="$AI_KEY"
  AI_KEY="offpage-key-1234567890"
  expect "ملخص من مزوّد يعيد مرجعًا خارج النطاق" 201 POST /api/summaries "$JAR" "{\"bookId\":$AI_BOOK,\"detailLevel\":\"short\"}"
  OFF_SUMMARY_ID=$(json 'summary.id' 2>/dev/null || echo '')
  OFF_CITE=$(node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const text = data.summary?.content ?? "";
    console.log(text.includes("999") ? "bad" : text.includes("ص 1") ? "ok" : "no-valid");
  ' "$BODY")
  if [ "$OFF_CITE" = "ok" ]; then ok "الملخص يحذف المرجع خارج النطاق ويبقي مرجعًا صحيحًا"; else bad "تنقية مراجع الملخص" "$OFF_CITE $(head -c 160 "$BODY")"; fi
  if [ -n "$OFF_SUMMARY_ID" ] && [ "$OFF_SUMMARY_ID" != "undefined" ]; then
    expect "حذف ملخص اختبار المراجع" 200 DELETE "/api/summaries/$OFF_SUMMARY_ID" "$JAR"
  fi

  expect "اختبار من مزوّد يعيد صفحة خارج النطاق" 201 POST /api/tests "$JAR" "{\"bookId\":$AI_BOOK,\"count\":3,\"types\":[\"mcq\"]}"
  OFF_TEST_ID=$(json 'test.id' 2>/dev/null || echo '')
  OFF_PAGES=$(node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const questions = data.test?.questions ?? [];
    console.log(questions.length > 0 && questions.every((question) => question.page === null) ? "ok" : "bad");
  ' "$BODY")
  if [ "$OFF_PAGES" = "ok" ]; then ok "الأسئلة ترفض الصفحة خارج نطاق المقاطع"; else bad "التحقق من صفحات الأسئلة" "$OFF_PAGES $(head -c 200 "$BODY")"; fi
  if [ -n "$OFF_TEST_ID" ] && [ "$OFF_TEST_ID" != "undefined" ]; then
    expect "حذف اختبار التحقق من الصفحات" 200 DELETE "/api/tests/$OFF_TEST_ID" "$JAR"
  fi
  AI_KEY="$ORIGINAL_AI_KEY"

  expect "ملخص بمحور محدد (RAG)" 201 POST /api/summaries "$JAR" "{\"bookId\":$AI_BOOK,\"detailLevel\":\"short\",\"focus\":\"study plan\"}"
  TOPIC_ID=$(json 'summary.id' 2>/dev/null || echo '')
  if [ "$(json 'summary.kind' 2>/dev/null)" = "topic" ]; then ok "تصنيف ملخص المحور"; else bad "تصنيف ملخص المحور" "$(json 'summary.kind' 2>/dev/null)"; fi

  expect "قائمة الملخصات" 200 GET /api/summaries "$JAR"
  LIST_COUNT=$(json 'summaries.length' 2>/dev/null || echo 0)
  if [ "${LIST_COUNT:-0}" -ge 2 ]; then ok "الملخصات محفوظة في الحساب"; else bad "حفظ الملخصات" "$LIST_COUNT"; fi
  expect "قراءة ملخص واحد" 200 GET "/api/summaries/$SUMMARY_ID" "$JAR"
  expect "حساب آخر لا يقرأ الملخص" 404 GET "/api/summaries/$SUMMARY_ID" "$OTHER_JAR"
  expect "رفض نطاق صفحات مقلوب" 400 POST /api/summaries "$JAR" "{\"bookId\":$AI_BOOK,\"detailLevel\":\"short\",\"pageFrom\":9,\"pageTo\":2}"

  USED=$(curl -s -b "$JAR" "$BASE/api/ai/status" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).usedToday))")
  node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.prepare(\"UPDATE app_settings SET value = ? WHERE key='ai_daily_limit_per_user'\").run(String(process.argv[2]));" "${DATABASE_PATH:-data/nerd.db}" "$USED"
  expect "الحد اليومي يمنع الطلب الزائد (429)" 429 POST /api/summaries "$JAR" "{\"bookId\":$AI_BOOK,\"detailLevel\":\"short\"}"
  node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.prepare(\"UPDATE app_settings SET value = '30' WHERE key='ai_daily_limit_per_user'\").run();" "${DATABASE_PATH:-data/nerd.db}"
  expect "حذف ملخص" 200 DELETE "/api/summaries/$TOPIC_ID" "$JAR"

  # المحادثة عند تمرير كتاب كسياق اختياري
  expect "سؤال خارج المصدر يجاب من المعرفة العامة" 201 POST /api/ai/chat "$JAR" "{\"question\":\"زززززززززززز\",\"bookId\":$AI_BOOK}"
  if [ "$(json 'message.content' 2>/dev/null)" != "" ] && [ "$(json 'message.sources.length' 2>/dev/null)" = "0" ]; then
    ok "الإجابة عند غياب المصدر بلا مصادر مختلقة"
  else
    bad "الإجابة عند غياب المصدر" "$(head -c 200 "$BODY")"
  fi
  expect "بدء محادثة جديدة" 201 POST /api/ai/chat "$JAR" "{\"question\":\"what is the study plan\",\"bookId\":$AI_BOOK}"
  CONV_ID=$(json 'conversation.id' 2>/dev/null || echo '')
  SRC_COUNT=$(json 'message.sources.length' 2>/dev/null || echo 0)
  if [ "${SRC_COUNT:-0}" -gt 0 ]; then ok "الإجابة مربوطة بمصادر الصفحات"; else bad "مصادر إجابة المحادثة" "$SRC_COUNT"; fi
  expect "متابعة المحادثة نفسها" 201 POST /api/ai/chat "$JAR" "{\"question\":\"أضف تفصيلًا آخر\",\"conversationId\":$CONV_ID}"
  expect "قائمة محادثاتي" 200 GET /api/ai/conversations "$JAR"
  CONV_COUNT=$(json 'conversations.length' 2>/dev/null || echo 0)
  if [ "${CONV_COUNT:-0}" -ge 1 ]; then ok "حفظ المحادثات في الحساب"; else bad "حفظ المحادثات" "$CONV_COUNT"; fi
  expect "قراءة محادثة كاملة" 200 GET "/api/ai/conversations/$CONV_ID" "$JAR"
  MSG_COUNT=$(json 'messages.length' 2>/dev/null || echo 0)
  if [ "${MSG_COUNT:-0}" -ge 4 ]; then ok "تراكم رسائل المحادثة"; else bad "رسائل المحادثة" "$MSG_COUNT"; fi
  expect "حساب آخر لا يقرأ المحادثة" 404 GET "/api/ai/conversations/$CONV_ID" "$OTHER_JAR"
  expect "حذف المحادثة" 200 DELETE "/api/ai/conversations/$CONV_ID" "$JAR"

  # الاختبارات: توليد من الكتاب، ثم جلسة بمؤقت، ثم تصحيح على الخادم
  expect "إنشاء اختبار من الكتاب" 201 POST /api/tests "$JAR" \
    "{\"bookId\":$AI_BOOK,\"count\":5,\"difficulty\":\"easy\",\"types\":[\"mcq\",\"short\"]}"
  TEST_ID=$(json 'test.id' 2>/dev/null || echo '')
  if [ -z "$TEST_ID" ] || [ "$TEST_ID" = "undefined" ]; then
    bad "معرّف الاختبار بعد الإنشاء" "$(head -c 200 "$BODY")"
  else
    TEST_Q=$(json 'test.questions.length' 2>/dev/null || echo 0)
    if [ "${TEST_Q:-0}" -ge 3 ]; then ok "الاختبار يحتوي أسئلة مولّدة"; else bad "أسئلة الاختبار" "$TEST_Q"; fi
    if grep -q '"isCorrect"\|correctAnswer\|correctIndex' "$BODY"; then
      bad "عدم كشف الإجابات قبل التسليم" "الاستجابة تحتوي حقول الإجابة الصحيحة"
    else
      ok "الإجابات الصحيحة غير مكشوفة قبل التسليم"
    fi
    ANSWERS=$(node -e '
      const fs = require("fs");
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const questions = data.test?.questions ?? [];
      const answers = questions.map((question) =>
        question.type === "short"
          ? { questionId: question.id, text: "إجابة تجريبية" }
          : { questionId: question.id, optionId: question.options?.[0]?.id },
      ).filter((answer) => answer.optionId || answer.text);
      console.log(JSON.stringify({ answers }));
    ' "$BODY")
    expect "قائمة اختباراتي" 200 GET /api/tests "$JAR"
    TESTS_COUNT=$(json 'tests.length' 2>/dev/null || echo 0)
    if [ "${TESTS_COUNT:-0}" -ge 1 ]; then ok "الاختبار محفوظ في الحساب"; else bad "حفظ الاختبار" "$TESTS_COUNT"; fi
    expect "بدء محاولة اختبار" 201 POST "/api/tests/$TEST_ID/attempts" "$JAR"
    ATTEMPT_ID=$(json 'attempt.id' 2>/dev/null || echo '')
    ATTEMPT_TOTAL=$(json 'attempt.total' 2>/dev/null || echo 0)
    if [ "${ATTEMPT_TOTAL:-0}" = "${TEST_Q:-0}" ]; then ok "المحاولة تشمل كل الأسئلة"; else bad "عدد أسئلة المحاولة" "$ATTEMPT_TOTAL"; fi
    if [ -n "$ATTEMPT_ID" ] && [ "$ATTEMPT_ID" != "undefined" ]; then
      expect "تسليم الإجابات وتصحيحها" 200 POST "/api/tests/$TEST_ID/attempts/$ATTEMPT_ID/submit" "$JAR" "$ANSWERS"
      SCORE=$(json 'summary.score' 2>/dev/null || echo '')
      if node -e 'const s=Number(process.argv[1]);process.exit(Number.isFinite(s)&&s>=0&&s<=100?0:1)' "$SCORE"; then ok "النتيجة محسوبة على الخادم"; else bad "درجة الاختبار" "$SCORE"; fi
      expect "رفض تسليم المحاولة مرتين" 409 POST "/api/tests/$TEST_ID/attempts/$ATTEMPT_ID/submit" "$JAR" "$ANSWERS"
      expect "مراجعة نتيجة الاختبار" 200 GET "/api/tests/$TEST_ID/attempts/$ATTEMPT_ID" "$JAR"
      CORRECT_TEXT=$(json 'questions.0.correctAnswer' 2>/dev/null || echo '')
      if [ -n "$CORRECT_TEXT" ] && [ "$CORRECT_TEXT" != "null" ]; then ok "المراجعة تعرض الإجابة الصحيحة"; else bad "الإجابة الصحيحة في المراجعة" "$(head -c 200 "$BODY")"; fi
    else
      bad "معرّف المحاولة بعد البدء" "$(head -c 200 "$BODY")"
    fi
    expect "حساب آخر لا يقرأ الاختبار" 404 GET "/api/tests/$TEST_ID" "$OTHER_JAR"
    expect "حذف الاختبار" 200 DELETE "/api/tests/$TEST_ID" "$JAR"
    expect "الاختبار محذوف فعلًا" 404 GET "/api/tests/$TEST_ID" "$JAR"
  fi
else
  echo "SKIP: تدفق AI الكامل (لا يوجد كتاب جاهز للاختبار)"
fi
USE_AI_KEY=0

if [ -n "$AI_BOOK" ]; then curl -s -o /dev/null -b "$JAR" -X DELETE "$BASE/api/books/$AI_BOOK"; fi

echo "== محتواي الدراسي =="
expect "محتوى بلا حساب مرفوض" 401 GET /api/contents -
expect "إنشاء محتوى نصي" 201 POST /api/contents "$JAR" \
  "{\"title\":\"درس اختبار المحتوى\",\"text\":\"درجة التجمد تنخفض عند إضافة مادة مذابة. كلما زاد عدد الجزيئات المذابة انخفضت درجة التجمد. يستخدم هذا المبدأ في إذابة الجليد على الطرق.\",\"sourceType\":\"text\"}"
CONTENT_ID=$(json 'content.id' 2>/dev/null || echo '')
if [ -n "$CONTENT_ID" ] && [ "$CONTENT_ID" != "undefined" ]; then
  CONTENT_STATUS=""
  for _ in $(seq 1 20); do
    curl -s -o "$BODY" -b "$JAR" "$BASE/api/contents/$CONTENT_ID"
    CONTENT_STATUS=$(json 'content.status' 2>/dev/null || echo '')
    case "$CONTENT_STATUS" in ready|needs_review|failed) break;; esac
    sleep 0.5
  done
  if [ "$CONTENT_STATUS" = "ready" ] || [ "$CONTENT_STATUS" = "needs_review" ]; then
    ok "معالجة المحتوى النصي تكتمل"
  else
    bad "معالجة المحتوى النصي" "$CONTENT_STATUS — $(head -c 200 "$BODY")"
  fi
  if [ -n "${AI_KEY:-}" ]; then
    USE_AI_KEY=1
    expect "درس تفاعلي من محتوى مرفوع" 201 POST /api/ai/teacher-lesson "$JAR" \
      "{\"question\":\"درجة التجمد والمادة المذابة\",\"contentId\":$CONTENT_ID}"
    SOURCE_LESSON_TITLE=$(json 'lesson.sourceTitle' 2>/dev/null || echo '')
    SOURCE_LESSON_SECTIONS=$(json 'lesson.sections.length' 2>/dev/null || echo 0)
    SOURCE_CITATIONS=$(json 'sources.length' 2>/dev/null || echo 0)
    if [ -n "$SOURCE_LESSON_TITLE" ] && [ "$SOURCE_LESSON_TITLE" != "null" ] && [ "${SOURCE_LESSON_SECTIONS:-0}" -ge 3 ] && [ "${SOURCE_LESSON_SECTIONS:-0}" -le 8 ]; then
      ok "درس المحتوى يحمل مصدره وأقسامه"
    else
      bad "درس المحتوى المرفوع" "$(head -c 240 "$BODY")"
    fi
    if [ "${SOURCE_CITATIONS:-0}" -gt 0 ]; then ok "درس المحتوى يعيد مراجع الصفحات"; else bad "مراجع درس المحتوى" "$SOURCE_CITATIONS"; fi
    USE_AI_KEY=0
  fi
  expect "مكتبة المحتوى تعرض الدرس" 200 GET /api/contents "$JAR"
  CONTENT_LISTED=$(json 'contents.0.id' 2>/dev/null || echo '')
  if [ "$CONTENT_LISTED" = "$CONTENT_ID" ]; then ok "المحتوى محفوظ في المكتبة"; else bad "حفظ المحتوى" "$CONTENT_LISTED"; fi
  expect "تفاصيل المحتوى" 200 GET "/api/contents/$CONTENT_ID" "$JAR"
  PAGE_ID=$(json 'pages.0.id' 2>/dev/null || echo '')
  if [ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "undefined" ]; then
    expect "النص المستخرج الكامل" 200 GET "/api/contents/$CONTENT_ID/pages/$PAGE_ID/text" "$JAR"
  else
    bad "صفحات المحتوى" "$(head -c 200 "$BODY")"
  fi
  expect "تعديل بيانات المحتوى" 200 PATCH "/api/contents/$CONTENT_ID" "$JAR" \
    "{\"title\":\"درس اختبار المحتوى بعد التعديل\"}"
  expect "حساب آخر لا يقرأ المحتوى" 404 GET "/api/contents/$CONTENT_ID" "$OTHER_JAR"
  expect "حذف المحتوى" 200 DELETE "/api/contents/$CONTENT_ID" "$JAR"
  expect "المحتوى محذوف فعلًا" 404 GET "/api/contents/$CONTENT_ID" "$JAR"
else
  bad "إنشاء المحتوى" "$(head -c 200 "$BODY")"
fi

echo "== المشرف =="
echo "(يفترض أن حساب المشرف أُنشئ مسبقًا بالأمر: npm run admin:create -- <email> <password>)"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  expect "دخول المشرف" 200 POST /api/auth/login "$ADMIN_JAR" \
    "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"remember\":false}"
  expect "المشرف يرى الإحصائيات" 200 GET /api/admin/overview "$ADMIN_JAR"
  expect "المشرف يرى المستخدمين" 200 GET /api/admin/users "$ADMIN_JAR"
  expect "سجل الإدارة يعمل" 200 GET /api/admin/logs "$ADMIN_JAR"
  expect "استهلاك الذكاء الاصطناعي يعمل" 200 GET /api/admin/ai-usage "$ADMIN_JAR"
  SELF_ID=$(json "user.id")
  expect "منع المشرف من تعديل حسابه" 400 PATCH "/api/admin/users/$SELF_ID" "$ADMIN_JAR" '{"role":"admin"}'
else
  echo "SKIP: اختبار لوحة الإدارة (ADMIN_PASSWORD غير محدد)"
fi

echo "== الحذف والجلسات =="
# إعادة التعيين أنهت كل الجلسات السابقة (سلوك مقصود)، لذا نعيد الدخول أولًا.
expect "إعادة الدخول بعد تغيير كلمة المرور" 200 POST /api/auth/login "$JAR" \
  "{\"email\":\"$EMAIL\",\"password\":\"NewPassw0rd1\",\"remember\":false}"
expect "منع حذف الحساب بكلمة مرور خاطئة" 400 DELETE /api/account "$JAR" '{"password":"WrongPass9"}'
expect "تسجيل الخروج" 200 POST /api/auth/logout "$JAR"
expect "الجلسة انتهت بعد الخروج" 401 GET /api/auth/me "$JAR"

echo
echo "النتيجة: نجح $PASS — فشل $FAIL"
rm -f "$JAR" "$ADMIN_JAR" "$OTHER_JAR" "$BODY"
[ "$FAIL" -eq 0 ]
