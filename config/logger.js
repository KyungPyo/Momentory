var winston = require('winston');

// winston엔 Logger가 있다. 옵션 객체가 들어간다. Console에 찍는 로그와 File에 찍는 로그
// 옵션중에 기억해야 할 것은 level
// debug 라는 Log level : 
var logger = new winston.Logger({
	transports: [
        new winston.transports.Console({
        	level: 'info',
        	silent: false,	// slient: 로그를 끌수있다.
        	colorize: false,
        	timestamp: false
        }),
        new winston.transports.DailyRotateFile({
        	level: 'debug',
        	silent: false,
        	colorize: false,
        	timestamp: true,
        	filename: 'log/momentory-debug-log',
        	maxsize: 1024*1024*1024*1,	//현재1mb
        	json: true,
        	datePattern: '.yyyy-MM-dd.log'
        })
	]
});

module.exports = logger;