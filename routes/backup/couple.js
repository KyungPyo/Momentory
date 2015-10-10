/*NPM, 변수선언*/
var async = require('async'),
    express = require('express'),
    schedule = require('node-schedule'),
	logger = require('../config/logger'),	// Log 기록용
	pushMessage = require('./push'),
	sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음


/*** 커플관련 코드 시작 ***/

/** 커플 인증코드 생성 신청 **/
//커플 인증코드 생성 함수 async
function genCoupleCode(userid, callback){
    // 코드만들기 uid 사용하여 5자리 문자열 생성
    var authkey = Math.random().toString(35).substr(2, 5);

    // 다음단계(중복검사)로 새성한 키를 넘겨준다
    callback(null, authkey, userid);
}

//커플 인증코드 중복 검사 함수 async
function checkCoupleCode(code, userid, callback){
    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("checkCoupleCode ConnectionPool 에러 발생 : "+err);
            sendAPIResult(res, err, null, "checkCoupleCode ConnectionPool 에러 발생 : ");
        } else {
            // 입력한 코드로 select문을 실행하여 일치하는 값이 있는지 확인.
            // 아직 중복되는 경우 다시 생성하는 구문이 없음.
            connection.query("SELECT count(*) count FROM authcode where authkey=?", [code],
                function(err, rows){
                    if(err){
                        console.log(err);
                    }

                    // 중복되는 코드값이 있는지 없는지 체크
                    if(rows[0].count != 0){
                        callback(null, 'duplicated_code');
                    } else {
                        //현재 코드 신청하는 사용자가 이미 코드를 가지고 있는지 확인.
                        connection.query("SELECT count(*) count FROM authcode where userid=?", [userid],
                            function(err, rows){
                                // 중복 사용자 있는지 체크
                                if(rows[0].count != 0){
                                    callback(null, 'user_exist');
                                } else {
                                    // 중복값이 없으면 생성한 코드를 결과로 넘겨준다.
                                    callback(null, code);
                                }
                            });
                    }
                });
        }
    });
}

