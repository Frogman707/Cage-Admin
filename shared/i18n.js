/* ============================================================
   CAGE ADMIN 5.0 — shared 6-language i18n for the player-facing
   Avatar Speed site. ko/en/zhHant/zhHans/ja/vi. Partner Admin stays
   Korean (internal staff tool) and is not covered here.

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
  themeLabel:{ko:'테마',zhHans:'主题',zhHant:'主題',en:'Theme',ja:'テーマ',vi:'Giao diện'},
  themeDark:{ko:'다크',zhHans:'深色',zhHant:'深色',en:'Dark',ja:'ダーク',vi:'Tối'},
  themeLight:{ko:'라이트',zhHans:'浅色',zhHant:'淺色',en:'Light',ja:'ライト',vi:'Sáng'},

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
  if (typeof onLangChange === 'function') onLangChange();
}
function applyI18n(root){
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  root.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.getAttribute('data-i18n-title')); });
}
function langSwitcherHtml(id){
  return `<div class="lang-switcher" id="${id}">
    <button type="button" class="lang-current" onclick="document.getElementById('${id}-drop').classList.toggle('open')">
      <span>${I18N_FLAG[I18N_LANG]}</span><span>${I18N_NATIVE[I18N_LANG]}</span>
    </button>
    <div class="lang-drop" id="${id}-drop">
      ${Object.keys(I18N_NATIVE).map(code=>`<div class="lang-opt" onclick="setLang('${code}');document.getElementById('${id}-drop').classList.remove('open')"><span>${I18N_FLAG[code]}</span><span>${I18N_NATIVE[code]}</span></div>`).join('')}
    </div>
  </div>`;
}
document.addEventListener('DOMContentLoaded', ()=> applyI18n());
