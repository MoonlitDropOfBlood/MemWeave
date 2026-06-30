#!/bin/bash
# 轮询回填进度,完成或进程退出时退出
for i in $(seq 1 40); do  # 最多等 40*90s = 60 分钟
  sleep 90
  ENRICHED=$(node --no-warnings -e "
import('node:sqlite').then(({DatabaseSync}) => {
  const db = new DatabaseSync(require('os').homedir() + '/.memweave/data/memweave.db', { readOnly: true });
  const e = db.prepare(\"SELECT COUNT(*) c FROM memories WHERE deleted_at IS NULL AND concepts_json != '[]' AND concepts_json IS NOT NULL\").get();
  const t = db.prepare('SELECT COUNT(*) c FROM memories WHERE deleted_at IS NULL').get();
  console.log(e.c + '/' + t.c);
  db.close();
});
" 2>&1 | grep -v "ExperimentalWarning\|trace-warnings")
  ALIVE=$(ps -ef 2>/dev/null | grep backfill | grep -v grep | head -1)
  echo "[$(date +%H:%M)] enriched: $ENRICHED | alive: $([ -n "$ALIVE" ] && echo yes || echo NO)"
  if [ -z "$ALIVE" ]; then echo "进程退出"; break; fi
  REMAINING=$(echo $ENRICHED | cut -d'/' -f2)
  DONE=$(echo $ENRICHED | cut -d'/' -f1)
  if [ "$DONE" = "$REMAINING" ]; then echo "全部完成!"; break; fi
done