//커플 인증코드 생성 신청
function createCoupleCode(req, res) {
    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("createCoupleCode ConnectionPool 에러 발생 : "+err);
            sendAPIResult(res, err, null, "createCoupleCode ConnectionPool 에러 발생 : ");
        } else {
            var userid = req.user.userid;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
            var error = null;	// error 발생 시 저장하고 출력해줌
            // async waterfall 사용해서, 커플인증코드 생성 -> 중복체크 -> DB에 저장 순으로 실행
            async.waterfall([ function(callback){callback(null, userid)}, // waterfall에 userid를 넘겨주기 위한 함수
                genCoupleCode, checkCoupleCode ], function(err, result) {
                if (err) {
        			connection.release();
                    console.log(err);
                    error = err;
                } else if(result == 'duplicated_code'){
        			connection.release();
                    res.json({
                        "isSuccess" : false,
                        "result" : null,
                        "msg" : "중복되는 코드가 있습니다. 다시 시도해주세요."
                    });
                } else if(result == 'user_exist'){
        			connection.release();
                    res.json({
                        "isSuccess" : true,
                        "result" : null,
                        "msg" : "이미 코드가 있는 사용자입니다."
                    });
                } else {
                    var authkey = result;	// 결과값으로 받은 코드

                    // 생성한 코드값과 userid 값으로 authcode 테이블에 입력한다.
                    var insertQuery = "INSERT INTO `momentory`.`authcode` (`userid`, `authkey`) VALUES (?, upper(?))";
                    connection.query(insertQuery, [userid, authkey], function(err, result){
                        if(err){
                            error = err;
                        } else {
                        	/** 생성된 코드값 10분 유효기간 주기 **/
                        	// 스케쥴 설정할 시간 받아오기 쿼리
                        	var selectQuery = "SELECT date_format(addtime(regtime, '09:10:03'), '%Y') 'year', "+
                        					  "date_format(addtime(regtime, '09:10:03'), '%c')-1 'month', "+
                        					  "date_format(addtime(regtime, '09:10:03'), '%e') 'day', "+
                        					  "date_format(addtime(regtime, '09:10:03'), '%H') 'hour', "+
                        					  "date_format(addtime(regtime, '09:10:03'), '%i') 'minute', "+
                        					  "date_format(addtime(regtime, '09:10:03'), '%s') 'second' "+
                        					  "from authcode where userid=?";
                        	
                        	connection.query(selectQuery, [userid], function(err, rows, fields){
                        		if (err) {
                        			connection.release();
                        			res.json({
                                        "isSuccess" : true,
                                        "result" : null,
                                        "msg" : "커플인증코드 삭제 스케쥴 설정 중 에러(1) : "+err
                                    });
                        		} else {
		                        	
		                        	// 시간 (년, 월(0-11), 일, 시(0-23), 분, 초)
		                        	var secheduledTime = new Date(rows[0].year, rows[0].month, rows[0].day, rows[0].hour, rows[0].minute, rows[0].second);
		                        	var scheduledJob = schedule.scheduleJob(secheduledTime, function(){
		                        		// 스케쥴용 커넥션 연결
		                        		connectionPool.getConnection(function(err, connection){
		                        	        if(err){
		                        	            res.json({
		                        	                "isSuccess" : false,
		                        	                "result" : null,
		                        	                "msg" : "ConnectionPool 에러 발생"
		                        	            });
		                        	        } else {
				                            	// delete 쿼리
				                            	var deleteQuery = "DELETE FROM authcode WHERE userid=?";
			                        			
				                            	connection.query(deleteQuery, [userid], function(err, results){
				                            		if (err) {
				                            			connection.release();
				                            			logger.debug('커플인증코드 10분후 삭제 안됐음. 사용자 : '+ userid);
				                            		} else {
				                            			if(results.affectedRows){	// 삭제된 레코드가 있는 경우 로그 기록
					                            			logger.info('커플코드 삭제됨. 사용자 : '+userid);
				                            			}
				                            			connection.release();
				                            		}
				                            	});
		                        	        }
		                        		});
	                        		});
                        		}
                        	});
                        }
                    });

                    if(error){	// 도중에 에러가 발생해서 error 값이 null이 아닌경우 실패값 전송
            			connection.release();
                        res.json({
                            "isSuccess" : false,
                            "result" : null,
                            "msg" : error
                        });
                    } else {	// error값이 null인 상태로 무사히 실행된 경우
            			connection.release();
                        res.json({
                            "isSuccess" : true,
                            "result" : {},
                            "msg" : "커플 인증코드 생성 신청 완료"
                        });
                    }
                }
            });
        }
    });
}
/** 커플 인증코드 생성 신청 **/


//생성된 인증코드 받아오기(화면출력용)
function getCoupleCode(req, res) {
    connectionPool.getConnection(function(err, connection){
        if(err){
            res.json({
                "isSuccess" : false,
                "result" : null,
                "msg" : "ConnectionPool 에러 발생"
            });
        } else {
//			var userid = req.params.userid;	// url 파라미터로 받은 userid(사용자 식별자) 값
            var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
            // userid 가 일치하는 인증코드를 검색하여 출력한다.
            var selectQuery = "select authkey from authcode where userid=?";
            connection.query(selectQuery, [userid], function(err, rows, fields){
                if(err){	// 쿼리문 에러 발생시
                    res.json({
                        "isSuccess" : false,
                        "result" : null,
                        "msg" : err
                    });
                    console.log(err);
                }

                if(rows.length){	// 검색된 값이 있는 경우
                    res.json({
                        "isSuccess" : true,
                        "result" : {
                            "authcode" : rows[0].authkey
                        },
                        "msg" : "인증코드 수신완료"
                    });
                } else {	// 검색된 값이 없는 경우
                    res.json({
                        "isSuccess" : true,
                        "result" : {
                            "authcode" : null
                        },
                        "msg" : "해당 사용자에 대한 인증코드가 없습니다."
                    });
                }
            });
        }
    });
};


