/*NPM, 변수선언*/
var async = require('async'),
	_ = require('underscore'),
	path = require('path'),
	fstools = require('fs-tools'),
	fs = require('fs'),
	mime = require('mime');


module.exports = function(app, passport) {
	app.post('/login', login);
	app.get('/logout', logout);
	app.post('/user/new', joinUser);
	app.post('/user/emailcheck', checkEmail);
	app.get('/user/:who/info/view', getUserInfo);
	app.post('/user/info/modifiy', updateUserInfo);
	app.post('/user/:userid/delete', deleteUser);
	
	// 로그인 인증절차
	function login(req, res){
		passport.authenticate('local-login', function(err, user) {
			if(err){
				return res.json({
				   "isSuccess" : false,
				    "result" : null,
				   "msg" : "로그인 인증처리 과정에서 에러 발생"
				});
			}
			else if(!user){
				return res.json({
				   "isSuccess" : false,
				    "result" : null,
				   "msg" : "이메일과 비밀번호를 확인해주세요"
				});
			}
			else {
				req.login(user, function(err) {
					if (err) {
						return next(err);
					}
					return res.json({
						"isSuccess" : true,
						"result" : {},
						"msg" : "로그인 성공"
					});
				});
			}
		})(req, res);
	}
	
	// 로그아웃 세션반환 절차
	function logout(req, res){
		req.logout();
		return res.json({
			"isSuccess" : true,
			"result" : {},
			"msg" : "로그아웃 성공. 세션이 반환되었습니다."
		});
	}

	// 회원가입 절차
	function joinUser(req, res){
		passport.authenticate('local-signup', function(err, user) {
			if(err){
				return res.json({
				   "isSuccess" : false,
				    "result" : null,
				   "msg" : "회원가입 처리 과정에서 에러 발생"
				});
			}
			if(!user){
				req.logout();
				return res.json({
				   "isSuccess" : false,
				    "result" : null,
				   "msg" : "이미 사용중인 이메일 주소입니다."
				});
			}
			else {
				req.login(user, function(err) {
					if (err) {
						return next(err);
					}
					return res.json({
						"isSuccess" : true,
						"result" : {},
						"msg" : "회원가입 성공. 로그인 되었습니다."
					});
				});
			}
		})(req, res);
	}

	// 이메일 주소 중복 확인
	function checkEmail(req, res){
		connectionPool.getConnection(function(err, connection){
			if(err){
				res.json({
					"isSuccess" : false,
					"result" : null,
					"msg" : "ConnectionPool 에러 발생"
				});
			}else{
				var email = req.body.email;	// 중복체크 요청한 이메일주소
				var selectQuery = 'SELECT userid FROM user WHERE email = ?';
				connection.query(selectQuery, [email], function(err, rows, fields) {
					if(err){
						res.json({
							"isSuccess" : false,
							"result" : null,
							"msg" : "DB에서 이메일주소 중복 검사하는 과정에서 에러 발생"
						});
					}else{
						if(rows.length){
							res.json({
								"isSuccess" : true,
								"result" : {
									emailok : false
								},
								"msg" : "이미 사용중인 이메일주소 입니다."
							});
						}else{
							res.json({
								"isSuccess" : true,
								"result" : {
									emailok : true
								},
								"msg" : "사용가능한 이메일주소 입니다."
							});
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
				res.json({
					"isSuccess" : false,
					"result" : null,
					"msg" : "ConnectionPool 에러 발생"
				});
			}else{
				var who = req.params.who;		// 자신(0)의 정보인지 커플 상대방(1)의 정보인지 구분
				var userid = req.session.passport.user;	// 세션에 저장된 userid(사용자 식별자) 값 = 현재 사용자ID
				// 사용자 상세정보 가져오기 쿼리문
				var selectQuery = "SELECT username, email, birthday, phone, profileimg, userpoint " +
								  "FROM user WHERE userid= ";
				if(who==1) {	// 상대방 정보 검색
					selectQuery += "(select case when userid1=? then userid2 when userid2=? then userid1 end 'userid' " +
								   "from couple where userid1=? or userid2=?)";
				}else {		// 자신의 정보 검색
					selectQuery += "(select case when userid1=? then userid1 when userid2=? then userid2 end 'userid' " +
								   "from couple where userid1=? or userid2=?)";
				}
				console.log(userid);
				connection.query(selectQuery, [userid,userid,userid,userid], function(err, rows, fields){
					if(err){
						res.json({
							"isSuccess" : false,
							"result" : null,
							"msg" : "DB에서 사용자 정보를 받아오는 과정에서 에러 발생"
						});
					}else{
						if(rows.length){	// 검색된 값이 있는 경우
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
						}else{	// 검색된 값이 없는 경우
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

	function updateUserInfo(req, res){
		
		// 사진 임시폴더(uploads)에 업로드
		var form = new formidable.IncomingForm();
		form.uploadDir = path.normalize(__dirname + '/../uploads/');
		form.keepExtensions = true;
		form.mutiples = true;
		
		// 업로드가 끝나면
		form.parse(req, function(err,fields, files){
			req.body = fields;
			
			// 클라이언트가 보내준 정보 저장
			var phone = req.body.phone;
			var username = req.body.username;
			var birthday = req.body.birthday;
			var userid = req.session.passport.user;	// 세션에 저장된 userid
			console.log(phone, ' ', username, ' ', birthday, ' ', userid);
			console.log('start');
	    	connectionPool.getConnection(function(err, connection){
	    		if(err){
	    			connection.release();
	    			res.json({
	    				"isSuccess" : false,
	    				"result" : null,
	    				"msg" : "writeLetter ConnectionPool 에러 발생 : "+err
	    			});
	    		}else{
					async.waterfall([
					    function(callback){
							console.log('w1');
							if(req.files.profile){	// 업로드한 파일이 있으면 files 변수에 저장
								var file = _.map(files, function(f) {	// 전송된 사진파일정보 저장
									return f;
								});
								
								callback(null, file);	// 저장한 파일정보를 다음단계로 넘겨준다.
							}else{
								callback(null, null);	// 업로드한 파일이 없으면 null값으로 넘겨준다.
							}
						},
						function(file, callback){	// 파일이 있는 경우:image/profile로 파일이동, 없는 경우 다음단계로
							console.log('w2');
							if(file){	// 파일이 있는 경우
								if (file.size) {	// 파일 크기가 0이 아닌 경우
									// 파일 이동시킬 도착지
									var destPath = path.normalize(path.dirname(file.path)+'/../image/profile/' + path.basename(file.path));
									console.log(destPath);
									// 파일 이동 (출발지, 도착지)
									fstools.move(file.path, destPath, function(err) {
										if (err) {
											callback(new Error(), file, "파일 업로드 처리 과정에서 에러 발생(1)");
										} else {
											// 결과 단계로 이동. 업로드한 파일명(uuid로 변환된 파일명=DB에 입력할 파일명) 넘겨줌
											callback(null, path.basename(file.path));
										}
									});	
								} else {	// 파일크기 0이면 삭제
									fstools.remove(file.path, function(err) {
										if (err) {
											callback(new Error(), file, "파일 업로드 처리 과정에서 에러 발생(2)");
										} else {
											callback(null, null);	// 결과 단계로 이동. 업로드된 파일 없이 개인정보 수정으로 진행
										}
									});
								}
							}else{	// 파일이 없는 경우
								callback(null, null);
							}
						},
						function(filename, callback){
							console.log('w3');
							// 보내준 정보와 정리된 파일정보로 회원정보 업데이트 쿼리문 작성(수정된 파일이 있는 경우와 없는 경우)
							var inputValue = [];
							var updateQuery = "UPDATE user SET phone=?, username=?, birthday=?";
							if(filename){	// 파일 있는 경우
								updateQuery += ", profileimg=? WHERE userid=?";
								inputValue = [phone, username, birthday, filename, userid];
							}else{		// 파일 없는 경우
								updateQuery += " WHERE userid=?";
								inputValue = [phone, username, birthday, userid];
							}
							// 쿼리 실행
							connection.query(updateQuery, inputValue, function(err, results){
								if(err){
									connection.release();
									callback(new Error(), "사용자 정보를 업데이트 하는 과정에서 에러 발생");
								}else{
									console.log(results);
									connection.release();
									callback(null, null, "회원정보 수정 성공.");
								}
							});
						}
					],
					function(err, files, msg){	// waterfall 결과
						console.log('wr');
						if(err && files){	// 오류가 발생했고 삭제할 파일이 있는 경우
							fstools.remove(file.path, function(err) {	// 작업 실패로 업로드한 파일 삭제
								if (err) {
									res.json({
										"isSuccess" : false,
										"result" : null,
										"msg" : "작업실패(파일삭제 필요):"+msg
									});
								} else {
									res.json({
										"isSuccess" : false,
										"result" : null,
										"msg" : "작업실패:"+msg
									});
								}
							});
						}else if(err && (!files)){	// 오류가 발생했고 파일이 없는 경우
							res.json({
								"isSuccess" : false,
								"result" : null,
								"msg" : "작업실패:"+msg
							});
						}else{	// 작업 성공
							res.json({
							    "isSuccess": true,
							    "result": {},
							    "msg": msg
							});
						}
					});
	    		}
	    	});
		});
	}

	function deleteUser(req, res){
		
	}
}