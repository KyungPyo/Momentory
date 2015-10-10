/*NPM, 변수선언*/
var async = require('async'),
	express = require('express'),
	pushMessage = require('./push')
	gcm = require('node-gcm'),
	gcmConfig = require('../config/gcm'),	// GCM용 apikey 보관중
	logger = require('../config/logger'),	// Log 기록용
	pushMessage = require('./push'),
	sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음


/*** 쪽지관련 코드 시작 ***/
//쪽지 목록 요청
function getShortList(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			sendAPIResult(res, err, null, "getShortList ConnectionPool 에러 발생 : ");
		} else {
			var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
			var datetime = req.params.date;		// 클라이언트가 가지고 있는 가장 최신 편지의 날짜
			var sor = req.params.sor;		// 보낸쪽지함(1)인지 받은쪽지함(0)인지 구분
			
			// 파라미터로 넘겨받은 userid, sor 값이 숫자인 경우 실행
			if(userid > 0 && (sor == 0 || sor == 1)){
				var selectQuery = "SELECT message_id, sender.username sender_name, receiver.username receiver_name, "+
								  "date_format(send_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'send_date', " + 
								  "date_format(receive_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'receive_date', " +
								  "content, receive_confirm " +
								  "FROM shortMessage sm JOIN user sender ON sm.sender_userid = sender.userid " +
								  "JOIN user receiver ON sm.receiver_userid = receiver.userid ";
				if(sor==0){
					selectQuery += "where receiver_userid=?";
				} else {
					selectQuery += "where sender_userid=?";
				}
				if(datetime==1){
					selectQuery += " and send_date > ?";
				} else {
					selectQuery += " and send_date > (?- interval 9 hour)";
				}
				
				process.nextTick(function(){
					connection.query(selectQuery, [userid, datetime], function(err, rows, fields){
						if (err) {	// 쿼리문 처리중 오류 발생
	                        connection.release();
							sendAPIResult(res, err, null, "DB에서 쪽지목록을 요청하는 과정에서 에러 발생 : ");
						} else {
							// async의 반복해서 배열로 이어붙이기
							async.map(rows, function(shortMsg, callback){
								callback(null, shortMsg);
							}, 
							function(err, results){
								if(err){
									return console.log(err);
								}
	                            connection.release();
								// 성공 결과 전송
								sendAPIResult(res, null, {"list" : results}, "쪽지 목록 요청 성공");
							});
						}
					});
				});
				
			} else {	// userid 파라미터 값이 숫자가 아닌 잘못된 값이 들어온 경우
                connection.release();
				res.json({
					"isSuccess" : false,
					"result" : null,
					"msg" : "클라이언트에서 전달받은 파라미터 값이 잘못된 형식입니다."
				});
			}
		}
	});
}

//쪽지 읽음정보 업데이트
function setShortConfirm(req, res) {
	/** 읽음 확인이 되면 갱신 요청 푸쉬를 쪽지 보낸사람에게 날려야함 **/
	connectionPool.getConnection(function(err, connection){
		if(err){
        	logger.debug("setShortConfirm ConnectionPool 에러 발생 : "+err);
            sendAPIResult(res, err, null, "setShortConfirm ConnectionPool 에러 발생 : ");
		} else {
			var userid = req.user.userid;
			var messageid = req.params.messageid;		// 클라이언트에서 넘겨준 읽은 쪽지번호
			var isConfirm = req.body.isConfirm;			// 읽은건지(1) 못읽은건지(0)에 대한 정보
			var query = '';
			
			connection.beginTransaction(function(err){
				if (err) {
                    connection.release();
                    logger.debug("setShortConfirm Transaction 에러 발생 : "+err);
                    sendAPIResult(res, err, null, "setShortConfirm Transaction 에러 발생 : ");
				} else {
					async.series(
						[
							function(callback){
								if (isConfirm) {	// 읽었으면 update 못읽었으면 delete
									query = "UPDATE shortMessage SET receive_confirm=? WHERE message_id=?";
								} else {
									query = "DELETE FROM shortMessage WHERE receive_confirm=? and message_id=?"
								}
								
								connection.query(query, [isConfirm, messageid], function(err, results){
									if(err){
										callback(err);
									} else {
										// 쪽지 읽음여부를 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 구분정보와 읽음여부가 들어간다.)
										// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
										var pushArr = [];
										var pushVal1 = {key:'pushtype', value:'msg_confirm'};
										var pushVal2 = {key:'isConfirm', value : isConfirm};
										var pushVal3 = {key:'messageid', value : messageid};
										pushArr.push(pushVal1);
										pushArr.push(pushVal2);
										pushArr.push(pushVal3);
										pushMessage(userid, pushArr, function(msg){
											callback();
										});
									}
								});
						 	},
						 	function(callback){
						 		if (isConfirm) {	// 읽었으면 userpoint+1 update 못읽었으면 건너뜀
									query = "update user set userpoint=(userpoint+1) where userid=" +
											"(SELECT case userid1 when ? then userid2 else userid1 end "+
											"'receiver' FROM couple WHERE userid1 = ? or userid2 = ?)";
									
									connection.query(query, [userid, userid, userid], function(err, results){
										if(err){
											callback(err);
										} else {
											callback();
										}
									});
								} else {	// 못읽었으면 포인트 추가 안하고 종료
									callback();
								}
						 	}
						], 
						function(err, result){
							if (err) {
								connection.rollback(function() {	// 작업 실패로 롤백
									connection.release();
									sendAPIResult(res, err, null, "setShortConfirm Error : ");
								});
							} else {
								connection.commit(function(err) {	// 작업 성공시 커밋
                                    if (err) {
                                        connection.rollback(function() {
                                            connection.release();
                                            logger.debug("setShortConfirm 커밋 과정에서 에러 발생 : "+err);
                                            sendAPIResult(res, err, null, "커밋 과정에서 에러 발생 : ");
                                        });
                                    } else {
                                        connection.release();
                                        sendAPIResult(res, null, {}, "해당 쪽지 읽음상태 변경완료. ");
                                    }
                                });
							}
						}
					);	//serise 끝
				}
			});	// Transaction 끝
		}
	});
}

