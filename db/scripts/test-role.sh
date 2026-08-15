#!/usr/bin/env bash
# 골든 테스트가 애플리케이션 경로를 검증할 때 쓰는 로그인 역할을 만든다.
#
# 왜 필요한가: db/schema/012_roles_and_grants.sql 은 NOLOGIN 그룹 역할만 만든다.
# 로그인 역할 생성은 운영의 몫으로 주석 처리되어 있다 (012 하단). 테스트 전용
# 로그인 역할을 스키마 파일에 넣지 않고 여기서 만든다.
#
# 이 역할이 없으면 테스트가 소유자(postgres)로 붙고, 그러면 RLS 와 테이블 권한이
# 전부 우회되어 GRANT 실수·REVOKE 누락·지점 격리 실패가 초록으로 통과한다.
#
# 역할이 셋이고 서로 겹치지 않는 이유 — 012 가 세 경계를 나눠 놓았다:
#   ledger_app       자금 op_*. identity.step_up_tokens 에 INSERT·SELECT 둘 다 없다.
#   identity_app     step_up_tokens INSERT 전용. ledger 스키마는 USAGE 자체가 없다.
#   ledger_migrator  ledger.op_load_opening_balance 의 EXECUTE 가 여기에만 있다.
#
# 하나로 합치지 않는다. db/schema/012_roles_and_grants.sql:214 가 못박아 둔 문장이다 —
# "배포상 두 서비스가 서로 다른 DB 자격증명으로 접속해야 한다는 뜻이다.
#  같은 자격증명을 쓰면 이 분리가 무의미해진다." 한 로그인 역할이 ledger_app 과
# identity_app 을 함께 물려받으면 DR-03(발급자 ≠ 소비자)이 테스트에서 사라진다:
# 자금 경로가 자기 재인증 근거를 스스로 만들어 낼 수 있게 된다.
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=55432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=cage}"
: "${PGAPPUSER:=cage_test_app}"
: "${PGIDUSER:=cage_test_identity}"
: "${PGMIGUSER:=cage_test_migrator}"
: "${PGAPPPASSWORD:=devonly}"
export PGHOST PGPORT PGUSER PGDATABASE

# -----------------------------------------------------------------------------
# 대상 확인 — 이 스크립트는 **공개된 개발용 비밀번호로 로그인 역할 셋을 만들고**
# ledger_app · identity_app · ledger_migrator 를 부여한다. 그 대상은 위에서 본
# 대로 환경변수가 가리키는 곳이면 어디든이다. 셸에 남은 PGHOST 하나로 운영 DB에
# 자격증명이 심어질 수 있다 — 키 하나 차이의 실수이고 되돌리기는 훨씬 비싸다.
#
# 그래서 "테스트 대상임이 분명한 곳" 이 아니면 아무것도 하지 않는다:
#   1. 데이터베이스 이름이 기대값과 같아야 한다 (CAGE_TEST_DATABASE, 기본 cage)
#   2. 호스트가 루프백이어야 한다 — 로컬 컨테이너와 CI 서비스 컨테이너가 둘 다 그렇다
# 원격 테스트 DB 처럼 정당한 예외는 CAGE_ALLOW_TEST_ROLES=1 로 명시적으로 연다.
# 조건을 넓히지 않는다 — 넓히는 순간 이 검사는 있으나 마나다.
# -----------------------------------------------------------------------------
: "${CAGE_TEST_DATABASE:=cage}"
: "${CAGE_ALLOW_TEST_ROLES:=}"

if [ "${CAGE_ALLOW_TEST_ROLES}" != "1" ]; then
  refuse=""
  if [ "${PGDATABASE}" != "${CAGE_TEST_DATABASE}" ]; then
    refuse="PGDATABASE='${PGDATABASE}' 가 기대한 테스트 DB '${CAGE_TEST_DATABASE}' 가 아니다"
  fi
  case "${PGHOST}" in
    localhost | 127.0.0.1 | ::1 | /*) ;;
    *) refuse="${refuse:+${refuse}; }PGHOST='${PGHOST}' 가 루프백이 아니다" ;;
  esac
  if [ -n "${refuse}" ]; then
    cat >&2 <<EOF
거부: 테스트 로그인 역할을 만들 대상이 아니다 — ${refuse}

이 스크립트는 공개된 개발용 비밀번호로 로그인 역할 3종(${PGAPPUSER} ·
${PGIDUSER} · ${PGMIGUSER})을 만들고 ledger_app · identity_app · ledger_migrator
를 부여한다. 운영 DB 에 실행하면 그 자체가 사고다.

대상: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}

의도한 대상이 맞다면 셋 중 하나를 한다:
  PGDATABASE=cage            를 세운다 (기본 로컬 · CI 대상)
  CAGE_TEST_DATABASE=<이름>  로 기대하는 테스트 DB 이름을 바꾼다
  CAGE_ALLOW_TEST_ROLES=1    로 이 검사를 명시적으로 넘긴다 (원격 테스트 DB 등)
EOF
    exit 1
  fi
fi

# psql 변수는 달러 인용 본문 안에서 치환되지 않는다. DO $$ ... :'app_user' ... $$ 로
# 쓰면 콜론 토큰이 그대로 서버에 가서 죽는다. 확인한 사실이다:
#   ERROR:  syntax error at or near ":"
# 그래서 CREATE ROLE 문을 달러 인용 밖에서 만들고 \gexec 로 실행한다.
# 역할이 이미 있으면 SELECT 가 0행이라 \gexec 가 아무것도 실행하지 않는다 — 멱등이다.
#
# 주의: %L 로 비밀번호가 생성 문장에 들어간다. log_statement 가 켜진 서버라면
# 서버 로그에 남는다. PGAPPPASSWORD 는 개발·CI 컨테이너 전용 폐기값만 쓴다.
psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc \
  -v app_user="${PGAPPUSER}" -v id_user="${PGIDUSER}" -v mig_user="${PGMIGUSER}" \
  -v app_pw="${PGAPPPASSWORD}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'id_user', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'id_user')
\gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'mig_user', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'mig_user')
\gexec
GRANT ledger_app      TO :"app_user";
GRANT identity_app    TO :"id_user";
GRANT ledger_migrator TO :"mig_user";
SQL

echo "OK: ${PGAPPUSER}=ledger_app · ${PGIDUSER}=identity_app · ${PGMIGUSER}=ledger_migrator"
