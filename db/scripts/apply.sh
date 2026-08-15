#!/usr/bin/env bash
# db/schema 의 SQL 파일을 번호 순서대로 적용한다.
#
#   PGPASSWORD=devonly db/scripts/apply.sh
#
# 접속은 표준 PG* 환경변수로 받는다. 아래는 로컬 컨테이너 기본값이다.
# 순서가 계약이므로 한 파일이라도 실패하면 즉시 멈춘다.
set -euo pipefail

SCHEMA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../schema" && pwd)"

: "${PGHOST:=localhost}"
: "${PGPORT:=55432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=cage}"
export PGHOST PGPORT PGUSER PGDATABASE

count=0
for f in "$SCHEMA_DIR"/[0-9][0-9][0-9]_*.sql; do
  echo "==> $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f "$f"
  count=$((count + 1))
done

echo "OK: ${count} files applied to ${PGDATABASE}@${PGHOST}:${PGPORT}"
