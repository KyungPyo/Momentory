/*NPM, 변수선언*/
var async = require('async'),
	_ = require('underscore'),
	path = require('path'),
	fstools = require('fs-tools'),
	fs = require('fs'),
	mime = require('mime'),
	formidable = require('formidable'),
	logger = require('../config/logger'),	// Log 기록용
	pushMessage = require('./push'),
	sendAPIResult = require('./resjson');	// res.json으로 클라이언트에 결과 전달하는 함수가 들어있음


//로그인 여부 확인 미들웨어
function isLoggedIn(req, res, next){
	if(req.isAuthenticated()){
		return next();
	}
	
	logger.debug('비인가 접근 발생');
	sendAPIResult(res, ' ', null, "로그인이 필요한 작업입니다.");
}

/*** 편지관련 코드 시작 ***/
// 편지 목록 요청 (앱 다시설치용. 전체 보내줌. 내장디비에 자료개수가 0개인경우)
function getLetterList(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			logger.debug("getLetterList ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "getLetterList ConnectionPool 에러 발생 : ");
		} else {
//			var userid = req.params.userid;		// url 파라미터로 받은 userid(사용자 식별자) 값 = 현재 사용자ID
			var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
			var sor = req.params.sor;		// 보낸편지함(1)인지 받은편지함(0)인지 구분
			
			// 파라미터로 넘겨받은 userid, sor 값이 숫자인 경우 실행
			if(userid > 0 && (sor == 0 || sor == 1)){
				// sor값이 1(보낸편지함)인지 0(받은편지함)인지에 따른 쿼리문 작성
				var selectQuery = "SELECT letter_id, sender.username sender_name, receiver.username receiver_name, "+
								  "latitude, longitude, placename, " + 
								  "date_format(send_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'send_date', " + 
								  "date_format(receive_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'receive_date', " +
								  "content, receive_confirm " +
								  "FROM letter l JOIN user sender ON l.sender_userid = sender.userid " +
								  "JOIN user receiver ON l.receiver_userid = receiver.userid ";
				if(sor==0){
					selectQuery += "where receiver_userid=?";
				} else {
					selectQuery += "where sender_userid=?";
				}
				
				connection.query(selectQuery, [userid], function(err, rows, fields){
					if (err) {	// 쿼리문 처리중 오류 발생
						connection.release();
						logger.debug("DB에서 편지목록을 요청하는 과정에서 에러 발생 : ", err);
						sendAPIResult(res, err, null, "DB에서 편지목록을 요청하는 과정에서 에러 발생 : ");
					} else {
						var count = rows.length;	// 반복 횟수 체크
						// async의 for each
						async.map(rows, function(letter, callback){
							count--;
							// 편지 데이터에 사진경로를 저장할 프로퍼티 생성
							letter.picture = [];
							/** 편지번호에 해당하는 사진들 검색 **/
							var pictureQuery = "select pictureimg from picture where letter_id=?";
							connection.query(pictureQuery, [letter.letter_id], function(err, pic, fields){
								if(err){
									connection.release();
									logger.debug("DB에서 편지의 첨부사진을 요청하는 과정에서 에러 발생 : ", err);
									sendAPIResult(res, err, null, "DB에서 편지의 첨부사진을 요청하는 과정에서 에러 발생 : ");
								} else {
									// 검색된 사진의 개수만큼 반복
									var i=0;
									// async의 조건반복
									async.whilst(function(){
										return i<pic.length
									}, function(cb){
										// 사진경로를 편지 데이터에 추가
										letter.picture.push(pic[i].pictureimg);
										i++;
										cb();
									}, function(err){	// whilst의 callback. cb()
										if(err){
											return console.log(err);
										}
										// 사진이 추가된 편지정보를 결과를 async.map의 callback으로 넘김
										callback(null, letter);
									});
								}
							});
							/****/
						}, 
						function(err, results){
							if(err){
								return console.log(err);
							}
							
							if(count <= 0){	// 검색된 편지 갯수만큼 반복이 끝났을 경우
								connection.release();
								sendAPIResult(res, null, { "list" : results }, "편지 목록 요청 성공");
							}
						});
					}
				});
			} else {	// 파라미터 값이 숫자가 아닌 잘못된 값이 들어온 경우
				connection.release();
				logger.debug("getLetterList 클라이언트에서 전달받은 파라미터 값이 잘못된 형식입니다.");
				sendAPIResult(res, ' ', null, "클라이언트에서 전달받은 파라미터 값이 잘못된 형식입니다.");
			}
		}
	});
}

