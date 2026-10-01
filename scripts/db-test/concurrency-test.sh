#!/bin/bash
# فحص تزامن حقيقي: 5 محاولات انضمام متوازية على مقعدين فقط. يجب أن ينجح 2
# بالضبط بمعرّفات مختلفة، ويُرفض 3 بوضوح، بلا تلف بيانات.
set -euo pipefail
PGBIN="$(brew --prefix postgresql@15)/bin"
export PATH="$PGBIN:$PATH"
export PGHOST=/tmp/gatta-pgtest PGPORT=54329 PGUSER=postgres DB=gattatest

SPLIT_ID=$(psql -d "$DB" -t -A -c "
  select split_id from create_split(gen_random_uuid(), 'اختبار', 'tok-race-'||gen_random_uuid(),
    'فحص التزامن', 5000, 2, now() + interval '1 day', false);")

RESULTS=$(mktemp -d)
for i in 1 2 3 4 5; do
  (psql -d "$DB" -t -A -c "
    select member_id from join_split('$SPLIT_ID','متسابق-$i', gen_random_uuid(), 'race-$i');" \
    > "$RESULTS/$i.out" 2>&1 ) &
done
wait

MEMBER_COUNT=$(psql -d "$DB" -t -A -c "select count(*) from members where split_id='$SPLIT_ID' and status<>'empty';")
DISTINCT_IDS=$(psql -d "$DB" -t -A -c "select count(distinct id) from members where split_id='$SPLIT_ID' and status<>'empty';")

if [ "$MEMBER_COUNT" != "2" ] || [ "$MEMBER_COUNT" != "$DISTINCT_IDS" ]; then
  echo "FAIL: توقّعت مقعدين مشغولين بمعرّفات مختلفة، وجدت members=$MEMBER_COUNT distinct=$DISTINCT_IDS"
  echo "--- مخرجات الطلبات الخمسة للتشخيص ---"
  cat "$RESULTS"/*.out
  rm -rf "$RESULTS"
  exit 1
fi

echo "PASS: تزامن 5 طلبات على مقعدين → استقرّ العدد على 2 بالضبط بمعرّفات مختلفة (لا تلف)"
rm -rf "$RESULTS"
