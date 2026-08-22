/* ============================================================
   CAGE ADMIN 5.0 — shared 6-language i18n. ko/en/zhHant/zhHans/ja/vi.
   Covers the player-facing Avatar/Speed site and Agent Admin (an
   agent's own staff may not all read Korean). Partner Admin and the
   Cage app stay Korean-only internal tools and are not covered here.

   Chinese is two languages here, not one. It was a single 中文 written
   in simplified characters, which is the mainland's script and is not
   what a player in Taiwan, Hong Kong or Macau reads - and those are
   the rooms this floor plays to. Traditional is its own entry now.
   ============================================================ */

/* The order here is the order of the picker. */
const I18N_FLAG = {ko:'🇰🇷', en:'🇬🇧', zhHant:'🇹🇼', zhHans:'🇨🇳', ja:'🇯🇵', vi:'🇻🇳'};
const I18N_NATIVE = {ko:'한국어', en:'English', zhHant:'繁體中文', zhHans:'简体中文', ja:'日本語', vi:'Tiếng Việt'};

/* Anyone already reading the site in Chinese chose it when there was only one of them, and the
   one they got was simplified - so that is what 'zh' means when it comes back off this device. */
function readStoredLang(){
  const saved = localStorage.getItem('cageLang');
  if (saved === 'zh') return 'zhHans';
  return I18N_NATIVE[saved] ? saved : 'ko';
}
let I18N_LANG = readStoredLang();

