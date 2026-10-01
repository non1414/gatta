-- ============================================================================
-- 00000000000001_baseline_legacy_schema.sql
--
-- ⚠️ اختبار محلي فقط — لا تُشغَّل هذه الملف على الإنتاج.
-- تُعيد بناء الشكل الحالي (الأفضل معرفةً لدينا من الكود) لجدولي splits/members
-- كما هما في الإنتاج اليوم، فقط لكي تُختبر migration الترحيل الفعلية (00000000000002)
-- على بيانات بنفس شكل الإنتاج قبل تطبيقها. جدول splits/members الحقيقيان
-- موجودان بالفعل في الإنتاج ولا يحتاجان هذا الملف هناك.
-- ============================================================================

create table splits (
  id             text primary key,
  title          text not null,
  total          numeric not null,
  people         integer not null default 2,
  fee_per_person numeric not null default 0,
  event_at       timestamptz not null,
  created_at     bigint not null,
  bank_name      text,
  iban           text
);

create table members (
  id         text primary key,
  split_id   text not null references splits(id),
  name       text not null default '',
  paid       boolean not null default false,
  created_at bigint not null
);

-- بيانات وهمية تمثّل "قطّات قديمة" حقيقية الشكل، لاختبار الترحيل والعرض للقراءة فقط
insert into splits (id, title, total, people, event_at, created_at, bank_name, iban) values
  ('legacy-1', 'رحلة أبها القديمة', 1200, 8, now() + interval '3 days', extract(epoch from now())*1000, 'بنك الراجحي', 'SA0000000000000000000001'),
  ('legacy-2', 'عشاء تخرج', 450, 3, now() - interval '10 days', extract(epoch from now())*1000, null, null);

insert into members (id, split_id, name, paid, created_at) values
  ('legacy-1-m1','legacy-1','نوف', true, extract(epoch from now())*1000),
  ('legacy-1-m2','legacy-1','سارة', true, extract(epoch from now())*1000),
  ('legacy-1-m3','legacy-1','ريم', false, extract(epoch from now())*1000),
  ('legacy-1-m4','legacy-1','', false, extract(epoch from now())*1000),
  ('legacy-1-m5','legacy-1','', false, extract(epoch from now())*1000),
  ('legacy-1-m6','legacy-1','', false, extract(epoch from now())*1000),
  ('legacy-1-m7','legacy-1','', false, extract(epoch from now())*1000),
  ('legacy-1-m8','legacy-1','', false, extract(epoch from now())*1000),
  ('legacy-2-m1','legacy-2','بدر', true, extract(epoch from now())*1000),
  ('legacy-2-m2','legacy-2','', false, extract(epoch from now())*1000),
  ('legacy-2-m3','legacy-2','', false, extract(epoch from now())*1000);