/** 커플 되기 **/
//입력받은 커플 인증코드가 존재하는지 검색
function coupleSelect(userid, authcode, callback){
    connectionPool.getConnection(function(err, connection){
        if(err){
            res.json({
                "isSuccess" : false,
                "result" : null,
                "msg" : "ConnectionPool 에러 발생"
            });
        } else {
            var other_userid;		// 쿼리문으로 받아올 '인증코드를 가지고 있는 사용자ID'
            // 현재 입력된 인증코드로 검색하여 해당 인증코드를 가지고 있는 사용자를 DB에서 받아온다.
            var selectQuery = "select userid from authcode where authkey=?";
            connection.query(selectQuery, [authcode], function(err, rows, fields){
                if(err){
                    console.log(err);
                    callback(err, "db_error");
                }
                if(rows.length){	// 넘겨받은 인증코드로 검색된 값이 있는 경우
                    other_userid = rows[0].userid;	// 검색된 결과에서 해당 인증코드를 가지고 있는 사용자ID를 받아옴
                    callback(null, userid, other_userid, authcode);	//정상 select 되면 insert 단계로
                } else {	// 넘겨받은 인증코드로 검색된 값이 없는경우
                    callback(new Error("일치하는 코드가 없음"), "no_code");
                }
            });
        }
    });
}

//커플인증 성공시 커플로 추가
function coupleInsert(userid, other_userid, authcode, callback){
    connectionPool.getConnection(function(err, connection){
        if(err){
            res.json({
                "isSuccess" : false,
                "result" : null,
                "msg" : "ConnectionPool 에러 발생"
            });
        } else {
            // 인증된 두 사용자를 새로운 커플관계로 DB 테이블에 추가한다.
            var insertQuery = "INSERT INTO `momentory`.`couple` (`userid1`, `userid2`) "
                + "VALUES (?, ?)";
            connection.query(insertQuery, [ other_userid, userid ], function(err, result) {
                if (err) {
                    connection.rollback(function() {
                        console.log(err);
                        callback(err, "db_error");
                    });
                } else {
                    console.log('inserted ' + result.affectedRows + ' rows');
                    callback(null, authcode);	// 정상 insert 되면 delete 단계로
                }
            });
        }
    });
}

//커플추가 성공시 사용한 인증코드 테이블에서 삭제
function authcodeDelete(authcode, callback){
    connectionPool.getConnection(function(err, connection){
        if(err){
            res.json({
                "isSuccess" : false,
                "result" : null,
                "msg" : "ConnectionPool 에러 발생"
            });
        } else {
            // 커플 추가가 끝나면 사용한 인증코드는 테이블에서 삭제한다.
            var deleteQuery = "delete from authcode where authkey=?";
            connection.query(deleteQuery, [authcode], function(err,result){
                if(err){
                    connection.rollback(function() {
                        console.log(err);
                        callback(err, "db_error");
                    });
                }
                console.log('deleted ' + result.affectedRows + ' rows');
                callback(null, "complete");	//정상 delete 되면 결과 단계로
            });
        }
    });
}

//커플 신청 수락
function acceptCouple(req, res) {

    var userid = req.user.userid;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
    var authcode = req.body.authcode;	// post로 넘겨받은 인증코드값

    if(authcode){	// 넘어온 인증코드가 있는 경우 실행

        // waterfall 방식으로 1.값넘겨주기,2.select,3.insert,4.delete 순으로 실행
        async.waterfall([ function(callback){
                // 값 다음으로 넘겨줌
                callback(null, userid, authcode);
            },
            coupleSelect,
            coupleInsert, 
            authcodeDelete 
            ],
            function(err, result) {

                if(result == "no_code"){
                    // 결과가 일치하는 코드 검색 결과가 없다고 나올 경우
                    res.json({
                        "isSuccess" : false,
                        "result" : null,
                        "msg" : "입력한 인증코드와 일치하는 정보가 없습니다. 상대방의 인증코드를 다시 확인해주세요."
                    });
                }else if(result == "db_error"){
                    // DB 쿼리문 실행중 오류가 발생한 경우
                    res.json({
                        "isSuccess" : false,
                        "result" : null,
                        "msg" : "데이터베이스 작업 중 오류가 발생했습니다."
                    });
                } else {

        			// 커플이 됐다고 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 구분정보만 들어간다.)
        			// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
        			var pushArr = [];
        			var pushVal = {key:'pushtype', value:'couple_done'};
        			pushArr.push(pushVal);
        			pushMessage(userid, pushArr, function(msg){
        				sendAPIResult(res, null, {}, "커플 신청 수락 완료. " + msg);
        			});
                }
            });

    } else {	// 넘어온 인증코드가 없는(null) 경우 실행
        res.json({
            "isSuccess" : false,
            "result" : null,
            "msg" : "인증코드를 받지 못했습니다."
        });
    }
}
/** 커플 되기 **/

