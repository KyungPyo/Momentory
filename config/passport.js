var LocalStrategy = require('passport-local').Strategy
  , bcrypt = require('bcrypt-nodejs')
  , async = require('async');

module.exports = function(passport) {
	passport.serializeUser(function(user, done) {
		//console.log('passport.serializeUser ====> ', user);
		done(null, user.userid);
	});
	
	passport.deserializeUser(function(id, done) {
		connectionPool.getConnection(function(err, connection){
			if(err){
				return done(err);
			}else{
				connection.query('SELECT userid, email, password FROM user WHERE userid = ?', [id], function(err, rows, fields) {
					//console.log('passport.deserializeUser ====> ', rows[0]);
					done(null, rows[0]);
					connection.release();
				});
			}
		});
	});
	
	passport.use('local-signup', new LocalStrategy({
		usernameField: 'email',
		passwordField: 'password',
		passReqToCallback: true
	},
	function(req, email, password, done) {
		connectionPool.getConnection(function(err, connection){
			if(err){
				
			}else{
				process.nextTick(function() {
					var selectSql = 'SELECT userid FROM user WHERE email = ?';
					connection.query(selectSql, [email], function(err, rows, fields) {
						if (err) {
							connection.release();
							return done(err);
						}
						if (rows.length) {
							connection.release();
							return done(null, false);
						} else {
							async.waterfall([
				                 function generateSalt(callback) {
				                	 var rounds = 10;
				                	 bcrypt.genSalt(rounds, function(err, salt) {
				                		 //console.log('bcrypt.genSalt ====> ', salt, '(', salt.toString().length,')');
				                		 callback(null, salt);
				                	 });
				                 },
				                 function hashPassword(salt, callback) {
				                	 bcrypt.hash(password, salt, null, function(err, hashPass) {
				                		 //console.log('bcrypt.hash ====> ', hashPass, '(', hashPass.length,')');
				                		 // 클라이언트로부터 입력받은 회원가입 정보 (이메일, 비번, 전번, 별명, 생일)
				                		 var newUser = {};
				                		 newUser.email = email;
				                		 newUser.password = hashPass;	// 비번은 암호화 한 값
				                		 newUser.phone = req.body.phone || null;
				                		 newUser.username = req.body.username;
				                		 newUser.birthday = req.body.birthday || null;
				                		 callback(null, newUser);	// 입력된 값을 Insert 부분으로 넘겨줌
				                	 });
				                 }
			                ],
							function(err, user) {
								if (err) {
									connection.release();
									return done(err);
								}
								var insertSql = 'INSERT INTO user(email, password, phone, username, birthday) VALUES(?, ?, ?, ?, ?)';
								connection.query(insertSql, [user.email, user.password, user.phone, user.username, user.birthday], function(err, result) {
									if (err) {
										connection.release();
										return done(err);
									}
									user.userid = result.insertId;
									connection.release();
									return done(null, user);
								});
							});
						}
					});
				});
			}
		});
	}));
	
	passport.use('local-login', new LocalStrategy({
		usernameField: 'email',
		passwordField: 'password',
		passReqToCallback: true
	},
	function(req, email, password, done) {
		connectionPool.getConnection(function(err, connection){
			if(err){
				
			}else{
				process.nextTick(function() {
					var selectSql = 'SELECT userid, email, password FROM user WHERE email = ?';
					connection.query(selectSql, [email], function(err, rows, fields) {
						//console.log(email, ' ;; ', password);
						if (err) {
							connection.release();
							return done(err);
						}
						if (!rows.length) {
							connection.release();
							return done(null, false);
						}
						
						bcrypt.compare(password, rows[0].password, function(err, result) {
							if (!result){
								connection.release();
								return done(null, false);
							}
							//console.log('bcrypt.compare ====> ', rows[0].password, '(', rows[0],')');
							connection.release();
							return done(null, rows[0]);
						});
//						if(password==rows[0].password){
//							return done(null, rows[0]);
//						}else{
//							return done(null, false);
//						}
					});
				});
			}
		});
	}));
};
