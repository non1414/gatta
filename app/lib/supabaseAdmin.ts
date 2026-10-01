import { createClient, SupabaseClient } from "@supabase/supabase-js"

// خادم فقط — يُستورد حصرًا من app/api/**/route.ts (Route Handlers لا تُضمَّن
// أبدًا في حزمة المتصفح). لا تستورديه من أي مكوّن "use client".
// SUPABASE_SERVICE_ROLE_KEY متعمَّد بلا بادئة NEXT_PUBLIC_ حتى لا يصل للمتصفح.
//
// تهيئة كسولة (lazy) عمدًا: إنشاء العميل عند أول استخدام فعلي داخل معالج
// طلب، لا عند تحميل الوحدة — لأن Next.js يستورد كل route.ts أثناء البناء
// لجمع بيانات الصفحات، وإنشاء عميل فورًا بمفتاح غائب محليًا يُفشل البناء
// كله حتى لو لم يُستدعَ أي مسار إدارة فعليًا.
let client: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY أو NEXT_PUBLIC_SUPABASE_URL غير مضبوطين — مسارات /api/manage/* تحتاجهما."
    )
  }

  client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  return client
}
