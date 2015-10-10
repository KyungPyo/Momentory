/*NPM, 변수선언*/
var async = require('async')
	logger = require('../config/logger'),	// Log 기록용
	sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음


/*****************/



/*** 메인화면 코드 시작 ***/
// APP 메인화면에 필요한 정보 요청
exports.getMain = function(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			logger.debug("getMain ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "getMain ConnectionPool 에러 발생 : ");
		} else {
			var userid = req.user.userid;	// 현재 로그인한 사용자
			/** 사용할 쿼리문별 함수 설정 **/
			// 커플 만나온 일수
			function getCoupleday(callback){

				// 만나온 일수 받아오기
				var selectQuery="SELECT to_days(sysdate() + interval 9 hour)-to_days(ann.anni_date) as 'coupleday' "+
								"FROM anniversary ann join (SELECT userid1, userid2 FROM couple "+
								"WHERE userid1 = ? or userid2 = ?) myc "+
								"on ann.userid1=myc.userid1 and ann.userid2=myc.userid2 WHERE anni_type=1";
				
				connection.query(selectQuery, [userid, userid], function(err, rows, fields){
					if (err) {
						connection.release();
						logger.debug("만나온 일수 받아오는 과정에서 에러 발생 : ", err);
						sendAPIResult(res, err, null, "만나온 일수 받아오는 과정에서 에러 발생 : ");
					} else {
						if(rows.length){	// 값이 있는 경우
							callback(null, rows[0].coupleday);	// 결과 전송
						} else {	// 값이 없는 경우
							// 사귄날을 설정하지 않은 경우이므로 null을 결과에 전송
							callback(null, null);
						}
					}
				});
				
			}
			
			// 편지 주고받은 갯수(읽은것만)
			function getLetterCount(callback){

				// 주고받은 읽은편지 갯수 받아오기
				var selectQuery="SELECT count(*) 'lettercount' from letter "+
								"where (sender_userid=? or receiver_userid=?) and receive_confirm=1";
				
				connection.query(selectQuery, [userid, userid], function(err, rows, fields){
					if (err) {
						connection.release();
						logger.debug("편지 주고받은 갯수 받아오는 과정에서 에러 발생 : ", err);
						sendAPIResult(res, err, null, "편지 주고받은 갯수 받아오는 과정에서 에러 발생 : ");
					} else {
						callback(null, rows[0].lettercount);	// 결과 전송
					}
				});
				
			}
			
			// 사용자 정보
			function getUsersInfo(callback){
				
				// 커플 두명 프로필 정보 받아오기(두개 중 내 정보가 위에 나옴)
				var selectQuery="SELECT userid, username, email, date_format(birthday, '%Y-%m-%d') 'birthday', phone, profileimg, userpoint "+
								"FROM user JOIN couple on (userid1=userid or userid2=userid) "+
								"where userid1=? or userid2=? order by case when userid<=? then userid end desc";
				
				connection.query(selectQuery, [userid, userid, userid], function(err, rows, fields){
					if (err) {
						connection.release();
						logger.debug("사용자 정보 받아오는 과정에서 에러 발생 : ", err);
						sendAPIResult(res, err, null, "사용자 정보 받아오는 과정에서 에러 발생 : ");
					} else {
						if(rows.length == 2){	// 커플 두명에 해당하는 쿼리문 결과가 나와야 함 
							callback(null, rows);	// 결과 배열 전송
						} else {
							connection.release();
							logger.debug("사용자 정보가 두명이 아닙니다. : "+rows.length+"명");
							sendAPIResult(res, new Error(), null, "사용자 정보가 두명이 아닙니다. : "+rows.length+"명");
						}
					}
				});
				
			}
			
			// 가장 가까운 기념일 정보
			function getClosestAnni(callback){

				// 가장 가까운 기념일 하나의 dday를 포함한 정보 받아오기
				var selectQuery="SELECT ann.anniid, ann.anni_date, ann.anni_name, "+
								"to_days(sysdate() + interval 9 hour)-to_days(ann.anni_date) as 'dday' "+
								"FROM anniversary ann join (SELECT userid1, userid2 FROM couple "+
								"WHERE userid1 = ? or userid2 = ?) myc "+
								"on ann.userid1=myc.userid1 and ann.userid2=myc.userid2 "+
								"WHERE anni_type=2 and (to_days(sysdate())-to_days(ann.anni_date)) <= 0 "+
								"ORDER BY dday desc LIMIT 0, 1";
				
				connection.query(selectQuery, [userid, userid], function(err, rows, fields){
					if (err) {
						connection.release();
						logger.debug("기념일 정보 받아오는 과정에서 에러 발생 : ", err);
						sendAPIResult(res, err, null, "기념일 정보 받아오는 과정에서 에러 발생 : ");
					} else {
						if(rows.length){	// 값이 있는 경우
							callback(null, rows[0]);	// 결과 전송
						} else {	// 값이 없는 경우
							// 다가올 예정일이 없는 경우이므로 null을 결과에 전송
							callback(null, null);
						}
					}
				});
				
			}
			
			
			// series로 순차적으로 함수 실행
			async.series([getCoupleday, getLetterCount, getUsersInfo, getClosestAnni], function(err, results){
				if (err) {
					connection.release();
					logger.debug("메인화면 정보를 불러오는데 실패하였습니다. : ", err);
					sendAPIResult(res, err, null, "메인화면 정보를 불러오는데 실패하였습니다. : ");
				} else {
					console.log(userid)
					var jsonResult = {};	// 결과 전송용 객체
					jsonResult.coupleday = results[0];
					jsonResult.lettercount = results[1];
					jsonResult.user = results[2];
					jsonResult.anni = results[3];
					
					process.nextTick(function(){
						connection.release();
						sendAPIResult(res, null, jsonResult, "메인화면 정보 요청 성공");
					});
				}
			});
		}
	});
};
/*** 메인화면 코드 끝 ***/