const I18N_DICT = {
  // ---- login / signup ----
  loginId:{ko:'아이디',zhHans:'账号',zhHant:'帳號',en:'ID',ja:'ID',vi:'ID'},
  loginPw:{ko:'비밀번호',zhHans:'密码',zhHant:'密碼',en:'Password',ja:'パスワード',vi:'Mật khẩu'},
  loginBtn:{ko:'로그인',zhHans:'登录',zhHant:'登入',en:'Login',ja:'ログイン',vi:'Đăng nhập'},
  noAccountQ:{ko:'계정이 없으신가요?',zhHans:'还没有账号？',zhHant:'還沒有帳號？',en:"Don't have an account?",ja:'アカウントをお持ちでない方',vi:'Chưa có tài khoản?'},
  signupLink:{ko:'회원가입',zhHans:'注册',zhHant:'註冊',en:'Sign up',ja:'会員登録',vi:'Đăng ký'},
  demoHint:{ko:'데모 계정은 파트너 어드민에서 "데모 데이터 생성" 후 유저리스트의 ID (PW: 0000)로 로그인할 수 있습니다.',zhHans:'演示账号：在合作伙伴管理后台点击"生成演示数据"后，可用用户列表中的 ID（密码：0000）登录。',zhHant:'演示帳號：在合作伙伴管理後臺點選"生成演示資料"後，可用使用者列表中的 ID（密碼：0000）登入。',en:'Demo accounts: click "Generate Demo Data" in Partner Admin, then log in with any ID from the user list (password: 0000).',ja:'デモアカウント：パートナー管理画面で「デモデータ生成」後、ユーザーリストのID（PW: 0000）でログインできます。',vi:'Tài khoản demo: nhấn "Tạo dữ liệu demo" trong Partner Admin, sau đó đăng nhập bằng ID trong danh sách người dùng (mật khẩu: 0000).'},
  haveAccountQ:{ko:'이미 계정이 있으신가요?',zhHans:'已有账号？',zhHant:'已有帳號？',en:'Already have an account?',ja:'すでにアカウントをお持ちですか？',vi:'Đã có tài khoản?'},
  loginErrNotfound:{ko:'존재하지 않는 계정입니다.',zhHans:'账号不存在。',zhHant:'帳號不存在。',en:'Account not found.',ja:'アカウントが存在しません。',vi:'Không tìm thấy tài khoản.'},
  loginErrBlocked:{ko:'이용이 제한된 계정입니다.',zhHans:'该账号已被限制使用。',zhHant:'該帳號已被限制使用。',en:'This account has been restricted.',ja:'このアカウントは利用制限されています。',vi:'Tài khoản này đã bị hạn chế.'},
  loginErrBadPw:{ko:'비밀번호가 일치하지 않습니다.',zhHans:'密码不正确。',zhHant:'密碼不正確。',en:'Incorrect password.',ja:'パスワードが一致しません。',vi:'Mật khẩu không đúng.'},
  loginErrRequired:{ko:'ID/비밀번호를 입력하세요.',zhHans:'请输入账号和密码。',zhHant:'請輸入帳號和密碼。',en:'Please enter your ID and password.',ja:'IDとパスワードを入力してください。',vi:'Vui lòng nhập ID và mật khẩu.'},

  suGenId:{ko:'신규 ID 생성',zhHans:'生成新账号',zhHant:'生成新帳號',en:'Generate ID',ja:'新規ID発行',vi:'Tạo ID mới'},
  suIdPh:{ko:'위 버튼을 눌러 ID를 생성해 주세요',zhHans:'请点击上方按钮生成账号',zhHant:'請點選上方按鈕生成帳號',en:'Click the button above to generate an ID',ja:'上のボタンでIDを発行してください',vi:'Nhấn nút phía trên để tạo ID'},
  suPwGenerated:{ko:'자동 생성된 비밀번호입니다',zhHans:'系统自动生成的密码',zhHant:'系統自動生成的密碼',en:'Auto-generated password',ja:'自動生成されたパスワードです',vi:'Mật khẩu được tạo tự động'},
  suNick:{ko:'닉네임',zhHans:'昵称',zhHant:'暱稱',en:'Nickname',ja:'ニックネーム',vi:'Biệt danh'},
  suNickPh:{ko:'닉네임을 입력해 주세요',zhHans:'请输入昵称',zhHant:'請輸入暱稱',en:'Enter your nickname',ja:'ニックネームを入力してください',vi:'Nhập biệt danh'},
  suTelegram:{ko:'텔레그램 ID',zhHans:'Telegram 账号',zhHant:'Telegram 帳號',en:'Telegram ID',ja:'テレグラムID',vi:'ID Telegram'},
  suTelegramPh:{ko:'필수 입력 항목입니다',zhHans:'必填项',zhHant:'必填項',en:'Required',ja:'必須項目です',vi:'Bắt buộc nhập'},
  suPhone:{ko:'전화번호',zhHans:'电话号码',zhHant:'電話號碼',en:'Phone number',ja:'電話番号',vi:'Số điện thoại'},
  suSendCode:{ko:'인증번호 발송',zhHans:'发送验证码',zhHant:'傳送驗證碼',en:'Send code',ja:'認証番号送信',vi:'Gửi mã xác thực'},
  suCode:{ko:'인증번호 입력',zhHans:'输入验证码',zhHant:'輸入驗證碼',en:'Verification code',ja:'認証番号入力',vi:'Nhập mã xác thực'},
  suCodePh:{ko:'인증번호 6자리',zhHans:'6位验证码',zhHant:'6位驗證碼',en:'6-digit code',ja:'6桁の認証番号',vi:'Mã 6 chữ số'},
  suVerifyCode:{ko:'인증번호 확인',zhHans:'确认验证码',zhHant:'確認驗證碼',en:'Verify',ja:'認証確認',vi:'Xác nhận mã'},
  suCasino:{ko:'카지노',zhHans:'赌场',zhHant:'賭場',en:'Casino',ja:'カジノ',vi:'Sòng bạc'},
  suAgent:{ko:'추천인 코드 (선택)',zhHans:'推荐人代码（可选）',zhHant:'推薦人代碼（可選）',en:'Referral code (optional)',ja:'紹介者コード（任意）',vi:'Mã giới thiệu (tùy chọn)'},
  suSubmit:{ko:'가입하기',zhHans:'注册',zhHant:'註冊',en:'Sign up',ja:'登録する',vi:'Đăng ký'},
  suCancel:{ko:'취소',zhHans:'取消',zhHant:'取消',en:'Cancel',ja:'キャンセル',vi:'Hủy'},
  suErrGenId:{ko:'ID를 먼저 생성해 주세요.',zhHans:'请先生成账号。',zhHant:'請先生成帳號。',en:'Please generate an ID first.',ja:'先にIDを発行してください。',vi:'Vui lòng tạo ID trước.'},
  suErrVerify:{ko:'휴대폰 인증을 완료해 주세요.',zhHans:'请先完成手机验证。',zhHant:'請先完成手機驗證。',en:'Please complete phone verification.',ja:'携帯電話認証を完了してください。',vi:'Vui lòng hoàn tất xác thực điện thoại.'},
  suErrRequired:{ko:'필수 항목을 입력하세요.',zhHans:'请填写必填项。',zhHant:'請填寫必填項。',en:'Please fill in all required fields.',ja:'必須項目を入力してください。',vi:'Vui lòng nhập đầy đủ thông tin bắt buộc.'},
  suErrDup:{ko:'이미 존재하는 아이디입니다.',zhHans:'该账号已存在。',zhHant:'該帳號已存在。',en:'This ID already exists.',ja:'既に存在するIDです。',vi:'ID này đã tồn tại.'},
  suCodeSent:{ko:'데모 인증번호: {code} (실제 SMS는 발송되지 않습니다)',zhHans:'演示验证码：{code}（不会实际发送短信）',zhHant:'演示驗證碼：{code}（不會實際傳送簡訊）',en:'Demo code: {code} (no real SMS is sent)',ja:'デモ認証番号: {code}（実際のSMSは送信されません）',vi:'Mã demo: {code} (không gửi SMS thật)'},
  suCodeOk:{ko:'휴대폰 인증이 완료되었습니다.',zhHans:'手机验证完成。',zhHant:'手機驗證完成。',en:'Phone verified.',ja:'携帯電話認証が完了しました。',vi:'Xác thực điện thoại thành công.'},
  suCodeBad:{ko:'인증번호가 일치하지 않습니다.',zhHans:'验证码不正确。',zhHant:'驗證碼不正確。',en:'Incorrect verification code.',ja:'認証番号が一致しません。',vi:'Mã xác thực không đúng.'},
  suSignupDone:{ko:'회원가입이 완료되었습니다. 가입 축하 포인트 100,000이 지급되었습니다.',zhHans:'注册完成。已赠送注册奖励积分 100,000。',zhHant:'註冊完成。已贈送註冊獎勵積分 100,000。',en:'Sign-up complete. You received a 100,000 welcome bonus point.',ja:'会員登録が完了しました。登録記念ポイント100,000が付与されました。',vi:'Đăng ký hoàn tất. Bạn nhận được 100,000 điểm thưởng chào mừng.'},
  verified:{ko:'인증완료',zhHans:'已验证',zhHant:'已驗證',en:'Verified',ja:'認証済み',vi:'Đã xác thực'},

  // ---- header / picker ----
  balance:{ko:'보유금',zhHans:'余额',zhHant:'餘額',en:'Balance',ja:'保有金',vi:'Số dư'},
  points:{ko:'포인트',zhHans:'积分',zhHant:'積分',en:'Points',ja:'ポイント',vi:'Điểm'},
  gameHistory:{ko:'게임기록',zhHans:'游戏记录',zhHant:'遊戲記錄',en:'Game History',ja:'ゲーム記録',vi:'Lịch sử chơi'},
  tableList:{ko:'테이블 목록',zhHans:'桌台列表',zhHant:'桌臺列表',en:'Table List',ja:'テーブル一覧',vi:'Danh sách bàn'},
  changeGame:{ko:'게임 변경',zhHans:'切换游戏',zhHant:'切換遊戲',en:'Change Game',ja:'ゲーム変更',vi:'Đổi trò chơi'},
  logout:{ko:'로그아웃',zhHans:'登出',zhHant:'登出',en:'Logout',ja:'ログアウト',vi:'Đăng xuất'},
  pickerTitle:{ko:'게임을 선택하세요',zhHans:'请选择游戏',zhHant:'請選擇遊戲',en:'Choose a game',ja:'ゲームを選択してください',vi:'Chọn trò chơi'},
  pickerSub:{ko:'아바타와 스피드는 같은 계정, 같은 보유금으로 언제든 자유롭게 오갈 수 있습니다.',zhHans:'代打和极速使用同一账号、同一余额，可随时自由切换。',zhHant:'代打和極速使用同一帳號、同一餘額，可隨時自由切換。',en:'Avatar and Speed share the same account and balance — switch between them anytime.',ja:'アバターとスピードは同じアカウント・同じ残高でいつでも自由に行き来できます。',vi:'Avatar và Speed dùng chung tài khoản, chung số dư — chuyển đổi bất cứ lúc nào.'},
  pickerAvatarName:{ko:'아바타 (AVATAR)',zhHans:'代打 (AVATAR)',zhHant:'代打 (AVATAR)',en:'Avatar',ja:'アバター (AVATAR)',vi:'Avatar'},
  pickerAvatarDesc:{ko:'전담 아바타가 대신 베팅해주는 대리 배팅 서비스',zhHans:'专属代打为您下注的代理投注服务',zhHant:'專屬代打為您下注的代理投注服務',en:'A dedicated avatar places bets on your behalf',ja:'専属アバターが代わりにベットする代理ベッティングサービス',vi:'Dịch vụ đặt cược thay bởi Avatar riêng'},
  pickerSpeedName:{ko:'스피드 (SPEED)',zhHans:'极速 (SPEED)',zhHant:'極速 (SPEED)',en:'Speed',ja:'スピード (SPEED)',vi:'Speed'},
  pickerSpeedDesc:{ko:'여러 테이블 동시 베팅 · 빠른 라운드',zhHans:'多桌同时投注 · 快速回合',zhHant:'多桌同時投注 · 快速回合',en:'Bet on multiple tables at once · fast rounds',ja:'複数テーブル同時ベット・スピーディーなラウンド',vi:'Đặt cược nhiều bàn cùng lúc · vòng chơi nhanh'},

  // ---- lobby ----
  avatarLobbyTitle:{ko:'아바타 테이블',zhHans:'代打桌台',zhHant:'代打桌臺',en:'Avatar Tables',ja:'アバターテーブル',vi:'Bàn Avatar'},
  speedLobbyTitle:{ko:'스피드 테이블',zhHans:'极速桌台',zhHant:'極速桌臺',en:'Speed Tables',ja:'スピードテーブル',vi:'Bàn Speed'},
  speedLobbySub:{ko:'테이블을 선택해 입장하세요',zhHans:'请选择桌台进入',zhHant:'請選擇桌臺進入',en:'Pick a table to enter',ja:'テーブルを選んで入場してください',vi:'Chọn một bàn để vào'},
  allCasinos:{ko:'전체 게임',zhHans:'全部游戏',zhHant:'全部遊戲',en:'All Games',ja:'全ゲーム',vi:'Tất cả'},
  casinoHann:{ko:'한 카지노',zhHans:'HANN 赌场',zhHant:'HANN 賭場',en:'HANN Casino',ja:'ハンカジノ',vi:'Sòng HANN'},
  casinoNustar:{ko:'누스타',zhHans:'NUSTAR',zhHant:'NUSTAR',en:'NuStar',ja:'ヌスター',vi:'NuStar'},
  casinoSolaire:{ko:'솔레어',zhHans:'索莱尔',zhHant:'索萊爾',en:'Solaire',ja:'ソレア',vi:'Solaire'},
  allGameTypes:{ko:'전체',zhHans:'全部',zhHant:'全部',en:'All',ja:'すべて',vi:'Tất cả'},
  gameTypeAvatar:{ko:'아바타',zhHans:'代打',zhHant:'代打',en:'Avatar',ja:'アバター',vi:'Avatar'},
  gameTypeSpeed:{ko:'스피드',zhHans:'极速',zhHant:'極速',en:'Speed',ja:'スピード',vi:'Speed'},
  searchTablePh:{ko:'찾기',zhHans:'搜索',zhHant:'搜尋',en:'Search',ja:'検索',vi:'Tìm kiếm'},
  sortLabel:{ko:'정렬',zhHans:'排序',zhHant:'排序',en:'Sort',ja:'並び替え',vi:'Sắp xếp'},
  sortPopular:{ko:'인기순 (베팅총액)',zhHans:'热门（投注总额）',zhHant:'熱門（投注總額）',en:'Popular (total volume)',ja:'人気順（ベット総額）',vi:'Phổ biến (tổng cược)'},
  sortToday:{ko:'오늘 베팅액순',zhHans:'今日投注额',zhHant:'今日投注額',en:"Today's volume",ja:'本日ベット額順',vi:'Cược hôm nay'},
  sortHot:{ko:'좋은 흐름순',zhHans:'热门走势',zhHant:'熱門走勢',en:'Hot streak',ja:'好調な流れ順',vi:'Chuỗi thắng'},
  sortName:{ko:'테이블명순',zhHans:'桌台名称',zhHant:'桌臺名稱',en:'Table name',ja:'テーブル名順',vi:'Tên bàn'},
  noAvatarTables:{ko:'열려있는 아바타 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.',zhHans:'暂无开放的代打桌台。请在合作伙伴管理后台生成演示数据。',zhHant:'暫無開放的代打桌臺。請在合作伙伴管理後臺生成演示資料。',en:'No open Avatar tables. Please generate demo data in Partner Admin.',ja:'開いているアバターテーブルがありません。パートナー管理画面でデモデータを生成してください。',vi:'Không có bàn Avatar nào đang mở. Vui lòng tạo dữ liệu demo trong Partner Admin.'},
  noSpeedTables:{ko:'열려있는 스피드 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.',zhHans:'暂无开放的极速桌台。请在合作伙伴管理后台生成演示数据。',zhHant:'暫無開放的極速桌臺。請在合作伙伴管理後臺生成演示資料。',en:'No open Speed tables. Please generate demo data in Partner Admin.',ja:'開いているスピードテーブルがありません。パートナー管理画面でデモデータを生成してください。',vi:'Không có bàn Speed nào đang mở. Vui lòng tạo dữ liệu demo trong Partner Admin.'},
  noRecord:{ko:'기록 없음',zhHans:'暂无记录',zhHant:'暫無記錄',en:'No record',ja:'記録なし',vi:'Chưa có dữ liệu'},
  todayLabel:{ko:'오늘',zhHans:'今日',zhHant:'今日',en:'Today',ja:'本日',vi:'Hôm nay'},
  live:{ko:'LIVE',zhHans:'直播',zhHant:'直播',en:'LIVE',ja:'LIVE',vi:'TRỰC TIẾP'},

  // ---- avatar lobby action buttons / status ----
  btnRequestAvatar:{ko:'아바타 신청',zhHans:'申请代打',zhHant:'申請代打',en:'Request Avatar',ja:'アバター申請',vi:'Yêu cầu Avatar'},
  btnReenter:{ko:'재입장',zhHans:'重新进入',zhHant:'重新進入',en:'Re-enter',ja:'再入場',vi:'Vào lại'},
  btnSpectate:{ko:'관전',zhHans:'观战',zhHant:'觀戰',en:'Spectate',ja:'観戦',vi:'Xem'},
  btnFullToday:{ko:'금일 예약 완료',zhHans:'今日预约已满',zhHant:'今日預約已滿',en:"Today's slots full",ja:'本日予約完了',vi:'Hết chỗ hôm nay'},
  btnPending:{ko:'승인 대기중',zhHans:'等待批准',zhHant:'等待批准',en:'Awaiting approval',ja:'承認待ち',vi:'Đang chờ duyệt'},
  requestModalTitle:{ko:'아바타 대리베팅 신청',zhHans:'申请代打投注',zhHant:'申請代打投注',en:'Request Avatar Betting',ja:'アバター代理ベット申請',vi:'Yêu cầu đặt cược Avatar'},
  requestModalDesc:{ko:'전담 아바타가 아래 지시에 따라 라운드마다 대신 베팅합니다. 보유금에서 실시간으로 차감/지급됩니다.',zhHans:'专属代打将按下方指示每局为您代为下注，实时从余额中扣款/结算。',zhHant:'專屬代打將按下方指示每局為您代為下注，實時從餘額中扣款/結算。',en:'A dedicated avatar will place a bet each round per your instruction below, debited/credited from your balance in real time.',ja:'専属アバターが下記の指示に従い毎ラウンド代わりにベットします。保有金からリアルタイムで増減します。',vi:'Người Avatar sẽ đặt cược mỗi vòng theo hướng dẫn bên dưới, trừ/cộng trực tiếp từ số dư của bạn.'},
  buyinLabel:{ko:'바이인 금액',zhHans:'买入金额',zhHant:'買入金額',en:'Buy-in amount',ja:'バイイン金額',vi:'Số tiền buy-in'},
  betInstructionLabel:{ko:'라운드당 베팅 지시',zhHans:'每局投注指示',zhHant:'每局投注指示',en:'Per-round bet instruction',ja:'ラウンドごとのベット指示',vi:'Hướng dẫn cược mỗi vòng'},
  betAmountLabel:{ko:'라운드당 베팅액',zhHans:'每局投注额',zhHant:'每局投注額',en:'Amount per round',ja:'ラウンドごとのベット額',vi:'Số tiền mỗi vòng'},
  submitRequest:{ko:'신청하기',zhHans:'提交申请',zhHant:'提交申請',en:'Submit request',ja:'申請する',vi:'Gửi yêu cầu'},
  requestSubmitted:{ko:'아바타 신청이 접수되었습니다. 승인 후 대리 베팅이 시작됩니다.',zhHans:'代打申请已提交，批准后将开始代为投注。',zhHant:'代打申請已提交，批准後將開始代為投注。',en:'Your avatar request was submitted. Proxy betting starts once approved.',ja:'アバター申請を受け付けました。承認後に代理ベットが開始されます。',vi:'Yêu cầu Avatar đã được gửi. Cược thay sẽ bắt đầu sau khi được duyệt.'},

  // ---- avatar status panel (in-session) ----
  avatarStatusTitle:{ko:'아바타 대리베팅 현황',zhHans:'代打投注状况',zhHant:'代打投注狀況',en:'Avatar Betting Status',ja:'アバター代理ベット状況',vi:'Trạng thái cược Avatar'},
  statusWaiting:{ko:'승인 대기중',zhHans:'等待批准',zhHant:'等待批准',en:'Awaiting approval',ja:'承認待ち',vi:'Đang chờ duyệt'},
  statusActive:{ko:'베팅 진행중',zhHans:'投注进行中',zhHant:'投注進行中',en:'Betting in progress',ja:'ベット進行中',vi:'Đang cược'},
  statusEnded:{ko:'종료됨',zhHans:'已结束',zhHant:'已結束',en:'Ended',ja:'終了しました',vi:'Đã kết thúc'},
  betPlacedLabel:{ko:'배팅란',zhHans:'投注栏',zhHant:'投注欄',en:'Bet',ja:'ベット欄',vi:'Ô cược'},
  chipUsedLabel:{ko:'칩 선택란',zhHans:'筹码栏',zhHant:'籌碼欄',en:'Chip',ja:'チップ欄',vi:'Ô phỉnh'},
  assignedAvatar:{ko:'담당 아바타',zhHans:'负责代打',zhHant:'負責代打',en:'Assigned Avatar',ja:'担当アバター',vi:'Avatar phụ trách'},
  unassigned:{ko:'배정 대기중',zhHans:'待分配',zhHant:'待分配',en:'Not yet assigned',ja:'割当待ち',vi:'Chưa được gán'},
  myInstruction:{ko:'내 베팅 지시',zhHans:'我的投注指示',zhHant:'我的投注指示',en:'My instruction',ja:'私のベット指示',vi:'Hướng dẫn của tôi'},
  avatarTipTotal:{ko:'아바타팁 합계',zhHans:'代打小费合计',zhHant:'代打小費合計',en:'Avatar tip total',ja:'アバターチップ合計',vi:'Tổng tip Avatar'},
  dealerTipTotal:{ko:'딜러팁 합계',zhHans:'荷官小费合计',zhHant:'荷官小費合計',en:'Dealer tip total',ja:'ディーラーチップ合計',vi:'Tổng tip Dealer'},
  giveTip:{ko:'팁 지급',zhHans:'打赏小费',zhHant:'打賞小費',en:'Give a tip',ja:'チップを渡す',vi:'Gửi tip'},
  requestShoeChange:{ko:'슈 체인지 요청',zhHans:'申请换靴',zhHant:'申請換靴',en:'Request shoe change',ja:'シューチェンジ要請',vi:'Yêu cầu đổi giày bài'},
  endSession:{ko:'대리베팅 종료',zhHans:'结束代打',zhHant:'結束代打',en:'End session',ja:'代理ベット終了',vi:'Kết thúc phiên'},
  tipModalTitle:{ko:'팁 지급',zhHans:'打赏小费',zhHant:'打賞小費',en:'Give a Tip',ja:'チップを渡す',vi:'Gửi Tip'},
  tipTargetLabel:{ko:'지급 대상',zhHans:'打赏对象',zhHant:'打賞對象',en:'Tip recipient',ja:'渡す相手',vi:'Người nhận tip'},
  tipTargetAvatar:{ko:'아바타',zhHans:'代打',zhHant:'代打',en:'Avatar',ja:'アバター',vi:'Avatar'},
  tipTargetDealer:{ko:'딜러',zhHans:'荷官',zhHant:'荷官',en:'Dealer',ja:'ディーラー',vi:'Dealer'},
  tipAmountLabel:{ko:'팁 금액',zhHans:'小费金额',zhHant:'小費金額',en:'Tip amount',ja:'チップ金額',vi:'Số tiền tip'},
  tipSent:{ko:'팁이 지급되었습니다.',zhHans:'小费已发送。',zhHant:'小費已傳送。',en:'Tip sent.',ja:'チップを渡しました。',vi:'Đã gửi tip.'},
  shoeChangeSent:{ko:'슈 체인지가 요청되었습니다.',zhHans:'已申请换靴。',zhHant:'已申請換靴。',en:'Shoe-change requested.',ja:'シューチェンジを要請しました。',vi:'Đã gửi yêu cầu đổi giày bài.'},
  shoeChanged:{ko:'슈 체인지 — {no}번 슈가 시작됩니다',zhHans:'换靴 — 第 {no} 靴开始',zhHant:'換靴 — 第 {no} 靴開始',en:'Shoe change — shoe #{no} begins',ja:'シューチェンジ — {no}番シュー開始',vi:'Đổi giày bài — giày #{no} bắt đầu'},
  belowTableMin:{ko:'테이블 최소 베팅은 {min} 입니다',zhHans:'本桌最低投注为 {min}',zhHant:'本桌最低投注為 {min}',en:'Table minimum is {min}',ja:'テーブル最低ベットは {min} です',vi:'Mức cược tối thiểu của bàn là {min}'},
  aboveTableMax:{ko:'테이블 최대 베팅은 {max} 입니다',zhHans:'本桌最高投注为 {max}',zhHant:'本桌最高投注為 {max}',en:'Table maximum is {max}',ja:'テーブル最高ベットは {max} です',vi:'Mức cược tối đa của bàn là {max}'},
  betReturnedBelowMin:{ko:'최소 베팅 미만이라 {amount} 이 반환되었습니다',zhHans:'低于最低投注，已退还 {amount}',zhHant:'低於最低投注，已退還 {amount}',en:'{amount} returned — below the table minimum',ja:'最低ベット未満のため {amount} が返却されました',vi:'Đã hoàn {amount} — dưới mức cược tối thiểu'},
  sessionEnded:{ko:'대리베팅이 종료되었습니다.',zhHans:'代打已结束。',zhHant:'代打已結束。',en:'Session ended.',ja:'代理ベットが終了しました。',vi:'Đã kết thúc phiên cược.'},
  avatarPlacedBet:{ko:'아바타가 {side} 에 {amount} 베팅했습니다',zhHans:'代打已在{side}下注{amount}',zhHant:'代打已在{side}下注{amount}',en:'Avatar bet {amount} on {side}',ja:'アバターが{side}に{amount}ベットしました',vi:'Avatar đã cược {amount} vào {side}'},
  roundInfo:{ko:'라운드',zhHans:'局数',zhHant:'局數',en:'Round',ja:'ラウンド',vi:'Vòng'},

  // ---- table / betting ----
  player:{ko:'플레이어',zhHans:'闲',zhHant:'閒',en:'Player',ja:'プレイヤー',vi:'Player'},
  banker:{ko:'뱅커',zhHans:'庄',zhHant:'莊',en:'Banker',ja:'バンカー',vi:'Banker'},
  tie:{ko:'타이',zhHans:'和',zhHant:'和',en:'Tie',ja:'タイ',vi:'Hòa'},
  playerPair:{ko:'플레이어 페어',zhHans:'闲对',zhHant:'閒對',en:'Player Pair',ja:'プレイヤーペア',vi:'Player Pair'},
  bankerPair:{ko:'뱅커 페어',zhHans:'庄对',zhHant:'莊對',en:'Banker Pair',ja:'バンカーペア',vi:'Banker Pair'},
  // short forms for the speed list's tile spots, where a full pair label will not fit
  playerPairShort:{ko:'P 페어',zhHans:'闲对',zhHant:'閒對',en:'P PAIR',ja:'Pペア',vi:'P Pair'},
  bankerPairShort:{ko:'B 페어',zhHans:'庄对',zhHant:'莊對',en:'B PAIR',ja:'Bペア',vi:'B Pair'},
  phaseBetting:{ko:'베팅하세요',zhHans:'请下注',zhHant:'請下注',en:'Place your bets',ja:'ベットしてください',vi:'Mời đặt cược'},
  phaseDealing:{ko:'카드를 배분합니다',zhHans:'正在发牌',zhHant:'正在發牌',en:'Dealing cards',ja:'カードを配っています',vi:'Đang chia bài'},
  phasePlayerWin:{ko:'플레이어 승리',zhHans:'闲家胜',zhHant:'閒家勝',en:'Player wins',ja:'プレイヤーの勝ち',vi:'Player thắng'},
  phaseBankerWin:{ko:'뱅커 승리',zhHans:'庄家胜',zhHant:'莊家勝',en:'Banker wins',ja:'バンカーの勝ち',vi:'Banker thắng'},
  phaseTie:{ko:'타이',zhHans:'和局',zhHant:'和局',en:'Tie',ja:'タイ',vi:'Hòa'},
  cancelBet:{ko:'취소',zhHans:'取消',zhHant:'取消',en:'Cancel',ja:'キャンセル',vi:'Hủy'},
  totalLabel:{ko:'총',zhHans:'总计',zhHant:'總計',en:'Total',ja:'合計',vi:'Tổng'},
  insufficientBalance:{ko:'보유금이 부족합니다',zhHans:'余额不足',zhHant:'餘額不足',en:'Insufficient balance',ja:'保有金が不足しています',vi:'Số dư không đủ'},
  notBettingTime:{ko:'베팅 시간이 아닙니다',zhHans:'不在投注时间',zhHant:'不在投注時間',en:'Not betting time',ja:'ベット時間ではありません',vi:'Không phải giờ đặt cược'},
  connectingTable:{ko:'테이블에 연결 중입니다...',zhHans:'正在连接桌台...',zhHant:'正在連線桌臺...',en:'Connecting to table...',ja:'テーブルに接続中...',vi:'Đang kết nối bàn...'},
  dealsLabel:{ko:'게임 횟수',zhHans:'局數',zhHant:'局數',en:'Deals',ja:'ゲーム回数',vi:'Số ván'},
  roundLabel:{ko:'라운드 번호',zhHans:'局號',zhHant:'局號',en:'Round',ja:'ラウンド番号',vi:'Số ván'},
  shoeLabel:{ko:'슈 번호',zhHans:'靴號',zhHant:'靴號',en:'Shoe',ja:'シュー番号',vi:'Số giày bài'},
  myBetHistory:{ko:'내 베팅내역',zhHans:'我的投注记录',zhHant:'我的投注記錄',en:'My Bet History',ja:'私のベット履歴',vi:'Lịch sử cược của tôi'},
  noBetsYet:{ko:'아직 베팅 내역이 없습니다',zhHans:'暂无投注记录',zhHant:'暫無投注記錄',en:'No bets yet',ja:'まだベット履歴がありません',vi:'Chưa có lịch sử cược'},
  push:{ko:'푸시',zhHans:'走水',zhHant:'走水',en:'Push',ja:'プッシュ',vi:'Hòa cược'},
  chat:{ko:'채팅',zhHans:'聊天',zhHant:'聊天',en:'Chat',ja:'チャット',vi:'Trò chuyện'},
  chatPh:{ko:'메시지 입력...',zhHans:'输入消息...',zhHant:'輸入消息...',en:'Type a message...',ja:'メッセージを入力...',vi:'Nhập tin nhắn...'},
  send:{ko:'전송',zhHans:'发送',zhHant:'傳送',en:'Send',ja:'送信',vi:'Gửi'},
  noChat:{ko:'채팅이 없습니다',zhHans:'暂无聊天记录',zhHant:'暫無聊天記錄',en:'No messages yet',ja:'チャットがありません',vi:'Chưa có tin nhắn'},
  wonAmount:{ko:'+{amount} 획득!',zhHans:'赢得 +{amount}！',zhHant:'贏得 +{amount}！',en:'+{amount} won!',ja:'+{amount} 獲得！',vi:'+{amount} thắng!'},

  // ---- game history sheet ----
  historyTabSpeed:{ko:'스피드 베팅',zhHans:'极速投注',zhHant:'極速投注',en:'Speed Bets',ja:'スピードベット',vi:'Cược Speed'},
  historyTabAvatar:{ko:'아바타 베팅',zhHans:'代打投注',zhHant:'代打投注',en:'Avatar Bets',ja:'アバターベット',vi:'Cược Avatar'},
  noHistory:{ko:'베팅 내역이 없습니다',zhHans:'暂无投注记录',zhHant:'暫無投注記錄',en:'No bet history',ja:'ベット履歴がありません',vi:'Chưa có lịch sử cược'},
  betLabel:{ko:'베팅',zhHans:'投注',zhHant:'投注',en:'Bet',ja:'ベット',vi:'Cược'},
  fullscreen:{ko:'전체화면',zhHans:'全屏',zhHant:'全屏',en:'Fullscreen',ja:'全画面',vi:'Toàn màn hình'},
  mute:{ko:'음소거',zhHans:'静音',zhHant:'靜音',en:'Mute',ja:'ミュート',vi:'Tắt tiếng'},
  viewToggle:{ko:'화면 보기 전환',zhHans:'切换视角',zhHant:'切換視角',en:'Toggle view',ja:'表示切替',vi:'Chuyển chế độ xem'},
  tipComingSoon:{ko:'팁 기능은 준비 중입니다',zhHans:'打赏功能即将上线',zhHant:'打賞功能即將上線',en:'Tipping is coming soon',ja:'チップ機能は準備中です',vi:'Tính năng tip sắp ra mắt'},
  favorites:{ko:'즐겨찾기',zhHans:'收藏',zhHant:'收藏',en:'Favorites',ja:'お気に入り',vi:'Yêu thích'},

  // ---- display settings (theme / skin) ----
  displaySettings:{ko:'화면 설정',zhHans:'显示设置',zhHant:'顯示設定',en:'Display Settings',ja:'画面設定',vi:'Cài đặt hiển thị'},

  // ---- speed single-table detail screen ----
  openTable:{ko:'테이블 입장',zhHans:'进入桌台',zhHant:'進入桌臺',en:'Enter Table',ja:'テーブルに入る',vi:'Vào bàn'},
  backToList:{ko:'목록으로',zhHans:'返回列表',zhHant:'返回列表',en:'Back to List',ja:'一覧へ',vi:'Về danh sách'},
  betComplete:{ko:'베팅완료',zhHans:'下注完成',zhHant:'下注完成',en:'Confirm',ja:'ベット完了',vi:'Xác nhận'},
  repeatBet:{ko:'반복',zhHans:'重复',zhHant:'重複',en:'Repeat',ja:'繰り返し',vi:'Lặp lại'},
  betCompleteToast:{ko:'베팅이 접수되었습니다',zhHans:'投注已提交',zhHant:'投注已提交',en:'Bet placed',ja:'ベットを受け付けました',vi:'Đã đặt cược'},
  repeatNoPrev:{ko:'반복할 이전 베팅이 없습니다',zhHans:'没有可重复的上一次投注',zhHant:'沒有可重複的上一次投注',en:'No previous bet to repeat',ja:'繰り返すベットがありません',vi:'Không có cược trước để lặp lại'},
  streakLabel:{ko:'연속',zhHans:'连',zhHant:'連',en:'streak',ja:'連続',vi:'liên tiếp'},
  roundFailed:{ko:'이번 라운드 처리에 실패했습니다. 연결을 확인해 주세요.',zhHans:'本局处理失败，请检查网络连接。',zhHant:'本局處理失敗，請檢查網路連線。',en:'This round could not be settled — check your connection.',ja:'このラウンドの処理に失敗しました。接続を確認してください。',vi:'Không xử lý được ván này — vui lòng kiểm tra kết nối.'},
  watchingNow:{ko:'보는 중',zhHans:'观看中',zhHant:'觀看中',en:'Watching',ja:'視聴中',vi:'Đang xem'},
  multiBet:{ko:'멀티 베팅',zhHans:'多桌投注',zhHant:'多桌投注',en:'Multi-bet',ja:'マルチベット',vi:'Cược nhiều bàn'},
  enterShort:{ko:'입장',zhHans:'进入',zhHant:'進入',en:'Enter',ja:'入場',vi:'Vào'},
  allInStaked:{ko:'보유금 전액 {amount} 을 베팅했습니다',zhHans:'已投注全部余额 {amount}',zhHant:'已投注全部餘額 {amount}',en:'Staked your whole balance, {amount}',ja:'保有金全額 {amount} をベットしました',vi:'Đã cược toàn bộ số dư {amount}'},
  confirmToBet:{ko:'베팅완료를 눌러야 베팅이 확정됩니다',zhHans:'需按下"下注完成"才会生效',zhHant:'需按下"下注完成"才會生效',en:'Press Confirm or the bet will not be placed',ja:'「ベット完了」を押すと確定します',vi:'Nhấn Xác nhận để đặt cược'},
  betNotConfirmed:{ko:'베팅완료를 누르지 않아 {amount} 이 반환되었습니다',zhHans:'未按下注完成，已退还 {amount}',zhHant:'未按下注完成，已退還 {amount}',en:'{amount} returned — never confirmed',ja:'ベット完了を押さなかったため {amount} が返却されました',vi:'Đã hoàn {amount} — chưa xác nhận'},
  nothingToConfirm:{ko:'베팅할 금액이 없습니다',zhHans:'没有可确认的投注',zhHant:'沒有可確認的投注',en:'Nothing staked to confirm',ja:'確定するベットがありません',vi:'Chưa có cược nào để xác nhận'},
  betConfirmedCount:{ko:'{n}개 테이블 베팅이 확정되었습니다',zhHans:'{n} 张桌台的投注已确认',zhHant:'{n} 張桌臺的投注已確認',en:'Bets confirmed on {n} tables',ja:'{n}卓のベットが確定しました',vi:'Đã xác nhận cược trên {n} bàn'},

  // ---- Agent Admin — nav ----
  navMember:{ko:'회원관리',zhHans:'会员管理',zhHant:'會員管理',en:'Members',ja:'会員管理',vi:'Quản lý hội viên'},
  navAccount:{ko:'계정관리',zhHans:'账户管理',zhHant:'帳戶管理',en:'Accounts',ja:'アカウント管理',vi:'Quản lý tài khoản'},
  navBetHistory:{ko:'베팅내역',zhHans:'投注记录',zhHant:'投注記錄',en:'Bet History',ja:'ベット履歴',vi:'Lịch sử cược'},
  navSettlement:{ko:'정산리포트',zhHans:'结算报表',zhHant:'結算報表',en:'Settlement Report',ja:'精算レポート',vi:'Báo cáo quyết toán'},
  navRealtime:{ko:'실시간접속자',zhHans:'实时在线',zhHant:'即時在線',en:'Online Now',ja:'リアルタイム接続者',vi:'Đang trực tuyến'},
  navMyInfo:{ko:'내정보 변경',zhHans:'我的信息',zhHant:'我的資訊',en:'My Info',ja:'マイ情報',vi:'Thông tin của tôi'},

  // ---- Agent Admin — login / topbar ----
  agentIdLabel:{ko:'에이전트 ID',zhHans:'代理商 ID',zhHant:'代理商 ID',en:'Agent ID',ja:'エージェントID',vi:'ID đại lý'},
  agentLoginErr:{ko:'아이디 또는 비밀번호가 올바르지 않습니다.',zhHans:'账号或密码不正确。',zhHant:'帳號或密碼不正確。',en:'Incorrect ID or password.',ja:'IDまたはパスワードが正しくありません。',vi:'ID hoặc mật khẩu không đúng.'},
  demoAccountLabel:{ko:'데모 계정',zhHans:'演示账号',zhHant:'演示帳號',en:'Demo account',ja:'デモアカウント',vi:'Tài khoản demo'},
  agentSeedHint:{ko:'최초 실행 시 데모 데이터가 없으면 로그인 후 좌측 하단 "데모 데이터 생성"을 눌러주세요.',zhHans:'首次运行如无演示数据，请登录后点击左下角"生成演示数据"。',zhHant:'首次執行如無演示資料，請登入後點選左下角"生成演示資料"。',en:'On first run, log in and click "Generate Demo Data" in the bottom-left if there\'s no data yet.',ja:'初回実行時にデモデータがない場合、ログイン後に左下の「デモデータ生成」を押してください。',vi:'Lần chạy đầu nếu chưa có dữ liệu, hãy đăng nhập rồi nhấn "Tạo dữ liệu demo" ở góc dưới bên trái.'},
  liveSyncLabel:{ko:'실시간 연동',zhHans:'实时同步',zhHant:'即時同步',en:'Live sync',ja:'リアルタイム連携',vi:'Đồng bộ trực tiếp'},
  agentColonLabel:{ko:'에이전트:',zhHans:'代理商：',zhHant:'代理商：',en:'Agent:',ja:'エージェント：',vi:'Đại lý:'},
  seedDemoData:{ko:'데모 데이터 생성',zhHans:'生成演示数据',zhHant:'生成演示資料',en:'Generate Demo Data',ja:'デモデータ生成',vi:'Tạo dữ liệu demo'},
  seedConfirmTitle:{ko:'데모 데이터 생성',zhHans:'生成演示数据',zhHant:'生成演示資料',en:'Generate Demo Data',ja:'デモデータ生成',vi:'Tạo dữ liệu demo'},
  seedConfirmBody:{ko:'{agent} 소속 하부회원 데모 데이터를 Firestore에 생성합니다. 계속할까요?',zhHans:'将在 Firestore 中为 {agent} 生成下属会员演示数据，是否继续？',zhHant:'將在 Firestore 中為 {agent} 生成下屬會員演示資料，是否繼續？',en:'This will create demo downline data for {agent} in Firestore. Continue?',ja:'{agent} 配下のデモ会員データをFirestoreに生成します。続けますか？',vi:'Thao tác này sẽ tạo dữ liệu demo cho tuyến dưới của {agent} trong Firestore. Tiếp tục?'},
  seedDone:{ko:'데모 데이터가 생성되었습니다',zhHans:'演示数据已生成',zhHant:'演示資料已生成',en:'Demo data generated',ja:'デモデータが生成されました',vi:'Đã tạo dữ liệu demo'},
  seedingInProgress:{ko:'데모 데이터 생성 중...',zhHans:'正在生成演示数据...',zhHant:'正在生成演示資料...',en:'Generating demo data...',ja:'デモデータ生成中...',vi:'Đang tạo dữ liệu demo...'},
  confirmBtn:{ko:'확인',zhHans:'确认',zhHant:'確認',en:'Confirm',ja:'確認',vi:'Xác nhận'},
  comingSoon:{ko:'준비 중',zhHans:'即将上线',zhHant:'即將上線',en:'Coming soon',ja:'準備中',vi:'Sắp ra mắt'},
  errorLabel:{ko:'오류',zhHans:'错误',zhHant:'錯誤',en:'Error',ja:'エラー',vi:'Lỗi'},

  // ---- Agent Admin — 회원관리 ----
  memberTitle:{ko:'회원관리',zhHans:'会员管理',zhHant:'會員管理',en:'Member Management',ja:'会員管理',vi:'Quản lý hội viên'},
  memberSub:{ko:'하부 회원 리스트 · 게임용(아바타/스피드) 아이디는 이 화면 또는 케이지에서 생성할 수 있습니다.',zhHans:'下属会员列表 · 游戏用（代打/极速）账号可在此画面或收银处生成。',zhHant:'下屬會員列表 · 遊戲用（代打/極速）帳號可在此畫面或收銀處生成。',en:'Downline member list — game login IDs (Avatar/Speed) can be created here or at the cage.',ja:'下位会員リスト・ゲーム用（アバター/スピード）IDはこの画面またはケージで発行できます。',vi:'Danh sách hội viên tuyến dưới — ID đăng nhập game (Avatar/Speed) có thể tạo tại đây hoặc tại quầy cage.'},
  statTotalDownline:{ko:'총 하부회원',zhHans:'下属会员总数',zhHant:'下屬會員總數',en:'Total downline',ja:'下位会員合計',vi:'Tổng hội viên tuyến dưới'},
  statActive:{ko:'정상',zhHans:'正常',zhHant:'正常',en:'Active',ja:'正常',vi:'Bình thường'},
  statSuspended:{ko:'정지',zhHans:'停用',zhHant:'停用',en:'Suspended',ja:'停止',vi:'Tạm ngưng'},
  statBalanceSum:{ko:'보유금 합계',zhHans:'余额合计',zhHant:'餘額合計',en:'Total balance',ja:'保有金合計',vi:'Tổng số dư'},
  searchIdNickPh:{ko:'ID/닉네임 검색',zhHans:'搜索 ID/昵称',zhHant:'搜尋 ID/暱稱',en:'Search ID/nickname',ja:'ID/ニックネーム検索',vi:'Tìm ID/biệt danh'},
  createSubMemberBtn:{ko:'+ 하부회원 생성',zhHans:'+ 新增下属会员',zhHant:'+ 新增下屬會員',en:'+ Create Sub-member',ja:'+ 下位会員作成',vi:'+ Tạo hội viên tuyến dưới'},
  colId:{ko:'ID',zhHans:'ID',zhHant:'ID',en:'ID',ja:'ID',vi:'ID'},
  colNick:{ko:'닉네임',zhHans:'昵称',zhHant:'暱稱',en:'Nickname',ja:'ニックネーム',vi:'Biệt danh'},
  colPhone:{ko:'전화번호',zhHans:'电话号码',zhHant:'電話號碼',en:'Phone',ja:'電話番号',vi:'Số điện thoại'},
  colCasino:{ko:'카지노',zhHans:'赌场',zhHant:'賭場',en:'Casino',ja:'カジノ',vi:'Sòng bạc'},
  colMemberType:{ko:'회원유형',zhHans:'会员类型',zhHant:'會員類型',en:'Member Type',ja:'会員種別',vi:'Loại hội viên'},
  colBalance:{ko:'보유금',zhHans:'余额',zhHant:'餘額',en:'Balance',ja:'保有金',vi:'Số dư'},
  colJoined:{ko:'가입일',zhHans:'加入日期',zhHant:'加入日期',en:'Joined',ja:'登録日',vi:'Ngày tham gia'},
  colStatus:{ko:'상태',zhHans:'状态',zhHant:'狀態',en:'Status',ja:'状態',vi:'Trạng thái'},
  noSubMembers:{ko:'하부회원이 없습니다',zhHans:'暂无下属会员',zhHant:'暫無下屬會員',en:'No downline members',ja:'下位会員がいません',vi:'Chưa có hội viên tuyến dưới'},
  createSubMemberTitle:{ko:'하부회원 생성 (게임용 아바타/스피드 아이디)',zhHans:'新增下属会员（游戏用代打/极速账号）',zhHant:'新增下屬會員（遊戲用代打/極速帳號）',en:'Create Sub-member (Game Avatar/Speed ID)',ja:'下位会員作成（ゲーム用アバター/スピードID）',vi:'Tạo hội viên tuyến dưới (ID game Avatar/Speed)'},
  createSubMemberHint:{ko:'신규 접수는 플로어를 통해 현장에서 받고 상위 계정 생성·변경은 케이지에서 처리합니다. 이 화면에서는 하부 게임용 로그인(아바타/스피드 공용)만 생성합니다.',zhHans:'新客户由现场地板接待，上级账户的建立与变更由收银处处理。此画面仅生成下属游戏登录（代打/极速通用）。',zhHant:'新客戶由現場地板接待，上級帳戶的建立與變更由收銀處處理。此畫面僅生成下屬遊戲登入（代打/極速通用）。',en:'New sign-ups are taken on the floor; upper-account creation/changes are handled at the cage. This screen only creates downline game logins (shared by Avatar and Speed).',ja:'新規受付はフロアで対応し、上位アカウントの作成・変更はケージで処理します。この画面では下位のゲーム用ログイン（アバター/スピード共用）のみ作成します。',vi:'Khách mới được tiếp nhận tại sàn; việc tạo/đổi tài khoản cấp trên do quầy cage xử lý. Màn hình này chỉ tạo đăng nhập game tuyến dưới (dùng chung cho Avatar/Speed).'},
  gameIdLabel:{ko:'게임용 ID',zhHans:'游戏账号',zhHant:'遊戲帳號',en:'Game ID',ja:'ゲーム用ID',vi:'ID game'},
  initialPwLabel:{ko:'초기 비밀번호',zhHans:'初始密码',zhHant:'初始密碼',en:'Initial Password',ja:'初期パスワード',vi:'Mật khẩu ban đầu'},
  subMemberCreated:{ko:'하부회원(게임용 아이디)이 생성되었습니다',zhHans:'下属会员（游戏账号）已生成',zhHant:'下屬會員（遊戲帳號）已生成',en:'Sub-member (game ID) created',ja:'下位会員（ゲーム用ID）が作成されました',vi:'Đã tạo hội viên tuyến dưới (ID game)'},
  enterIdErr:{ko:'ID를 입력하세요',zhHans:'请输入账号',zhHant:'請輸入帳號',en:'Please enter an ID',ja:'IDを入力してください',vi:'Vui lòng nhập ID'},
  idFormatErr:{ko:'ID는 영문/숫자만 입력할 수 있습니다',zhHans:'账号只能输入英文字母和数字',zhHant:'帳號只能輸入英文字母和數字',en:'ID may only contain letters and numbers',ja:'IDは英数字のみ入力できます',vi:'ID chỉ được chứa chữ cái và số'},
  idDuplicateErr:{ko:'이미 존재하는 ID입니다',zhHans:'该账号已存在',zhHant:'該帳號已存在',en:'This ID already exists',ja:'既に存在するIDです',vi:'ID này đã tồn tại'},

  // ---- Agent Admin — 계정관리 ----
  accountTitle:{ko:'계정관리',zhHans:'账户管理',zhHant:'帳戶管理',en:'Account Management',ja:'アカウント管理',vi:'Quản lý tài khoản'},
  accountSub:{ko:'하부 계정의 자금·요율·베팅한도·접속·비밀번호를 관리합니다.',zhHans:'管理下属账户的资金、费率、投注限额、登录状态与密码。',zhHant:'管理下屬帳戶的資金、費率、投注限額、登入狀態與密碼。',en:'Manage downline accounts’ funds, rate, bet limits, access, and password.',ja:'下位アカウントの資金・レート・ベット限度額・接続・パスワードを管理します。',vi:'Quản lý quỹ, tỷ lệ, hạn mức cược, quyền truy cập và mật khẩu của tài khoản tuyến dưới.'},
  colFundMgmt:{ko:'자금관리',zhHans:'资金管理',zhHant:'資金管理',en:'Funds',ja:'資金管理',vi:'Quản lý quỹ'},
  colRate:{ko:'요율',zhHans:'费率',zhHant:'費率',en:'Rate',ja:'レート',vi:'Tỷ lệ'},
  colBetLimit:{ko:'배팅한도',zhHans:'投注限额',zhHant:'投注限額',en:'Bet Limit',ja:'ベット限度額',vi:'Hạn mức cược'},
  colAccessStatus:{ko:'접속상태',zhHans:'登录状态',zhHant:'登入狀態',en:'Access',ja:'接続状態',vi:'Trạng thái truy cập'},
  colPassword:{ko:'비밀번호',zhHans:'密码',zhHant:'密碼',en:'Password',ja:'パスワード',vi:'Mật khẩu'},
  transferBtn:{ko:'이체',zhHans:'转账',zhHant:'轉帳',en:'Transfer',ja:'移体',vi:'Chuyển'},
  recallBtn:{ko:'회수',zhHans:'回收',zhHant:'回收',en:'Recall',ja:'回収',vi:'Thu hồi'},
  editBtn:{ko:'수정',zhHans:'修改',zhHant:'修改',en:'Edit',ja:'変更',vi:'Sửa'},
  allowBtn:{ko:'허용',zhHans:'允许',zhHant:'允許',en:'Allow',ja:'許可',vi:'Cho phép'},
  blockBtn:{ko:'차단',zhHans:'封锁',zhHant:'封鎖',en:'Block',ja:'遮断',vi:'Chặn'},
  changeBtn:{ko:'변경',zhHans:'变更',zhHant:'變更',en:'Change',ja:'変更',vi:'Thay đổi'},
  statusBlocked:{ko:'차단',zhHans:'已封锁',zhHant:'已封鎖',en:'Blocked',ja:'遮断',vi:'Đã chặn'},
  statusAllowed:{ko:'허용',zhHans:'已允许',zhHant:'已允許',en:'Allowed',ja:'許可',vi:'Đã cho phép'},
  fundTransferTitle:{ko:'자금 이체',zhHans:'资金转账',zhHant:'資金轉帳',en:'Fund Transfer',ja:'資金移体',vi:'Chuyển quỹ'},
  fundRecallTitle:{ko:'자금 회수',zhHans:'资金回收',zhHant:'資金回收',en:'Fund Recall',ja:'資金回収',vi:'Thu hồi quỹ'},
  targetMemberLabel:{ko:'대상 회원:',zhHans:'对象会员：',zhHant:'對象會員：',en:'Target member:',ja:'対象会員：',vi:'Hội viên mục tiêu:'},
  amountLabel:{ko:'금액',zhHans:'金额',zhHant:'金額',en:'Amount',ja:'金額',vi:'Số tiền'},
  memoLabel:{ko:'메모',zhHans:'备注',zhHant:'備註',en:'Memo',ja:'メモ',vi:'Ghi chú'},
  memoPh:{ko:'사유를 입력하세요',zhHans:'请输入原因',zhHant:'請輸入原因',en:'Enter a reason',ja:'理由を入力してください',vi:'Nhập lý do'},
  cancelBtn:{ko:'취소',zhHans:'取消',zhHant:'取消',en:'Cancel',ja:'キャンセル',vi:'Hủy'},
  processBtn:{ko:'처리',zhHans:'处理',zhHant:'處理',en:'Process',ja:'処理',vi:'Xử lý'},
  saveBtn:{ko:'저장',zhHans:'保存',zhHant:'儲存',en:'Save',ja:'保存',vi:'Lưu'},
  amountRequiredErr:{ko:'금액을 입력하세요',zhHans:'请输入金额',zhHant:'請輸入金額',en:'Please enter an amount',ja:'金額を入力してください',vi:'Vui lòng nhập số tiền'},
  processedToast:{ko:'처리되었습니다',zhHans:'已处理',zhHant:'已處理',en:'Processed',ja:'処理されました',vi:'Đã xử lý'},
  editRateTitle:{ko:'하부 요율 변경 · {id}',zhHans:'变更下属费率 · {id}',zhHant:'變更下屬費率 · {id}',en:'Change Downline Rate · {id}',ja:'下位レート変更 · {id}',vi:'Đổi tỷ lệ tuyến dưới · {id}'},
  rateLabel:{ko:'요율(%)',zhHans:'费率(%)',zhHant:'費率(%)',en:'Rate (%)',ja:'レート(%)',vi:'Tỷ lệ (%)'},
  rateChanged:{ko:'요율이 변경되었습니다',zhHans:'费率已变更',zhHant:'費率已變更',en:'Rate changed',ja:'レートが変更されました',vi:'Đã thay đổi tỷ lệ'},
  editBetLimitTitle:{ko:'베팅한도 변경 · {id}',zhHans:'变更投注限额 · {id}',zhHant:'變更投注限額 · {id}',en:'Change Bet Limit · {id}',ja:'ベット限度額変更 · {id}',vi:'Đổi hạn mức cược · {id}'},
  colSelect:{ko:'선택',zhHans:'选择',zhHant:'選擇',en:'Select',ja:'選択',vi:'Chọn'},
  colMin:{ko:'최소',zhHans:'最低',zhHant:'最低',en:'Min',ja:'最低',vi:'Tối thiểu'},
  colMax:{ko:'최대',zhHans:'最高',zhHant:'最高',en:'Max',ja:'最高',vi:'Tối đa'},
  betLimitHint:{ko:'선택 값 1건만 적용됩니다.',zhHans:'仅套用所选的一项。',zhHant:'僅套用所選的一項。',en:'Only the selected option is applied.',ja:'選択した1件のみ適用されます。',vi:'Chỉ áp dụng một lựa chọn đã chọn.'},
  betLimitInvalidErr:{ko:'한도 값을 확인하세요',zhHans:'请确认限额数值',zhHant:'請確認限額數值',en:'Please check the limit values',ja:'限度額を確認してください',vi:'Vui lòng kiểm tra hạn mức'},
  betLimitChanged:{ko:'베팅한도가 변경되었습니다',zhHans:'投注限额已变更',zhHant:'投注限額已變更',en:'Bet limit changed',ja:'ベット限度額が変更されました',vi:'Đã thay đổi hạn mức cược'},
  accessAllowedToast:{ko:'접속이 허용되었습니다',zhHans:'已允许登录',zhHant:'已允許登入',en:'Access allowed',ja:'接続が許可されました',vi:'Đã cho phép truy cập'},
  accessBlockedToast:{ko:'접속이 차단되었습니다',zhHans:'已封锁登录',zhHant:'已封鎖登入',en:'Access blocked',ja:'接続が遮断されました',vi:'Đã chặn truy cập'},
  changePwTitle:{ko:'비밀번호 변경 · {id}',zhHans:'变更密码 · {id}',zhHant:'變更密碼 · {id}',en:'Change Password · {id}',ja:'パスワード変更 · {id}',vi:'Đổi mật khẩu · {id}'},
  newPwLabel:{ko:'새 비밀번호',zhHans:'新密码',zhHant:'新密碼',en:'New Password',ja:'新しいパスワード',vi:'Mật khẩu mới'},
  newPwPh:{ko:'8-16자 영문/숫자/특수문자',zhHans:'8-16位英文/数字/特殊符号',zhHant:'8-16位英文/數字/特殊符號',en:'8-16 chars, letters/digits/symbols',ja:'8〜16文字の英数字・記号',vi:'8-16 ký tự chữ/số/ký hiệu'},
  newPwHint:{ko:'8-16자, 영문·숫자·특수문자를 포함해 입력하세요.',zhHans:'请输入8-16位，包含英文、数字与特殊符号。',zhHant:'請輸入8-16位，包含英文、數字與特殊符號。',en:'Enter 8-16 characters including letters, digits, and symbols.',ja:'8〜16文字で、英字・数字・記号を含めて入力してください。',vi:'Nhập 8-16 ký tự gồm chữ, số và ký hiệu.'},
  pwCheckErr:{ko:'비밀번호를 확인하세요',zhHans:'请确认密码',zhHant:'請確認密碼',en:'Please check the password',ja:'パスワードを確認してください',vi:'Vui lòng kiểm tra mật khẩu'},
  pwChangedToast:{ko:'비밀번호가 변경되었습니다',zhHans:'密码已变更',zhHant:'密碼已變更',en:'Password changed',ja:'パスワードが変更されました',vi:'Đã đổi mật khẩu'},

  // ---- Agent Admin — 베팅내역 ----
  betHistoryTitle:{ko:'베팅내역',zhHans:'投注记录',zhHant:'投注記錄',en:'Bet History',ja:'ベット履歴',vi:'Lịch sử cược'},
  betHistorySub:{ko:'하부 회원의 베팅/페이아웃 내역',zhHans:'下属会员的投注/派彩记录',zhHant:'下屬會員的投注/派彩記錄',en:'Downline members’ bets and payouts',ja:'下位会員のベット/払戻履歴',vi:'Lịch sử cược/chi trả của tuyến dưới'},
  statBetUsers:{ko:'배팅유저수',zhHans:'投注用户数',zhHant:'投注用戶數',en:'Betting users',ja:'ベットユーザー数',vi:'Số người cược'},
  statBetCount:{ko:'배팅건수',zhHans:'投注笔数',zhHant:'投注筆數',en:'Bet count',ja:'ベット件数',vi:'Số lượt cược'},
  statTotalBetAmount:{ko:'총 배팅금액',zhHans:'总投注金额',zhHant:'總投注金額',en:'Total bet amount',ja:'総ベット金額',vi:'Tổng tiền cược'},
  statWinLoss:{ko:'윈로스',zhHans:'输赢',zhHant:'輸贏',en:'Win/Loss',ja:'ウィンロス',vi:'Thắng/Thua'},
  colDatetime:{ko:'일시',zhHans:'日期时间',zhHant:'日期時間',en:'Date/Time',ja:'日時',vi:'Thời gian'},
  colCategory:{ko:'구분',zhHans:'类别',zhHant:'類別',en:'Type',ja:'区分',vi:'Loại'},
  colAmount:{ko:'금액',zhHans:'金额',zhHant:'金額',en:'Amount',ja:'金額',vi:'Số tiền'},
  colMemo:{ko:'메모',zhHans:'备注',zhHant:'備註',en:'Memo',ja:'メモ',vi:'Ghi chú'},
  categoryBet:{ko:'배팅',zhHans:'投注',zhHant:'投注',en:'Bet',ja:'ベット',vi:'Cược'},
  categoryPayout:{ko:'페이아웃',zhHans:'派彩',zhHant:'派彩',en:'Payout',ja:'払戻',vi:'Chi trả'},
  noDataMsg:{ko:'데이터가 없습니다',zhHans:'暂无数据',zhHant:'暫無資料',en:'No data',ja:'データがありません',vi:'Không có dữ liệu'},

  // ---- Agent Admin — 정산리포트 ----
  settlementTitle:{ko:'정산리포트',zhHans:'结算报表',zhHant:'結算報表',en:'Settlement Report',ja:'精算レポート',vi:'Báo cáo quyết toán'},
  settlementSub:{ko:'하부 회원 입출금/윈로스/롤링 정산 현황',zhHans:'下属会员出入金/输赢/滚存结算状况',zhHant:'下屬會員出入金/輸贏/滾存結算狀況',en:'Downline deposit/withdrawal, win/loss, and rolling settlement',ja:'下位会員の入出金/ウィンロス/ローリング精算状況',vi:'Tình trạng quyết toán nạp/rút, thắng/thua, rolling của tuyến dưới'},
  statDeposit:{ko:'입금',zhHans:'入金',zhHant:'入金',en:'Deposit',ja:'入金',vi:'Nạp tiền'},
  statWithdraw:{ko:'출금',zhHans:'出金',zhHant:'出金',en:'Withdraw',ja:'出金',vi:'Rút tiền'},
  statRollingComm:{ko:'롤링커미션',zhHans:'滚存佣金',zhHant:'滾存佣金',en:'Rolling Commission',ja:'ローリングコミッション',vi:'Hoa hồng rolling'},
  colParentAccount:{ko:'상위어카운트',zhHans:'上级账户',zhHant:'上級帳戶',en:'Parent Account',ja:'上位アカウント',vi:'Tài khoản cấp trên'},
  colRolling:{ko:'롤링',zhHans:'滚存',zhHant:'滾存',en:'Rolling',ja:'ローリング',vi:'Rolling'},
  colMyRevenue:{ko:'내수익금',zhHans:'我的收益',zhHant:'我的收益',en:'My Revenue',ja:'私の収益',vi:'Doanh thu của tôi'},
  noSettlementData:{ko:'정산 데이터가 없습니다',zhHans:'暂无结算数据',zhHant:'暫無結算資料',en:'No settlement data',ja:'精算データがありません',vi:'Không có dữ liệu quyết toán'},

  // ---- Agent Admin — 실시간접속자 ----
  realtimeTitle:{ko:'실시간접속자',zhHans:'实时在线',zhHant:'即時在線',en:'Online Now',ja:'リアルタイム接続者',vi:'Đang trực tuyến'},
  realtimeSub:{ko:'최근 6시간 이내 로그인 기준 (데모)',zhHans:'以最近6小时内登录为准（演示）',zhHant:'以最近6小時內登入為準（演示）',en:'Based on logins within the last 6 hours (demo)',ja:'直近6時間以内のログイン基準（デモ）',vi:'Dựa trên đăng nhập trong 6 giờ qua (demo)'},
  statOnlineTotal:{ko:'총 접속자',zhHans:'在线总数',zhHant:'在線總數',en:'Total online',ja:'総接続者数',vi:'Tổng số đang online'},
  onlineMembersTitle:{ko:'접속중 회원',zhHans:'在线会员',zhHant:'在線會員',en:'Online Members',ja:'接続中の会員',vi:'Hội viên đang online'},
  colLastLogin:{ko:'최근접속',zhHans:'最近登录',zhHant:'最近登入',en:'Last Login',ja:'最終接続',vi:'Đăng nhập gần nhất'},
  onlineLabel:{ko:'온라인',zhHans:'在线',zhHant:'線上',en:'Online',ja:'オンライン',vi:'Trực tuyến'},
  noOnlineMembers:{ko:'접속 중인 회원이 없습니다',zhHans:'目前无在线会员',zhHant:'目前無在線會員',en:'No members currently online',ja:'接続中の会員がいません',vi:'Không có hội viên nào đang online'},

  // ---- Agent Admin — 내정보 변경 ----
  myInfoTitle:{ko:'내정보 변경',zhHans:'我的信息',zhHant:'我的資訊',en:'My Info',ja:'マイ情報',vi:'Thông tin của tôi'},
  accountInfoCard:{ko:'계정 정보',zhHans:'账户信息',zhHant:'帳戶資訊',en:'Account Info',ja:'アカウント情報',vi:'Thông tin tài khoản'},
  nameLabel:{ko:'이름',zhHans:'姓名',zhHant:'姓名',en:'Name',ja:'名前',vi:'Tên'},
  agentCodeLabel:{ko:'에이전트 코드',zhHans:'代理商代码',zhHant:'代理商代碼',en:'Agent Code',ja:'エージェントコード',vi:'Mã đại lý'},
  parentAccountLabel:{ko:'상위어카운트',zhHans:'上级账户',zhHant:'上級帳戶',en:'Parent Account',ja:'上位アカウント',vi:'Tài khoản cấp trên'},
  shareRateLabel:{ko:'쉐어율',zhHans:'分成比例',zhHant:'分成比例',en:'Share Rate',ja:'シェア率',vi:'Tỷ lệ share'},
  pwChangeCard:{ko:'비밀번호 변경',zhHans:'密码变更',zhHant:'密碼變更',en:'Change Password',ja:'パスワード変更',vi:'Đổi mật khẩu'},
  currentPwLabel:{ko:'현재 비밀번호',zhHans:'当前密码',zhHant:'目前密碼',en:'Current Password',ja:'現在のパスワード',vi:'Mật khẩu hiện tại'},
  newPw2Label:{ko:'새 비밀번호 확인',zhHans:'确认新密码',zhHant:'確認新密碼',en:'Confirm New Password',ja:'新しいパスワード確認',vi:'Xác nhận mật khẩu mới'},
  totalDownlineBalance:{ko:'하부 보유금 합계',zhHans:'下属余额合计',zhHant:'下屬餘額合計',en:'Downline Balance Total',ja:'下位保有金合計',vi:'Tổng số dư tuyến dưới'},
  avgBalance:{ko:'평균 보유금',zhHans:'平均余额',zhHant:'平均餘額',en:'Average Balance',ja:'平均保有金',vi:'Số dư trung bình'},
  recentFundMovement:{ko:'최근 자금 이동 내역',zhHans:'近期资金变动记录',zhHant:'近期資金變動記錄',en:'Recent Fund Movements',ja:'最近の資金移動履歴',vi:'Lịch sử chuyển quỹ gần đây'},
  savedToast:{ko:'저장되었습니다',zhHans:'已保存',zhHant:'已儲存',en:'Saved',ja:'保存されました',vi:'Đã lưu'},
  pwMismatchErr:{ko:'현재 비밀번호가 일치하지 않습니다',zhHans:'当前密码不正确',zhHant:'目前密碼不正確',en:'Current password does not match',ja:'現在のパスワードが一致しません',vi:'Mật khẩu hiện tại không đúng'},
  pwConfirmErr:{ko:'새 비밀번호를 확인해주세요',zhHans:'请确认新密码',zhHant:'請確認新密碼',en:'Please confirm your new password',ja:'新しいパスワードを確認してください',vi:'Vui lòng xác nhận mật khẩu mới'},
};

