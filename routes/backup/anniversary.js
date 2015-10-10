/*NPM, 변수선언*/
var async = require('async'),
	express = require('express'),
	logger = require('../config/logger'),	// Log 기록용
	sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음


/*** 기념일관련 코드 시작 ***/
//기념일 추가
function addAnniversary(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			sendAPIResult(res, err, null, "addAnniversary ConnectionPool 에러 발생 : ");
		} else {
			// 클라이언트에서 전송한 값 저장(기념일 날짜, 기념일 이름, 기념일 종류)
			var anni_date = req.body.anni_date;
			var anni_name = req.body.anni_name;
			var anni_type = req.body.anni_type;
			var userid = req.session.passport.user;	// 현재 접속중인 사용자
			
			if(anni_date && anni_name && anni_type){	// 클라이언트로부터 전달된 값이 다 입력됐는지 확인
				// 현재 작업을 요청한 사용자의 커플 정보 획득
				var selectQuery = "SELECT userid1, userid2 FROM couple WHERE userid1=? or userid2=?";
				
				connection.query(selectQuery, [userid, userid], function(err, rows, fields){
					if(err){
						connection.release();
						sendAPIResult(res, err, null, "DB에서 현재 사용자의 커플정보를 검색하는 과정에서 에러 발생(1) : ");
					} else {
						if(rows.length==1){		// 커플정보 검색결과가 하나인 경우에만 실행
							// 커플 사용자번호를 각각 저장
							var user1 = rows[0].userid1;
							var user2 = rows[0].userid2;
							// 기념일 추가 쿼리문 작성
							var insertQuery = "INSERT INTO anniversary (`anni_date`, `anni_name`, `anni_type`, `userid1`, `userid2`) " +
											  "VALUES (?, ?, ?, ?, ?);";
							
							connection.query(insertQuery, [anni_date, anni_name, anni_type, user1, user2], 
											function(err, results){
								if(err){
									connection.release();
									sendAPIResult(res, err, null, "DB에 기념일을 추가하는 과정에서 에러 발생(1) : ");
								} else {
									if(results.affectedRows==1){
										connection.release();
										sendAPIResult(res, null, {}, "기념일 추가 성공");
									} else {
										connection.release();
										sendAPIResult(res, err, null, "DB에 기념일을 추가하는 과정에서 에러 발생(2) : ");
									}
								}
							});
						} else {
							connection.release();
							sendAPIResult(res, err, null, "DB에서 현재 사용자의 커플정보를 검색하는 과정에서 에러 발생(2) : ");
						}
					}
				});
			} else {
				sendAPIResult(res, new Error(), null, "기념일 날짜, 이름, 종류를 입력받지 못했습니다.");
			}
		}
	});
}

//기념일 수정
function updateAnniversary(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			sendAPIResult(res, err, null, "ConnectionPool 에러 발생 : ");
		} else {
			var anniid = req.body.anniid;	// 수정할 기념일 고유번호
			var anni_date = req.body.anni_date;		// 수정할 날짜
			var anni_name = req.body.anni_name;		// 수정할 기념일 이름
			var anni_type = req.body.anni_type;		// 수정할 기념일 종류
			
			var updateQuery = "UPDATE anniversary SET anni_date=?, anni_name=?, "+
							  "anni_type=? WHERE anniid=?";
			connection.query(updateQuery, [anni_date, anni_name, anni_type, anniid],
							function(err, results){
				if(err){
					connection.release();
					sendAPIResult(res, err, null, "DB에서 기념일을 수정하는 과정에서 에러 발생");
				} else {
					connection.release();
					if(results.affectedRows>0){
						sendAPIResult(res, null, {}, "기념일 수정 성공");
					} else {
						sendAPIResult(res, err, null, "해당되는 기념일 정보가 DB에 없습니다 : ");
					}
				}
			});
		}
	});
};

//기념일 삭제
function deleteAnniversary(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			sendAPIResult(res, err, null, "ConnectionPool 에러 발생 : ");
		} else {
			var anniid = req.body.anniid;	// 삭제할 기념일 고유번호
			
			var deleteQuery = "DELETE FROM anniversary WHERE anniid=?";
			connection.query(deleteQuery, [anniid], function(err, results){
				if(err){
					connection.release();
					sendAPIResult(res, err, null, "DB에서 기념일을 삭제하는 과정에서 에러 발생 : ");
				} else {
					connection.release();
					sendAPIResult(res, null, {}, "기념일 삭제 성공");
				}
			});
		}
	});
}

//기념일 목록 요청
function getAnniversary(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			sendAPIResult(res, err, null, "ConnectionPool 에러 발생 : ");
		} else {
			var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
			
			// 세션으로 넘겨받은 userid 값이 숫자인 경우 실행
			if(userid > 0){
				// 내가 속한 커플을 찾아서 그 커플에 해당하는 기념일 목록 출력
				var selectQuery = "SELECT ann.anniid, date_format(ann.anni_date, '%Y-%m-%d') 'anni_date', ann.anni_name, ann.anni_type, " +
								  "to_days(sysdate())-to_days(ann.anni_date) as 'dday' " +
								  "FROM anniversary ann join (SELECT userid1, userid2 FROM couple " +
								  "WHERE userid1 = ? or userid2 = ?) myc " +
								  "on ann.userid1=myc.userid1 and ann.userid2=myc.userid2";
				
				connection.query(selectQuery, [userid, userid], function(err, rows, fields){
					if (err) {	// 쿼리문 처리중 오류 발생
						connection.release();
						sendAPIResult(res, err, null, "DB에서 기념일목록을 요청하는 과정에서 에러 발생 : ");
					} else {
						// async의 반복해서 결과값 레코드들을 배열로 이어붙이기 [rows1, rows2 ...]
						async.map(rows, function(anniversary, callback){
							callback(null, anniversary);
						},
						function(err, results){
							if(err){
								return logger.debug(err);
							}
							connection.release();
							// 성공 결과 전송
							sendAPIResult(res, null, {"list":results}, "기념일 목록 요청 성공");
						});
					}
				});
			} else {	// userid 값이 숫자가 아닌 잘못된 값이 들어온 경우
				connection.release();
				sendAPIResult(res, new Error(), null, "클라이언트에서 전달받은 세션의 사용자 식별 값이 잘못된 형식입니다.");
			}
		}
	});
}
/*** 기념일관련 코드 끝 ***/


module.exports = function(app) {
	app.post('/couple/anniversary/add', express.bodyParser(), addAnniversary);
	app.post('/couple/anniversary/modify', express.bodyParser(), updateAnniversary);
	app.post('/couple/anniversary/delete', express.bodyParser(), deleteAnniversary);
	app.get('/couple/anniversary/list', getAnniversary);
};