//커플 상대방에게 쪽지 전송
function writeShort(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
            sendAPIResult(res, err, null, "writeShort ConnectionPool 에러 발생 : ")
			res.json({
				"isSuccess" : false,
				"result" : null,
				"msg" : "ConnectionPool 에러 발생"
			});
		} else {
			// 클라이언트에서 POST로 전송한 값 저장
			var sender = req.user.userid;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
			var content = req.body.content;
			
			// 편지를 수신할 커플 상대방 찾기
			var selectQuery = "SELECT userid1, userid2 FROM couple WHERE userid1=? or userid2=?";
			connection.query(selectQuery, [sender, sender], function(err, rows, fields){
				if(err){
                    connection.release();
                    logger.debug("DB에서 편지 수신자를 검색하는 과정에서 에러 발생 : "+err);
                    sendAPIResult(res, err, null, "DB에서 편지 수신자를 검색하는 과정에서 에러 발생 : ")
				} else {
					// 보낸사람으로 검색된 커플의 결과가 하나인 경우에만 실행
					if(rows.length == 1){
						var receiver;
						// 보낸사람을 기준으로 찾은 커플정보에서 수신자를 찾아 저장한다
						if(rows[0].userid1 == sender){
							receiver = rows[0].userid2;
						} else {
							receiver = rows[0].userid1;
						}
						
						// 편지 DB에 Insert
						var insertQuery = "INSERT INTO shortMessage (`sender_userid`, `receiver_userid`, `content`) VALUES (?, ?, ?)";
						connection.query(insertQuery, [sender, receiver, content], 
								function(err, results){
							if(err){
                                connection.release();
                                logger.debug("DB에 편지내용을 저장하는 과정에서 에러 발생 : "+err);
                                sendAPIResult(res, err, null, "DB에 편지내용을 저장하는 과정에서 에러 발생 : ")
							} else {
								// 쪽지 보냈다고 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 쪽지 푸쉬라는 구분정보만 들어간다.)
								// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
								var pushArr = [];
								var pushVal = {key:'pushtype', value:'msg_received'};
								pushArr.push(pushVal);
								pushMessage(sender, pushArr, function(msg){
				                    connection.release();
									sendAPIResult(res, null, {}, "쪽지 전송 성공. " + msg);
								});
							}
						});
						
					}else if(rows.length>1){	// 검색된 커플의 결과가 두개 이상인 경우 실행
                        connection.release();
                        logger.debug("커플로 검색된 사람이 두명 이상입니다. 관리자에게 문의하세요.");
                        sendAPIResult(res, ' ', null, "커플로 검색된 사람이 두명 이상입니다. 관리자에게 문의하세요.");
					} else {	// 검색된 커플 결과가 없는 경우 실행
                        connection.release();
                        logger.debug("커플로 검색된 사람이 없습니다. 관리자에게 문의하세요.");
                        sendAPIResult(res, ' ', null, "커플로 검색된 사람이 없습니다. 관리자에게 문의하세요.");
					}
				}
			});
		}
	});
}
/*** 쪽지관련 코드 끝 ***/


//로그인 여부 확인 미들웨어
function isLoggedIn(req, res, next){
  if(req.isAuthenticated()){
      return next();
  }

  return res.json({
      "isSuccess" : false,
      "result" : null,
      "msg" : "로그인이 필요한 작업입니다."
  });
}


module.exports = function(app) {
	app.get('/shortmsg/list/:date/:sor', getShortList);
	app.post('/shortmsg/:messageid/confirm', isLoggedIn, setShortConfirm);
	app.post('/shortmsg/write', express.bodyParser(), isLoggedIn, writeShort);
};