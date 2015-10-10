// 성공 여부에 따라서 res.json을 실행해주는 함수
function sendAPIResult(res, err, result, msg){
	if(err){	// 에러가 있는 경우(실패인 경우)
		res.json({
			"isSuccess" : false,
			"result" : null,
			"msg" : msg + err
		});
	} else{		// 에러가 없는 경우(성공인 경우)
		res.json(200, {
			"isSuccess" : true,
			"result" : result,
			"msg" : msg
		});
	}
}

module.exports = sendAPIResult;