/*NPM, 변수선언*/
var async = require('async'),
    _ = require('underscore'),
    path = require('path'),
    fstools = require('fs-tools'),
    fs = require('fs'),
    mime = require('mime'),
    gcm = require('node-gcm'),
    gcmConfig = require('../config/gcm'),	// GCM용 apikey 보관중
    formidable = require('formidable'),
    express = require('express'),
	logger = require('../config/logger'),	// Log 기록용
    sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음

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

// 로그인 인증절차
function login(req, res){
    // 이메일과 비밀번호가 일치하지 않으면 req.user에 정보가 들어오지 않는다.
    if (!req.user){
    	sendAPIResult(res, ' ', null, "이메일과 비밀번호를 확인해주세요");
    }
    else {
        // 로그인이 됐으면 GCM을 이용하기 위해서 클라이언트로부터 넘겨받은 registrationId 를
        // 방금 로그인한 회원의 정보가 있는 DB 테이블에 업데이트한다.
        connectionPool.getConnection(function(err, connection){
            if(err){
            	sendAPIResult(res, err, null, "login ConnectionPool 에러 발생 : ");
            } else {

                var updateSql = 'update user set regId = ? where userid = ?';
                var registrationId = req.body.registrationId;
                connection.query(updateSql, [registrationId, req.user.userid], function(err, result){
                    if(err){
                        connection.release();
                        sendAPIResult(res, err, null, "GCM을 사용하기위한 registrationId를 저장하는 과정에서 에러 발생 : ");
                    } else {
                        connection.release();
                        sendAPIResult(res, null, {}, "로그인 성공");
                    }
                });
            }
        });
    }
}


// 로그아웃 세션반환 절차
function logout(req, res){
	// 회원가입이 됐으면 GCM을 이용하기 위해서 클라이언트로부터 넘겨받은 registrationId 를
    // 방금 회원가입한 회원의 정보가 있는 DB 테이블에 업데이트하여 최초입력한다.
    connectionPool.getConnection(function(err, connection){
        if(err){
        	sendAPIResult(res, err, null, "login ConnectionPool 에러 발생 : ");
        } else {

            var updateSql = 'update user set regId = null where userid = ?';
            var registrationId = req.body.registrationId;
            connection.query(updateSql, [req.user.userid], function(err, result){
                if(err){
                    connection.release();
                    sendAPIResult(res, err, null, "해당 유저의 registrationId를 삭제하는 과정에서 에러 발생 : ");
                } else {
                    req.logout();
                    connection.release();
                    sendAPIResult(res, null, {}, "로그아웃 성공. 세션이 반환되었습니다.");
                }
            });
        }
    });
}

// 회원가입 절차
function joinUser(req, res){
    // 회원가입에 실패하면 req.user에 정보가 들어오지 않는다.
    if(!req.user){
    	sendAPIResult(res, ' ', null, "이미 사용중인 이메일 주소입니다.");
    }
    else {
    	// 회원가입이 됐으면 GCM을 이용하기 위해서 클라이언트로부터 넘겨받은 registrationId 를
        // 방금 회원가입한 회원의 정보가 있는 DB 테이블에 업데이트하여 최초입력한다.
        connectionPool.getConnection(function(err, connection){
            if(err){
            	sendAPIResult(res, err, null, "login ConnectionPool 에러 발생 : ");
            } else {

                var updateSql = 'update user set regId = ? where userid = ?';
                var registrationId = req.body.registrationId;
                connection.query(updateSql, [registrationId, req.user.userid], function(err, result){
                    if(err){
                        connection.release();
                        sendAPIResult(res, err, null, "GCM을 사용하기위한 registrationId를 저장하는 과정에서 에러 발생 : ");
                    } else {
                        connection.release();
                    	sendAPIResult(res, null, {}, "회원가입 성공. 로그인 되었습니다.");
                    }
                });
            }
        });
    }
}

