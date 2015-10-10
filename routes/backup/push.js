/** Push **/
var async = require('async'),
	gcm = require('node-gcm'),
	logger = require('../config/logger'),	// Log 기록용
	gcmConfig = require('../config/gcm');	// GCM용 apikey 보관중

function pushMessage(userid, valueArr, callback){
	connectionPool.getConnection(function(err, connection){
		if(err){
			return "pushMessage ConnectionPool 에러 발생 : "+err;
		} else {
			// 푸쉬를 보낼 커플 상대방의 registrationID를 받아옴
			var selectQuery = "select regId from user where userid=" +
							  "(SELECT case userid1 when ? then userid2 else userid1 end 'receiver' " +
							  "FROM couple WHERE userid1 = ? or userid2 = ?)";
			connection.query(selectQuery, [userid, userid, userid], function(err, rows, fields){
				if (err) {
					return "DB에서 푸쉬메세지를 보낼 사용자를 검색하는 과정에서 에러 발생 : "+err;
				} else {

					if(rows.length && rows[0].regId){	// 검색된 사용자가 있고 그 사용자에게 registrationId가 있음
						
						// GCM 사용
						var message = new gcm.Message();
						// 매개변수로 넘어온 배열안의 값들을 푸쉬메세지에 넣어서 보낸다. 배열 값 만큼 반복 후 message send
						// valueArr = [ {key,value}, {key,value}, {} ...]
						async.each(valueArr, 
							function(keyval, callback){
								console.log(keyval);
								message.addDataWithKeyValue(keyval.key, keyval.value);
								callback(null);
							},
							function(err, results){
								if (err) {
									console.log('push error : '+err);
								}
								message.collapseKey = 'demo';
								message.delayWhileIdle = true;
								message.timeToLive = 3;
								message.dryRun = false;
								
								var sender = new gcm.Sender(gcmConfig.apikey);
								
								var registrationIds = [];
								// Push 받을 사용자들 목록
								registrationIds.push(rows[0].regId);
								// 설정한 메세지를, 검색된 regId를 가진 사용자에게
								sender.send(message, registrationIds, 4, function(err, result){
									console.log(result);	// 로그
									if (err) {
										console.log('failed');
										connection.release();
										logger.debug('푸쉬를 보내지 못함 : '+err);
										callback("푸쉬를 보내지못함 : "+err);	// 작업은 성공했지만 푸쉬 실패
									} else {
										console.log('success');
										connection.release();
										callback('');	// 성공!
									}
								});
							}
						);
					} else {	// 커플 상대방이 검색되지 않거나 registrationId가 없음
						connection.release();
						callback("DB에서 푸쉬메세지를 보낼 사용자가 검색되지 않음");
					}
				}
			});
		}
	});
}

module.exports = pushMessage;