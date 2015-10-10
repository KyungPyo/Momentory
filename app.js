var express = require('express')
  , index = require('./routes/index')
  , couple = require('./routes/couple')
  , letter = require('./routes/letter')
  , http = require('http')
  , path = require('path')
  , mysql = require('mysql')
  , passport = require('passport')
  , dbConfig = require('./config/database');

global.connectionPool = mysql.createPool(dbConfig);

var MySQLStore = require('connect-mysql')(express);
var storeOption = {
	pool : connectionPool
}

require('./config/passport')(passport);

var app = express();

// all environments
app.set('port', process.env.PORT || 80);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');

app.use(express.favicon());
app.use(express.logger('dev'));

app.use(express.cookieParser());	// 쿠키파서 추가
app.use(express.compress());
//app.use(express.bodyParser({
//	"uploadDir": __dirname + "/uploads",
//	"keepExtensions": true,		// 업로드 파일 확장자 유지
//	"defer": true
//}));
app.use(express.json());
app.use(express.urlencoded());

app.use(express.methodOverride());
app.use(express.session({
	secret:"Momentory",
	store: new MySQLStore(storeOption),
	cookie:{
		maxAge:8640000
	}
}));
//86400000

app.use(express.session({ secret: 'MomentorySession' }));
app.use(passport.initialize());
app.use(passport.session());

app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

/*추가내용*/
require('./routes/user')(app, passport);
require('./routes/couple')(app);
require('./routes/letter')(app);
require('./routes/anniversary')(app);
require('./routes/shortmsg')(app);

app.get('/main/view', index.getMain);
/*추가내용*/

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