// 이메일 주소 중복 확인
function checkEmail(req, res){
    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("checkEmail ConnectionPool 에러 발생 : "+err);
        	sendAPIResult(res, err, null, "checkEmail ConnectionPool 에러 발생 : ");
        } else {
            var email = req.body.email;	// 중복체크 요청한 이메일주소
            var selectQuery = 'SELECT userid FROM user WHERE email = ?';
            connection.query(selectQuery, [email], function(err, rows, fields) {
                if(err){
                	connection.release();
                	logger.debug("checkEmail DB에서 이메일주소 중복 검사하는 과정에서 에러 발생 : "+err);
                	sendAPIResult(res, err, null, "DB에서 이메일주소 중복 검사하는 과정에서 에러 발생 : ");
                } else {
                    if(rows.length){
                    	connection.release();
                    	sendAPIResult(res, null, { emailok : false }, "이미 사용중인 이메일주소 입니다.");
                    } else {
                    	connection.release();
                    	sendAPIResult(res, null, { emailok : true }, "사용가능한 이메일주소 입니다.");
                    }
                }
            });
        }
    });
}

// 사용자 상세정보 받아오기
function getUserInfo(req, res){
    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("getUserInfo ConnectionPool 에러 발생 : "+err);
        	sendAPIResult(res, err, null, "getUserInfo ConnectionPool 에러 발생 : ");
        } else {
            var who = req.params.who;		// 자신(0)의 정보인지 커플 상대방(1)의 정보인지 구분
            var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
            console.log(userid);
            // 사용자 상세정보 가져오기 쿼리문
            var selectQuery = "SELECT username, email, date_format(birthday, '%Y-%m-%d') 'birthday', phone, profileimg, userpoint " +
                			  "FROM user WHERE userid= ";
            if(who==1) {	// 상대방 정보 검색
                selectQuery += "(select case when userid1=? then userid2 when userid2=? then userid1 end 'userid' " +
                    		   "from couple where userid1=? or userid2=?)";
            }else {		// 자신의 정보 검색
                selectQuery += "(select case when userid1=? then userid1 when userid2=? then userid2 end 'userid' " +
                			   "from couple where userid1=? or userid2=?)";
            }

            connection.query(selectQuery, [userid,userid,userid,userid], function(err, rows, fields){
                if(err){
                    connection.release();
                    logger.debug("getUserInfo DB에서 사용자 정보를 받아오는 과정에서 에러 발생 : "+err);
                    sendAPIResult(res, err, null, "DB에서 사용자 정보를 받아오는 과정에서 에러 발생 : ");
                } else {
                	console.log(rows);
                    if(rows.length){	// 검색된 값이 있는 경우
                        connection.release();
                        res.json({
                            "isSuccess": true,
                            "result": {
                                "username": rows[0].username,
                                "email": rows[0].email,
                                "birthday": rows[0].birthday,
                                "phone": rows[0].phone,
                                "profileimg": rows[0].profileimg,
                                "userpoint": rows[0].userpoint
                            },
                            "msg": "회원정보 요청 성공"
                        });
                    } else {	// 검색된 값이 없는 경우
                        connection.release();
                        res.json({
                            "isSuccess": true,
                            "result": {},
                            "msg": "검색된 회원정보가 없습니다."
                        });
                    }
                }
            });
        }
    });
}

//프로필사진 실제 이미지 넘겨주기
function showProfileImage(req, res){
    var filename = req.params.imageURL;
    var filepath = path.normalize('./image/profile/' + filename);

    fs.exists(filepath, function(exists){
        if(exists){
            res.statusCode = 200;
            res.set('Content-Type', mime.lookup(filename));
            // 해당 이미지파일의 실제 경로를 이용해서 ReadStream에 파일 내용을 뿌린다
            var rs = fs.createReadStream(filepath);
            rs.pipe(res);	// 파이프에 등록?
        } else {
            res.json(404, {
                data : "Cannot find a photo"
            });
        }
    });
}