// 새로받은 편지 목록 요청 (내장디비 가지고있는 데이터수 1개 이상, 날짜기준, 받은편지만)
function getLetterNew(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			logger.debug("getLetterNew ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "getLetterNew ConnectionPool 에러 발생 : ");
		} else {
			var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
			var datetime = req.params.date;		// 클라이언트가 가지고 있는 가장 최신 편지의 날짜
			var sor = req.params.sor;		// 보낸편지함(1)인지 받은편지함(0)인지 구분
			
			// 파라미터로 넘겨받은 userid, sor 값이 숫자인 경우 실행
			if(userid > 0 && (sor == 0 || sor == 1)){
				var selectQuery = "SELECT letter_id, sender.username sender_name, receiver.username receiver_name, "+
								  "latitude, longitude, placename, " + 
								  "date_format(send_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'send_date', " + 
								  "date_format(receive_date+interval 9 hour, '%Y-%m-%d %H:%i:%s') 'receive_date', " +
								  "content, receive_confirm " +
								  "FROM letter l JOIN user sender ON l.sender_userid = sender.userid " +
								  "JOIN user receiver ON l.receiver_userid = receiver.userid ";
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
							logger.debug("getLetterNew DB에서 편지목록을 요청하는 과정에서 에러 발생 : ", err);
							sendAPIResult(res, err, null, "getLetterNew DB에서 편지목록을 요청하는 과정에서 에러 발생 : ");
						} else {
							var count = rows.length;	// 반복 횟수 체크
							// async의 for each
							async.map(rows, function(letter, callback){
								count--;
								// 편지 데이터에 사진경로를 저장할 프로퍼티 생성
								letter.picture = [];
								/** 편지번호에 해당하는 사진들 검색 **/
								var pictureQuery = "select pictureimg from picture where letter_id=?";
								connection.query(pictureQuery, [letter.letter_id], function(err, pic, fields){
									if(err){
										connection.release();
										logger.debug("getLetterNew DB에서 편지의 첨부사진을 요청하는 과정에서 에러 발생 : ", err);
										sendAPIResult(res, err, null, "getLetterNew DB에서 편지의 첨부사진을 요청하는 과정에서 에러 발생 : ");
									} else {
										// 검색된 사진의 개수만큼 반복
										var i=0;
										// async의 조건반복
										async.whilst(function(){
											return i<pic.length
										}, function(cb){
											// 사진경로를 편지 데이터에 추가
											letter.picture.push(pic[i].pictureimg);
											i++;
											cb();
										}, function(err){	// whilst의 callback. cb()
											if(err){
												return console.log(err);
											}
											// 사진이 추가된 편지정보를 결과를 async.map의 callback으로 넘김
											callback(null, letter);
										});
									}
								});
								/****/
							}, 
							function(err, results){
								if(err){
									return console.log(err);
								}
			
								if(count <= 0){	// 검색된 편지 갯수만큼 반복이 끝났을 경우
									connection.release();
									// 성공 결과 전송
									sendAPIResult(res, null, {"list" : results}, "편지 목록 요청 성공");
								}
							});
						}
					});
				});
				
			} else {	// userid 파라미터 값이 숫자가 아닌 잘못된 값이 들어온 경우
				connection.release();
				logger.debug("getLetterNew 클라이언트에서 전달받은 파라미터 값이 잘못된 형식입니다.");
				sendAPIResult(res, ' ', null, "클라이언트에서 전달받은 파라미터 값이 잘못된 형식입니다.");
			}
		}
	});
}