//커플 결별
function deleteCouple(req, res) {
    connectionPool.getConnection(function(err, connection){
        if(err){
            sendAPIResult(res, err, null, "deleteUser ConnectionPool 에러 발생 : ");
        } else {
            connection.beginTransaction(function(err) {	// 트랜젝션 사용
                if (err) {
                    connection.release();
                    sendAPIResult(res, err, null, "deleteUser Transaction 에러 발생 : ");
                } else {
                    // 현재 로그인한 사용자
                    var userid = req.user.userid;

                    async.series(
                        [
                            function(callback){
                                // 해당 회원 편지에 첨부된 사진들 삭제
                                var deleteQuery = "delete from picture where letter_id in "+
                                    "(select letter_id from letter "+
                                    "where sender_userid=? or receiver_userid=?)";

                                connection.query(deleteQuery, [userid, userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(1) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            },
                            function(callback){
                                // 해당 회원이 관련된 편지 삭제
                                var deleteQuery = "delete from letter where sender_userid=? or receiver_userid=?";

                                connection.query(deleteQuery, [userid, userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(2) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            },
                            function(callback){
                                // 해당 회원이 관련된 쪽지 삭제
                                var deleteQuery = "delete from shortMessage where sender_userid=? or receiver_userid=?";

                                connection.query(deleteQuery, [userid, userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(3) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            },
                            function(callback){
                                // 해당 회원이 관련된 기념일 삭제
                                var deleteQuery = "delete from anniversary where userid1=? or userid2=?";

                                connection.query(deleteQuery, [userid, userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(4) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            },
                            function(callback){
                                // 해당 회원의 커플 삭제
                                var deleteQuery = "delete from couple where userid1=? or userid2=?";

                                connection.query(deleteQuery, [userid, userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(5) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            }
                        ],
                        function(err, result){
                            if (err) {
                                // 중도 실패시 롤백
                                connection.rollback(function() {	// 작업 실패로 롤백
                                    connection.release();
                                    sendAPIResult(res, err, null, result);
                                });
                            } else {
                                // 삭제 성공시 커밋
                                connection.commit(function(err) {	// 작업 성공시 커밋
                                    if (err) {
                                        connection.rollback(function() {
                                            connection.release();
                                            sendAPIResult(res, err, null, "커밋 과정에서 에러 발생 : ");
                                        });
                                    } else {
                                        // 커플삭제가 됐다고 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 구분정보만 들어간다.)
                            			// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
                            			var pushArr = [];
                            			var pushVal = {key:'pushtype', value:'couple_break'};
                            			pushArr.push(pushVal);
                            			pushMessage(userid, pushArr, function(msg){
                                            connection.release();
                            				sendAPIResult(res, null, {}, "커플 관계 삭제 완료. " + msg);
                            			});
                            			
                                    }
                                });
                            }
                        }
                    );
                }
            });
        }
    });
};

/*** 커플관련 코드 끝 ***/

//로그인 여부 확인 미들웨어
function isLoggedIn(req, res, next){
    if(req.isAuthenticated()){
        return next();
    }

    sendAPIResult(res, err, null, "로그인이 필요한 작업입니다 : ");
}

module.exports = function(app) {
    app.post('/couple/createcode', isLoggedIn, createCoupleCode);
    app.get('/couple/getcode', getCoupleCode);
    app.post('/couple/accept', express.bodyParser(), isLoggedIn, acceptCouple);
    app.post('/couple/break', isLoggedIn, deleteCouple);
}