// 회원정보 수정(전화번호, 별명, 생일, 프로필사진 변경가능)
function updateUserInfo(req, res){
	var userid = req.user.userid;
	
    if (req.headers['content-type'] === 'application/x-www-form-urlencoded'){	// 사진을 안올린 경우
        runProfileUpdate(req.body, res, null, userid);		// 실질적인 업데이트 함수

    } else {	// 'multipart/form-data' 사진을 올린 경우

        // 사진 임시폴더(uploads)에 업로드
        var form = new formidable.IncomingForm();
        form.uploadDir = path.normalize(__dirname + '/../uploads/');
        form.keepExtensions = true;

        // 업로드가 끝나면
        form.parse(req, function(err, fields, files){
            runProfileUpdate(fields, res, files, userid);		// 실질적인 업데이트 함수
        });
    }
}

// 회원정보 수정 실제 작업 함수
function runProfileUpdate(fields, res, files, userid){
    // 클라이언트가 보내준 정보 저장
    var phone = fields.phone;
    var username = fields.username;
    var birthday = fields.birthday;

    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("updateUserInfo ConnectionPool 에러 발생 : "+err);
            sendAPIResult(res, err, null, "updateUserInfo ConnectionPool 에러 발생 : ");
        } else {
            async.waterfall([
                    function(callback){
                        if(files){	// 업로드한 파일이 있으면 files 변수에 저장
                            callback(null, files.profile);	// 저장한 파일정보를 다음단계로 넘겨준다.(프로필 수정에서 파일은 무조건 하나)
                        } else {
                            callback(null, null);	// 업로드한 파일이 없으면 null값으로 넘겨준다.
                        }
                    },
                    function(file, callback){	// 파일이 있는 경우 image/profile로 파일이동, 없는 경우 다음단계로
                        if(file){	// 파일정보가 들어가 있어야 함
                            if (file.size) {	// 파일 크기가 0이 아닌 경우
                                // 파일 이동시킬 도착지
                                var destPath = path.normalize(path.dirname(file.path)+'/../image/profile/' + path.basename(file.path));
                                // 파일 이동 (출발지, 도착지)
                                fstools.move(file.path, destPath, function(err) {
                                    if (err) {
                                        callback(err, file, "파일 업로드 처리 과정에서 에러 발생(1)");
                                    } else {
                                        // 변경 전 파일 삭제하기위해 파일명 검색 후 저장
                                        var selectQuery = "SELECT profileimg FROM user WHERE userid=?";
                                        connection.query(selectQuery, [userid], function(err, rows, fields){
                                            if (err) {
                                                callback(err, filename, "이전 파일을 확인하는 과정에서 에러 발생")
                                            } else {
                                            	
                                                if(rows.length && rows[0].profileimg){	// 검색된 값(이전 프로필사진)이 있을 때
                                                	
                                                    var prev_profile = rows[0].profileimg;
                                                    
                                                    // 해당 경로에 있는 파일 삭제
                                                    fstools.remove(path.dirname(destPath)+'/'+prev_profile, function(err){
                                                        if (err) {
                                                            console.log('이전 프로필사진 삭제 실패(파일명:'+prev_profile+')');
                                                            callback(null, path.basename(file.path));
                                                        }
                                                        // 결과 단계로 이동. 업로드한 파일명(uuid로 변환된 파일명=DB에 입력할 파일명) 넘겨줌
                                                        callback(null, path.basename(file.path));
                                                    });
                                                    
                                                } else {	// 이전 프로필사진이 없으면 그냥 진행
                                                    callback(null, path.basename(file.path));
                                                }
                                            }
                                        });
                                    }
                                });
                            } else {	// 파일크기 0이면 삭제
                                fstools.remove(file.path, function(err) {
                                    if (err) {
                                        callback(err, file, "파일 업로드 처리 과정에서 에러 발생(2)");
                                    } else {
                                        callback(null, null);	// 다음 단계로 이동. 업로드된 파일 없이 개인정보 수정으로 진행
                                    }
                                });
                            }
                        } else {
                            callback(null, null);	// 다음 단계로 이동. 업로드된 파일 없이 개인정보 수정으로 진행
                        }
                    },
                    function(filename, callback){
                        // 보내준 정보와 정리된 파일정보로 회원정보 업데이트 쿼리문 작성(수정될 프로필사진이 있는 경우와 없는 경우)
                        var inputValue = [];
                        var updateQuery = "UPDATE user SET phone=?, username=?, birthday=?";
                        if(filename){	// 파일 있는 경우
                            updateQuery += ", profileimg=? WHERE userid=?";
                            inputValue = [phone, username, birthday, filename, userid];
                        } else {		// 파일 없는 경우
                            updateQuery += " WHERE userid=?";
                            inputValue = [phone, username, birthday, userid];
                        }

                        // 쿼리 실행
                        connection.query(updateQuery, inputValue, function(err, results){
                            if(err){
                                connection.release();
                                callback(err, filename, "사용자 정보를 업데이트 하는 과정에서 에러 발생");
                            } else {
                                connection.release();
                                callback(null, null, "회원정보 수정 성공.");
                            }
                        });
                    }
                ],
                function(err, files, msg){	// waterfall 결과
                    if(err && files){	// 오류가 발생했고 삭제할 파일이 있는 경우
                        fstools.remove('./../image/profile/'+files, function(err) {	// 작업 실패로 업로드한 파일 삭제
                            if (err) {
                            	logger.debug("프로필 사진 업로드 실패 : "+msg+"/ 삭제해야하는 파일 : "+files);
                            	sendAPIResult(res, err, null, "작업실패(파일삭제 필요):"+msg);
                            } else {
                            	logger.debug("프로필 사진 업로드 실패 : "+msg);
                            	sendAPIResult(res, err, null, "작업실패:"+msg);
                            }
                        });
                    }else if(err && (!files)){	// 오류가 발생했고 파일이 없는 경우
                    	logger.debug("프로필 정보 수정 실패 : "+msg);
                        sendAPIResult(res, err, null, "작업실패:"+msg);
                    } else {	// 작업 성공
                    	sendAPIResult(res, null, {}, msg);
                    }
                }
            );	//waterfall 끝
        }
    });
}