function t(key, vars){
  const entry = I18N_DICT[key];
  let s = entry ? (entry[I18N_LANG] || entry.ko || key) : key;
  if (vars) Object.entries(vars).forEach(([k,v])=>{ s = s.replace('{'+k+'}', v); });
  return s;
}
function setLang(lang){
  I18N_LANG = lang;
  localStorage.setItem('cageLang', lang);
  applyI18n();
  refreshLangButtons();
  if (typeof onLangChange === 'function') onLangChange();
}
/* the flag+name on every .lang-current button (there can be more than one - login screen,
   in-game header) isn't marked up with data-i18n, since it shows the CHOSEN language's own
   name rather than a translation of anything - so applyI18n() never touched it and it was
   left showing whatever was picked when the button was first drawn. Updated in place rather
   than re-rendering the whole switcher, since its .lang-drop now lives under <body> (see
   toggleLangDrop) and a fresh render would leave that orphaned instead of replacing it. */
function refreshLangButtons(){
  document.querySelectorAll('.lang-current').forEach(btn=>{
    const spans = btn.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = I18N_FLAG[I18N_LANG];
    if (spans[1]) spans[1].textContent = I18N_NATIVE[I18N_LANG];
  });
}
function applyI18n(root){
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  root.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.getAttribute('data-i18n-title')); });
}
function langSwitcherHtml(id){
  return `<div class="lang-switcher" id="${id}">
    <button type="button" class="lang-current" onclick="toggleLangDrop('${id}')">
      <span>${I18N_FLAG[I18N_LANG]}</span><span>${I18N_NATIVE[I18N_LANG]}</span>
    </button>
    <div class="lang-drop" id="${id}-drop">
      ${Object.keys(I18N_NATIVE).map(code=>`<div class="lang-opt" onclick="setLang('${code}');document.getElementById('${id}-drop').classList.remove('open')"><span>${I18N_FLAG[code]}</span><span>${I18N_NATIVE[code]}</span></div>`).join('')}
    </div>
  </div>`;
}
/* .lang-drop is position:fixed (see shared/game-ui.css), but that alone isn't enough: the
   header it usually opens from sets backdrop-filter, which makes the header itself the
   containing block for any position:fixed descendant (per spec) - so the drop was still
   getting clipped by the header's own overflow-y:hidden (its horizontal-scroll safety net on
   narrow screens) even after switching off position:absolute. Moving the drop out to be a
   direct child of <body> on first open sidesteps that entirely; it stays there afterward
   (toggling 'open' just shows/hides it) since the button it belongs to never moves, so a
   later open can still find it by id and re-measure the button's rect. */
function toggleLangDrop(id){
  const drop = document.getElementById(id + '-drop');
  if (!drop) return;
  const opening = !drop.classList.contains('open');
  drop.classList.toggle('open', opening);
  if (!opening) return;
  if (drop.parentElement !== document.body) document.body.appendChild(drop);
  const btn = document.querySelector(`#${id} .lang-current`);
  const r = btn.getBoundingClientRect();
  const w = drop.offsetWidth || 130;
  let left = r.right - w;
  if (left < 6) left = 6;
  if (left + w > window.innerWidth - 6) left = window.innerWidth - 6 - w;
  drop.style.left = left + 'px';
  drop.style.top = (r.bottom + 6) + 'px';
}
document.addEventListener('DOMContentLoaded', ()=> applyI18n());
