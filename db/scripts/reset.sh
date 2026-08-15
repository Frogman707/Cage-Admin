#!/usr/bin/env bash
# 5개 스키마를 지우고 db/schema 를 처음부터 다시 적용한다.
#
#   PGPASSWORD=devonly db/scripts/reset.sh
#
# 대상 DB 의 ledger · cage · identity · audit · archive 스키마가 사라진다.
# 역할(ledger_app · ledger_read · ledger_relay …)은 클러스터 단위라 남는다.
# 012 의 역할 생성이 pg_roles 존재 검사로 감싸여 있어 재적용에 문제 없다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${PGHOST:=localhost}"
: "${PGPORT:=55432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=cage}"
export PGHOST PGPORT PGUSER PGDATABASE

echo "==> DROP SCHEMA ledger, cage, identity, audit, archive CASCADE"
psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc \
  -c 'DROP SCHEMA IF EXISTS ledger, cage, identity, audit, archive CASCADE;'

exec "${SCRIPT_DIR}/apply.sh"