// 사용자 삭제
function deleteUser(req, res){
    connectionPool.getConnection(function(err, connection){
        if(err){
        	logger.debug("deleteUser ConnectionPool 에러 발생 : "+err);
            sendAPIResult(res, err, null, "deleteUser ConnectionPool 에러 발생 : ");
        } else {
            connection.beginTransaction(function(err) {	// 트랜젝션 사용
                if (err) {
                    connection.release();
                    logger.debug("deleteUser Transaction 에러 발생 : "+err);
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
                            },
                            function(callback){
                                // 해당 회원의 인증코드 삭제
                                var deleteQuery = "delete from authcode where userid=?";

                                connection.query(deleteQuery, [userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(6) :');
                                    } else {
                                        // 성공시 다음단계
                                        callback(null, 'ok');
                                    }
                                });
                            },
                            function(callback){
                                // 회원 삭제
                                var deleteQuery = "delete from user where userid=?";

                                connection.query(deleteQuery, [userid], function(err, results){
                                    if (err) {
                                        callback(err, 'Delete Error(7) :');
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
                                            logger.debug("deleteUser 커밋 과정에서 에러 발생 : "+err);
                                            sendAPIResult(res, err, null, "커밋 과정에서 에러 발생 : ");
                                        });
                                    } else {
                                        connection.release();
                                        console.log(result)
                                        req.logout();
                                        sendAPIResult(res, null, {}, '회원 탈퇴되었습니다.');
                                    }
                                });
                            }
                        }
                    );
                }
            });
        }
    });
}


module.exports = function(app, passport) {
    app.post('/login', express.bodyParser(), passport.authenticate('local-login'), login);
    app.get('/logout', express.bodyParser(), isLoggedIn, logout);
    app.post('/user/new', express.bodyParser(), passport.authenticate('local-signup'), joinUser);
    app.post('/user/emailcheck', express.bodyParser(), checkEmail);
    app.get('/user/:who/info/view', getUserInfo);
    app.post('/user/info/modifiy', isLoggedIn, updateUserInfo);
    app.post('/user/delete', deleteUser);
    app.get('/user/showImg/:imageURL', showProfileImage);
};