// 편지 하나 첨부사진 받아오기(삭제예정)
function getLetterPicture(req, res){
	connectionPool.getConnection(function(err, connection){
		if(err){
			logger.debug("getLetterPicture ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "getLetterPicture ConnectionPool 에러 발생 : ");
		} else {
			var letterid = req.params.letterid;		// 클라이언트에서 넘겨준 읽는 편지번호
			var selectQuery = "select pictureimg from picture where letter_id=?";
			
			connection.query(selectQuery, [letterid], function(err, rows, fields){
				if(err){
					connection.release();
					logger.debug("getLetterPicture DB에서 해당 편지의 첨부사진을 받아오는 과정에서 에러 발생 : ", err);
					sendAPIResult(res, err, null, "getLetterPicture DB에서 해당 편지의 첨부사진을 받아오는 과정에서 에러 발생 : ");
				} else {
					if(rows.length){
						var picture = [];
						for(var i in rows){
							picture.push(rows[i].pictureimg);
						}
						
		
						res.json({
							"isSuccess" : true,
							"result" : {
								"picture" : picture
							},
							"msg" : "편지에 첨부된 사진목록 요청 성공"
						});
					} else {
						connection.release();
						logger.debug("getLetterPicture 편지에 첨부된 사진이 없거나 해당 편지가 없습니다.");
						sendAPIResult(res, ' ', null, "getLetterPicture 편지에 첨부된 사진이 없거나 해당 편지가 없습니다.");
					}
				}
			});
		}
	});
}

// 편지 읽음정보 업데이트
function setLetterConfirm(req, res) {
	connectionPool.getConnection(function(err, connection){
		if(err){
			logger.debug("setLetterConfirm ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "setLetterConfirm ConnectionPool 에러 발생 : ");
		} else {
			var letterid = req.params.letterid;		// 클라이언트에서 넘겨준 읽은 편지번호
			var updateQuery = "UPDATE letter SET receive_confirm=1 WHERE letter_id=?";
			
			connection.query(updateQuery, [letterid], function(err, results){
				if(err){
					logger.debug("DB에서 해당 편지에 대한 읽음정보를 수정하는 과정에서 에러 발생 : ", err);
					sendAPIResult(res, err, null, "DB에서 해당 편지에 대한 읽음정보를 수정하는 과정에서 에러 발생 : ");
				} else {
					// 편지를 읽었다고 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 구분정보만 들어간다.)
        			// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
        			var pushArr = [];
        			var pushVal1 = {key:'pushtype', value:'letter_confirm'};
        			var pushVal2 = {key:'letterid', value:letterid};
        			pushArr.push(pushVal1);
        			pushArr.push(pushVal2);
        			pushMessage(userid, pushArr, function(msg){
        				connection.release();
        				sendAPIResult(res, null, {}, "해당 편지 읽음으로 상태 변경완료. " + msg);
        			});
				}
			});
		}
	});
}


// 새로운 편지 전송 실제 작업 함수
function runWriteNewLetter(fields, res, files, userid){
	/** 첨부사진 업로드 > 편지내용등록 > 업로드한 사진 이동(앞의 과정이 실패하면 삭제) **/
	// 클라이언트에서 POST로 전송한 값 저장
	var latitude = fields.latitude;
	var longitude = fields.longitude;
	var place = fields.placename;
	var content = fields.content;
	var fileArray = _.map(files, function(file) {
		return file;
	});

	connectionPool.getConnection(function(err, connection){
		if(err){
			connection.release();
			logger.debug("runWriteNewLetter ConnectionPool 에러 발생 : ", err);
			sendAPIResult(res, err, null, "runWriteNewLetter ConnectionPool 에러 발생 : ");
		} else {
			connection.beginTransaction(function(err) {	// 트랜젝션 사용
				if (err) {
					connection.release();
					logger.debug("runWriteNewLetter Transaction 에러 발생 : ", err);
					sendAPIResult(res, err, null, "runWriteNewLetter Transaction 에러 발생 : ");
				} else {
					async.waterfall([

						function(callback) {	// 파일목록 배열 만들기
							if(fileArray){
								callback(null, fileArray);
							} else {
								callback(null, null);
							}
						},

						function(files, callback){		// 사진 내용 DB에 Insert(편지내용등록)
							// 편지를 수신할 커플 상대방 찾기
							var selectQuery = "SELECT userid1, userid2 FROM couple WHERE userid1=? or userid2=?";
							connection.query(selectQuery, [userid, userid], function(err, rows, fields){
								if(err){
									callback(new Error(), files, "DB에서 편지 수신자를 검색하는 과정에서 에러 발생");
								} else {
									// 보낸사람으로 검색된 커플의 결과가 하나인 경우에만 실행
									if(rows.length == 1){
										var receiver;
										// 보낸사람을 기준으로 찾은 커플정보에서 수신자를 찾아 저장한다
										if(rows[0].userid1 == userid){
											receiver = rows[0].userid2;
										} else {
											receiver = rows[0].userid1;
										}
										
										// 편지 DB에 Insert
										var insertQuery = "INSERT INTO letter " + 
														  "(`sender_userid`, `receiver_userid`, `latitude`, `longitude`, `placename`, `content`) " + 
			    										  "VALUES (?, ?, ?, ?, ?, ?)";
										connection.query(insertQuery, [userid, receiver, latitude, longitude, place, content], 
												function(err, results){
											if(err){
												callback(new Error(), files, "DB에 편지내용을 저장하는 과정에서 에러 발생");
											} else {
												var letterid = results.insertId;	// 입력한 편지의 편지번호를 저장해서 콜백에 넘겨줌
												callback(null, files, letterid);	// 편지내용 insert 성공해서 다음단계로
											}
										});
									}else if(rows.length>1){	// 검색된 커플의 결과가 두개 이상인 경우 실행
										callback(new Error(), files, "커플로 검색된 사람이 두명 이상입니다. 관리자에게 문의하세요.");
									} else {		// 검색된 커플이 없는 경우
										callback(new Error(), files, "커플로 검색된 사람이 없습니다. 관리자에게 문의하세요.");
									}
								}
							});
						},
						
						function(files, letterid, callback) {		// 편지내용 등록 완료 시 업로드한 파일 정상위치로 이동 후 DB에 Insert
							if(files){	// 업로드된 파일이 있을 경우
								// 업로드된 파일 각각에 대해 실행
								async.each(files, function(file, cb) {
									if (file.size) {
										// 파일 이동시킬 도착지
										var destPath = path.normalize(path.dirname(file.path)+'/../image/letter/' + path.basename(file.path));
										// 파일 이동 (출발지, 도착지)
										fstools.move(file.path, destPath, function(err) {
											if (err) {
												cb(err);
											} else {
												// 파일경로를 임시폴더에서 도착지로 변경
												file.path = destPath;
												// 첨부사진 정보 DB에 Insert
												var insertQuery = "INSERT INTO picture (`pictureimg`, `letter_id`) VALUES (?, ?)";
												connection.query(insertQuery, [path.basename(destPath), letterid], function(err, results){
													if(err){
														callback(new Error(), files, "DB에 첨부사진을 저장하는 과정에서 에러 발생");
													} else {
														cb();
													}
												});
											}
										});	
									} else {	// 파일크기 0이면 삭제
										fstools.remove(file.path, function(err) {
											if (err) {
												cb(err);
											} else {
												cb();
											}
										});
									}
								}, function(err, result) {
									if (err) {
										callback(new Error(), files, "첨부파일 처리중 에러 발생");
									} else {
										callback(null, files, "첨부 사진 업로드 완료");		// 첨부사진 insert 성공해서 다음단계로
									}
								});
							} else {	// 업로드된 파일이 없는 경우
								callback(null, files, "첨부된 파일 없음");
							}	
						},
						
						function(files, msg, callback){	// 편지 작성시 보낸사람 3 포인트 감소
							var updateQuery = "UPDATE user SET userpoint=(userpoint-3) WHERE userid=?";
					
							connection.query(updateQuery, [userid], function(err, results){
								if(err){
									callback(err, files, msg);
								} else {
									callback(null, files, msg);
								}
							});
						}
					], function(err, files, msg){
						
						if(err){	// 에러 발생
							if (files) {	// 업로드한 파일이 있으면 삭제
								async.each(files,
									function(file, cb){
										fstools.remove(file.path, function(err) {	// 작업 실패로 업로드한 파일 삭제
											if (err) {
												logger.debug("파일 삭제 실패 : ", file.path, "// msg : ",err);
												cb(err);
											}
											cb();
										});
									},
									function(error, result){
										if (error) {
											logger.debug("error msg : ",error);
										}

										connection.rollback(function() {	// 작업 실패로 롤백
											connection.release();
											logger.debug("runWriteNewLetter 작업실패 : ", err);
											sendAPIResult(res, err, null, "runWriteNewLetter 작업실패 : ");
										});
									}
								);
							} else {
								connection.rollback(function() {	// 작업 실패로 롤백
									connection.release();
									logger.debug("runWriteNewLetter 작업실패 : ", err);
									sendAPIResult(res, err, null, "runWriteNewLetter 작업실패 : ");
								});
							}
							
						} else {		// 작업 성공
							connection.commit(function(err) {	// 작업 성공시 커밋
								if (err) {
									connection.rollback(function() {
										connection.release();
										logger.debug("runWriteNewLetter 커밋 과정에서 에러 발생 : ", err);
										sendAPIResult(res, err, null, "runWriteNewLetter 커밋 과정에서 에러 발생 : ");
									});
								} else {
									// 편지를 보냈다고 상대방에게 푸쉬메세지 전송 (푸쉬메세지에는 구분정보만 들어간다.)
									// 푸쉬 함수에는 메세지로 보낼 값(key와 value로 구분되어 있음)들을 배열에 저장하여 보낸다.
									var pushArr = [];
									var pushVal = {key:'pushtype', value:'letter_received'};
									pushArr.push(pushVal);
									pushMessage(userid, pushArr, function(msg){
										connection.release();
										sendAPIResult(res, null, {}, "편지 전송 성공. " + msg);
									});
								}
							});
						}
					});
				}
			});
		}
	});
}

// 커플 상대방에게 편지 작성/전송
function writeLetter(req, res) {
	var userid = req.user.userid;
	
	if (req.headers['content-type'] === 'application/x-www-form-urlencoded'){	// 사진을 안올린 경우
		runWriteNewLetter(req.body, res, null, userid);		// 실질적인 업데이트 함수

    } else {	// 'multipart/form-data' 사진을 올린 경우

        // 사진 임시폴더(uploads)에 업로드
        var form = new formidable.IncomingForm();
        form.uploadDir = path.normalize(__dirname + '/../uploads/');
        form.keepExtensions = true;
        form.multiple = true;

        var pictures = [];	// 사진 저장할 배열
        // 파일이 전송될때마다
        form.on('file', function(name, file) {
        	pictures.push(file);	// 배열에 하나씩 파일정보를 저장
        });

        // 업로드가 끝나면
        form.parse(req, function(err, fields, files){
            runWriteNewLetter(fields, res, pictures, userid);		// 실질적인 업데이트 함수
        });
    }
}


// 첨부사진 실제 이미지 넘겨주기
function showLetterImage(req, res){
	var filename = req.params.imageURL;
	var filepath = path.normalize('./image/letter/' + filename);
	
	fs.exists(filepath, function(exists){
		if(exists){
			res.statusCode = 200;
			res.set('Content-Type', mime.lookup(filename));
			// 해당 이미지파일의 실제 경로를 이용해서 ReadStream에 파일 내용을 뿌린다
			var rs = fs.createReadStream(filepath);
			rs.pipe(res);	// 파이프에 등록?
		} else {
			res.json(404, {
				data : "No photo found!!!"
			});
		}
	});
}
/*** 편지관련 코드 끝 ***/

module.exports = function(app) {
	app.get('/letter/list/:sor', getLetterList);
	app.get('/letter/receivelist/:date/:sor', getLetterNew);
	app.get('/letter/:letterid/picture/show', getLetterPicture);
	app.post('/letter/:letterid/confirm', isLoggedIn, setLetterConfirm);
	app.post('/letter/write', isLoggedIn, writeLetter);
	app.get('/letter/showImg/:imageURL', showLetterImage);
};